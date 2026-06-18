"use client";

import { useEffect, useRef, useState } from "react";
import type { SkillEntry } from "@/lib/types";
import { Corners, Tag, cn } from "./hud";
import { fmtUsd } from "@/lib/format";

type LogLine = { kind: string; text: string };

export default function SkillComposer({
  skill,
  onClose,
}: {
  skill: SkillEntry | null;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [cwd, setCwd] = useState("");
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [output, setOutput] = useState("");
  const [result, setResult] = useState<{ text: string; cost: number | null } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const consoleRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // reset when a new skill opens
  useEffect(() => {
    if (skill) {
      setPrompt("");
      setLog([]);
      setOutput("");
      setResult(null);
      setRunning(false);
      setTimeout(() => taRef.current?.focus(), 50);
    }
    return () => abortRef.current?.abort();
  }, [skill]);

  // esc to close + trap Tab focus inside the dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !running) {
        onClose();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const f = dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, [tabindex]:not([tabindex="-1"])'
        );
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, running]);

  // lock background scroll while open; restore focus to the trigger on close
  useEffect(() => {
    if (!skill) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      restoreFocusRef.current?.focus?.();
    };
  }, [skill]);

  useEffect(() => {
    if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [log, output]);

  if (!skill) return null;

  const fullCommand = `${skill.command}${prompt.trim() ? " " + prompt.trim() : ""}`;

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fullCommand);
      flash("Command copied");
    } catch {
      flash("Copy failed");
    }
  };

  const launchTerminal = async () => {
    try {
      const r = await fetch("/api/skills/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: fullCommand, cwd: cwd.trim() || undefined }),
      });
      const j = await r.json();
      flash(j.ok ? "Launched in Terminal →" : "Launch failed: " + (j.error || ""));
    } catch (e) {
      flash("Launch failed");
    }
  };

  const runInline = async () => {
    if (running) return;
    setRunning(true);
    setLog([{ kind: "status", text: "Connecting…" }]);
    setOutput("");
    setResult(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch("/api/skills/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: fullCommand, cwd: cwd.trim() || undefined }),
        signal: ac.signal,
      });
      if (!res.body) throw new Error("No stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = frame.startsWith("data:") ? frame.slice(5).trim() : frame.trim();
          if (!line) continue;
          let ev: { kind: string; text?: string; name?: string; cost?: number | null; code?: number; isError?: boolean };
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          handleEvent(ev);
        }
      }
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string };
      if (err.name !== "AbortError") {
        setLog((l) => [...l, { kind: "error", text: "Stream error: " + (err.message || String(e)) }]);
      }
    } finally {
      setRunning(false);
    }
  };

  const handleEvent = (ev: {
    kind: string;
    text?: string;
    name?: string;
    cost?: number | null;
    code?: number;
    isError?: boolean;
  }) => {
    switch (ev.kind) {
      case "status":
        setLog((l) => [...l, { kind: "status", text: ev.text || "" }]);
        break;
      case "tool":
        setLog((l) => [...l, { kind: "tool", text: `→ ${ev.name}` }]);
        break;
      case "log":
        setLog((l) => [...l, { kind: "log", text: ev.text || "" }]);
        break;
      case "delta":
        setOutput((o) => o + (ev.text || ""));
        break;
      case "message":
        setOutput((o) => (o ? o + "\n\n" : "") + (ev.text || ""));
        break;
      case "result":
        setResult({ text: ev.text || "", cost: ev.cost ?? null });
        // functional updater: only fall back to result text if nothing streamed
        if (ev.text) setOutput((o) => (o ? o : ev.text!));
        break;
      case "error":
        setLog((l) => [...l, { kind: "error", text: ev.text || "" }]);
        break;
      case "done":
        setLog((l) => [...l, { kind: "status", text: `Run complete (exit ${ev.code ?? 0}).` }]);
        break;
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  const lineColor: Record<string, string> = {
    status: "text-ink-dim",
    tool: "text-cool",
    log: "text-ink-faint",
    error: "text-accent",
  };

  const hasConsole = log.length > 0 || output || result;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !running) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Invoke skill ${skill.name}`}
        className="panel relative my-auto w-full max-w-2xl rise"
      >
        <Corners accent />

        {/* header */}
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="label text-accent shrink-0">INVOKE //</span>
            <span className="truncate font-display text-sm font-semibold uppercase tracking-[0.18em] text-ink">
              {skill.name}
            </span>
            <Tag>{skill.category}</Tag>
          </div>
          <button
            onClick={() => !running && onClose()}
            disabled={running}
            className="flex h-6 w-6 items-center justify-center border border-transparent text-ink-dim transition-colors hover:border-line hover:bg-panel-2 hover:text-ink disabled:opacity-40"
            aria-label="Close"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        {/* body */}
        <div className="space-y-4 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <code className="border border-line bg-base-2 px-2 py-1 text-accent">{skill.command}</code>
            {skill.count > 0 && (
              <span className="text-[10px] uppercase tracking-[0.16em] text-ink-dim">
                used {skill.count}×
              </span>
            )}
          </div>
          <p className="text-[12px] leading-relaxed text-ink-2">{skill.description}</p>

          <div className="space-y-1.5">
            <label className="label">Prompt · args</label>
            <textarea
              ref={taRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={`What do you want ${skill.name} to do?`}
              rows={4}
              className="w-full resize-y border border-line bg-base-2 px-3 py-2.5 font-mono text-[13px] text-ink transition-colors placeholder:text-ink-faint hover:border-line-strong focus:border-accent-line focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="label">Context dir · optional</label>
            <input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="~ (home)  ·  e.g. /Users/you/project"
              className="w-full border border-line bg-base-2 px-3 py-2 font-mono text-[12px] text-ink-2 transition-colors placeholder:text-ink-faint hover:border-line-strong focus:border-accent-line focus:outline-none"
            />
          </div>

          {/* command preview */}
          <div className="border border-line-soft bg-base-2 px-3 py-2">
            <span className="label text-ink-faint">RESOLVED COMMAND</span>
            <div className="mt-1 break-all font-mono text-[11px] text-ink-dim">
              <span className="text-online">$</span> claude &quot;
              <span className="text-ink-2">{fullCommand}</span>&quot;
            </div>
          </div>
        </div>

        {/* actions */}
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
          <button
            onClick={launchTerminal}
            title="Open a real interactive Claude session in Terminal"
            className="group flex items-center gap-2 border border-accent-line bg-accent-soft px-3.5 py-2 text-[11px] uppercase tracking-[0.16em] text-accent transition-colors hover:bg-accent hover:text-base"
          >
            <span className="text-[13px] leading-none">▸</span> Launch in Terminal
          </button>
          {!running ? (
            <button
              onClick={runInline}
              title="Run headless and stream the output here"
              className="flex items-center gap-2 border border-line px-3.5 py-2 text-[11px] uppercase tracking-[0.16em] text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
            >
              <span className="leading-none">⧉</span> Run Inline
            </button>
          ) : (
            <button
              onClick={stop}
              title="Stop the running skill"
              className="flex items-center gap-2 border border-accent-line px-3.5 py-2 text-[11px] uppercase tracking-[0.16em] text-accent transition-colors hover:bg-accent-soft"
            >
              <span className="h-2 w-2 bg-accent pulse" /> Stop
            </button>
          )}
          <button
            onClick={copy}
            title="Copy the resolved command to your clipboard"
            className="border border-line px-3.5 py-2 text-[11px] uppercase tracking-[0.16em] text-ink-dim transition-colors hover:border-line-strong hover:bg-panel-2 hover:text-ink"
          >
            Copy
          </button>
          <span className="leader hidden sm:block" />
          {toast && (
            <span className="text-[10px] uppercase tracking-[0.16em] text-online">{toast}</span>
          )}
        </div>

        {/* console */}
        {hasConsole && (
          <div className="border-t border-line">
            <div className="flex items-center gap-2 px-5 py-2">
              <span className="label text-ink-faint">CONSOLE</span>
              {running && <span className="h-1.5 w-1.5 rounded-full bg-online pulse" />}
              <span className="leader" />
              {result?.cost != null && (
                <span className="text-[10px] uppercase tracking-[0.16em] text-ink-dim">
                  {fmtUsd(result.cost)}
                </span>
              )}
            </div>
            <div
              ref={consoleRef}
              className="max-h-[40vh] overflow-y-auto rail-scroll border-t border-line-soft bg-base px-5 py-3 font-mono text-[12px] leading-relaxed"
            >
              {log.map((l, i) => (
                <div key={i} className={cn(lineColor[l.kind] || "text-ink-dim")}>
                  {l.text}
                </div>
              ))}
              {output && (
                <pre className="mt-2 whitespace-pre-wrap break-words text-ink">{output}</pre>
              )}
              {running && <span className="inline-block h-3.5 w-2 animate-pulse bg-accent align-middle" />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
