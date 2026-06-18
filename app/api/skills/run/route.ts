import os from "node:os";
import fs from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stream a headless `claude -p` execution of a skill back to the browser as SSE.
// Each SSE message is a JSON event: {kind, text?, name?, cost?, ...}.

export async function POST(request: Request) {
  let body: { command?: string; cwd?: string };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const command = (body.command || "").trim();
  if (!command) return new Response("Empty command", { status: 400 });
  if (command.length > 16000) return new Response("Command too long", { status: 400 });
  const cwd = body.cwd && fs.existsSync(body.cwd) ? body.cwd : os.homedir();

  const encoder = new TextEncoder();
  let child: ChildProcessWithoutNullStreams | null = null;

  // `claude` spawns its own subprocesses (bash, servers, MCP). Kill the whole
  // process group on disconnect so nothing is orphaned; fall back to the direct
  // child if the group kill fails.
  const killChild = () => {
    if (!child || child.killed || !child.pid) return;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }
  };

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* controller already closed */
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* noop */
        }
      };

      send({ kind: "status", text: "Spawning agent…" });

      try {
        child = spawn(
          "claude",
          ["-p", "--output-format", "stream-json", "--verbose", command],
          { cwd, env: process.env, detached: true }
        );
        // close stdin so `claude` doesn't wait ~3s for piped input
        child.stdin.end();
      } catch (err) {
        send({ kind: "error", text: "Could not start claude: " + String(err) });
        close();
        return;
      }

      // forward parsed stdout
      let buf = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buf += chunk;
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) forward(line, send);
        }
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        const t = String(chunk).trim();
        if (t) send({ kind: "log", text: t.slice(0, 600) });
      });

      child.on("error", (err) => {
        send({ kind: "error", text: "Process error: " + String(err) });
        close();
      });

      child.on("close", (code) => {
        if (buf.trim()) forward(buf.trim(), send);
        send({ kind: "done", code: code ?? 0 });
        close();
      });

      // client disconnect → kill the child process group
      request.signal.addEventListener("abort", () => {
        killChild();
        close();
      });
    },
    cancel() {
      killChild();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

type Send = (obj: unknown) => void;

// Map a single claude stream-json line to a UI event.
function forward(line: string, send: Send) {
  let o: {
    type?: string;
    subtype?: string;
    message?: { content?: Array<{ type?: string; text?: string; name?: string }> };
    result?: string;
    total_cost_usd?: number;
    is_error?: boolean;
    event?: { type?: string; delta?: { type?: string; text?: string } };
  };
  try {
    o = JSON.parse(line);
  } catch {
    return; // non-JSON noise
  }

  if (o.type === "system" && o.subtype === "init") {
    send({ kind: "status", text: "Session initialized." });
    return;
  }

  // partial text deltas (if the CLI emits them)
  if (o.type === "stream_event" && o.event?.type === "content_block_delta") {
    const d = o.event.delta;
    if (d?.type === "text_delta" && d.text) send({ kind: "delta", text: d.text });
    return;
  }

  if (o.type === "assistant" && o.message?.content) {
    for (const c of o.message.content) {
      if (c.type === "text" && c.text) send({ kind: "message", text: c.text });
      else if (c.type === "tool_use" && c.name) send({ kind: "tool", name: c.name });
    }
    return;
  }

  if (o.type === "result") {
    send({
      kind: "result",
      text: typeof o.result === "string" ? o.result : "",
      cost: o.total_cost_usd ?? null,
      isError: !!o.is_error,
    });
    return;
  }
}
