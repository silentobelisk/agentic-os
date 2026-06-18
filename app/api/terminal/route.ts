import os from "node:os";
import fs from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Conversational bridge to Claude Code over SSE. Each turn spawns `claude -p`
// in stream-json mode; the session_id is captured and reused (--resume) so the
// dashboard terminal holds a real multi-turn conversation. Uses the user's
// subscription via the CLI — no API key.

const PERMISSION_MODES = new Set(["default", "acceptEdits", "plan", "bypassPermissions"]);

export async function POST(request: Request) {
  let body: { message?: string; sessionId?: string; cwd?: string; permissionMode?: string };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const message = (body.message || "").trim();
  if (!message) return new Response("Empty message", { status: 400 });
  if (message.length > 24000) return new Response("Message too long", { status: 400 });
  const cwd = body.cwd && fs.existsSync(body.cwd) ? body.cwd : os.homedir();
  const sessionId = typeof body.sessionId === "string" && /^[\w-]{8,}$/.test(body.sessionId) ? body.sessionId : null;
  const mode = body.permissionMode && PERMISSION_MODES.has(body.permissionMode) ? body.permissionMode : "default";

  const args = ["-p", "--output-format", "stream-json", "--verbose"];
  if (sessionId) args.push("--resume", sessionId);
  args.push("--permission-mode", mode);
  args.push(message);

  const encoder = new TextEncoder();
  let child: ChildProcessWithoutNullStreams | null = null;

  const killChild = () => {
    if (!child || child.killed || !child.pid) return;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
        /* gone */
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
          /* closed */
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

      try {
        child = spawn("claude", args, { cwd, env: process.env, detached: true });
        child.stdin.end();
      } catch (err) {
        send({ kind: "error", text: "Could not start claude: " + String(err) });
        close();
        return;
      }

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

function forward(line: string, send: Send) {
  let o: {
    type?: string;
    subtype?: string;
    session_id?: string;
    message?: { content?: Array<{ type?: string; text?: string; name?: string }> };
    result?: string;
    total_cost_usd?: number;
    is_error?: boolean;
    num_turns?: number;
    event?: { type?: string; delta?: { type?: string; text?: string } };
  };
  try {
    o = JSON.parse(line);
  } catch {
    return;
  }

  if (o.session_id) send({ kind: "session", id: o.session_id });

  if (o.type === "system" && o.subtype === "init") {
    send({ kind: "status", text: "Session ready." });
    return;
  }
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
      turns: o.num_turns ?? null,
      isError: !!o.is_error,
    });
  }
}
