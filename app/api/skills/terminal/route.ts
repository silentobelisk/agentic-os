import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Escape a string for safe inclusion inside single quotes in a bash script.
function sq(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export async function POST(request: Request) {
  let body: { command?: string; cwd?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const command = (body.command || "").trim();
  if (!command) return Response.json({ ok: false, error: "Empty command" }, { status: 400 });
  if (command.length > 8000) return Response.json({ ok: false, error: "Command too long" }, { status: 400 });

  const cwd = body.cwd && fs.existsSync(body.cwd) ? body.cwd : os.homedir();

  if (process.platform !== "darwin") {
    return Response.json(
      { ok: false, error: "Terminal launch is macOS-only on this build." },
      { status: 400 }
    );
  }

  // A self-contained, self-deleting .command launcher opened by Terminal.app.
  const id = Math.random().toString(36).slice(2, 10);
  const file = path.join(os.tmpdir(), `nerve-${id}.command`);
  const script =
    `#!/bin/bash\n` +
    `cd ${sq(cwd)} || exit 1\n` +
    `clear\n` +
    `echo "── NERVE CENTER · launching skill ──────────────"\n` +
    `echo ${sq("  " + command.slice(0, 120))}\n` +
    `echo "────────────────────────────────────────────────"\n` +
    `rm -f ${sq(file)}\n` +
    `exec claude ${sq(command)}\n`;

  try {
    fs.writeFileSync(file, script, { mode: 0o755 });
    const child = spawn("open", ["-a", "Terminal", file], { detached: true, stdio: "ignore" });
    child.unref();
    return Response.json({ ok: true, cwd, command });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
