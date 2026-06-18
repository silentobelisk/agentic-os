"use client";

import { useEffect, useRef, useState } from "react";
import { Panel, SectionHeader, Hair, cn } from "./hud";
import { fmtUsd } from "@/lib/format";

type Entry =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; tools: string[]; done: boolean }
  | { role: "system"; text: string; tone: "dim" | "error" };

const MODES = [
  { key: "default", label: "CHAT", title: "Answers, reads & plans — file edits are not auto-applied" },
  { key: "acceptEdits", label: "AUTO-EDIT", title: "Auto-approves file edits Claude makes" },
  { key: "bypassPermissions", label: "FULL AUTO", title: "Runs everything with no prompts — use with care" },
];

export default function Terminal() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [cwd, setCwd] = useState("");
  const [mode, setMode] = useState("default");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [cost, setCost] = useState(0);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [entries]);

  // update the most recent assistant entry immutably
  const patchAssistant = (patch: (e: Extract<Entry, { role: "assistant" }>) => Partial<Entry>) => {
    setEntries((prev) => {
      const e = prev.slice();
      for (let i = e.length - 1; i >= 0; i--) {
        const cur = e[i];
        if (cur.role === "assistant") {
          e[i] = { ...cur, ...patch(cur) } as Entry;
          break;
        }
      }
      return e;
    });
  };

  const send = async () => {
    const msg = input.trim();
    if (!msg || running) return;
    setInput("");
    setRunning(true);
    setEntries((prev) => [
      ...prev,
      { role: "user", text: msg },
      { role: "assistant", text: "", tools: [], done: false },
    ]);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, sessionId, cwd: cwd.trim() || undefined, permissionMode: mode }),
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
          if (line) handleEvent(JSON.parse(line));
        }
      }
    } catch (e: unknown) {
      if ((e as { name?: string })?.name !== "AbortError") {
        setEntries((prev) => [...prev, { role: "system", text: "Stream error.", tone: "error" }]);
      }
    } finally {
      setRunning(false);
      patchAssistant(() => ({ done: true }));
    }
  };

  const handleEvent = (ev: {
    kind: string;
    id?: string;
    text?: string;
    name?: string;
    cost?: number | null;
  }) => {
    switch (ev.kind) {
      case "session":
        if (ev.id) setSessionId(ev.id);
        break;
      case "delta":
        patchAssistant((e) => ({ text: e.text + (ev.text || "") }));
        break;
      case "message":
        patchAssistant((e) => ({ text: (e.text ? e.text + "\n\n" : "") + (ev.text || "") }));
        break;
      case "tool":
        if (ev.name) patchAssistant((e) => ({ tools: [...e.tools, ev.name!] }));
        break;
      case "result":
        if (typeof ev.cost === "number") setCost((c) => c + ev.cost!);
        patchAssistant((e) => (e.text || !ev.text ? {} : { text: ev.text! }));
        break;
      case "log":
      case "error":
        setEntries((prev) => [...prev, { role: "system", text: ev.text || "", tone: ev.kind === "error" ? "error" : "dim" }]);
        break;
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  const reset = () => {
    if (running) stop();
    setEntries([]);
    setSessionId(null);
    setCost(0);
    setTimeout(() => taRef.current?.focus(), 0);
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <Panel className="overflow-hidden">
      <div className="px-5 pt-4 pb-3">
        <SectionHeader
          index="01 //"
          title="Terminal"
          right={
            <div className="flex items-center gap-2">
              {cost > 0 && (
                <span className="hidden text-[10px] uppercase tracking-[0.16em] text-ink-dim sm:inline">
                  {fmtUsd(cost)} session
                </span>
              )}
              <span
                className={cn(
                  "flex items-center gap-1.5 border border-line px-2 py-1 text-[10px] uppercase tracking-[0.16em]",
                  sessionId ? "text-online" : "text-ink-dim"
                )}
                title={sessionId ? `Session ${sessionId}` : "No active session"}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", sessionId ? "bg-online" : "bg-ink-dim", running && "pulse")} />
                {running ? "Working" : sessionId ? "Live" : "Idle"}
              </span>
              <button
                onClick={reset}
                title="Start a fresh conversation"
                className="border border-line px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-ink-dim transition-colors hover:border-line-strong hover:bg-panel-2 hover:text-ink"
              >
                New
              </button>
            </div>
          }
        />
      </div>
      <Hair />

      {/* controls */}
      <div className="flex flex-wrap items-center gap-2 px-5 py-2.5">
        <span className="label text-ink-faint">DIR</span>
        <input
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder="~ (home) · point at a project folder"
          className="min-w-0 flex-1 border border-line bg-base-2 px-2.5 py-1 font-mono text-[11px] text-ink-2 transition-colors placeholder:text-ink-faint hover:border-line-strong focus:border-accent-line focus:outline-none"
        />
        <div className="flex items-center border border-line" role="group" aria-label="Permission mode">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              title={m.title}
              aria-pressed={mode === m.key}
              className={cn(
                "px-2 py-1 text-[9px] uppercase tracking-[0.14em] transition-colors",
                mode === m.key
                  ? m.key === "bypassPermissions"
                    ? "bg-[#ff5a4a]/15 text-[#ff5a4a]"
                    : "bg-accent-soft text-accent"
                  : "text-ink-dim hover:bg-panel-2 hover:text-ink"
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <Hair />

      {/* transcript */}
      <div
        ref={scrollRef}
        className="rail-scroll h-[400px] overflow-y-auto bg-base px-5 py-4 font-mono text-[12px] leading-relaxed"
      >
        {entries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <span className="font-display text-sm font-semibold uppercase tracking-[0.16em] text-ink-2">
              Talk to Claude Code
            </span>
            <span className="max-w-md text-[11px] leading-relaxed text-ink-dim">
              Ask a question, plan a feature, or point it at a project folder and have it work — a full
              Claude Code conversation, right here. Uses your subscription, no API key.
            </span>
            <span className="mt-1 text-[10px] uppercase tracking-[0.16em] text-ink-faint">
              Enter to send · Shift+Enter for newline
            </span>
          </div>
        ) : (
          <div className="space-y-3">
            {entries.map((e, i) => {
              if (e.role === "user") {
                return (
                  <div key={i} className="flex gap-2">
                    <span className="select-none text-accent">❯</span>
                    <span className="whitespace-pre-wrap break-words text-ink">{e.text}</span>
                  </div>
                );
              }
              if (e.role === "system") {
                return (
                  <div key={i} className={cn("pl-4 text-[11px]", e.tone === "error" ? "text-[#ff5a4a]" : "text-ink-faint")}>
                    {e.text}
                  </div>
                );
              }
              const streaming = running && i === entries.length - 1 && !e.done;
              return (
                <div key={i} className="space-y-1.5 pl-4">
                  {e.tools.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {e.tools.map((t, ti) => (
                        <span
                          key={ti}
                          className="inline-flex items-center gap-1 border border-line-soft px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-cool"
                        >
                          <span className="text-[10px] leading-none">→</span> {t}
                        </span>
                      ))}
                    </div>
                  )}
                  {e.text && <div className="whitespace-pre-wrap break-words text-ink-2">{e.text}</div>}
                  {streaming && (
                    <span className="inline-block h-3.5 w-2 animate-pulse bg-accent align-middle" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <Hair />

      {/* input bar */}
      <div className="flex items-end gap-2 px-5 py-3">
        <span className="select-none pb-2 font-mono text-accent">❯</span>
        <textarea
          ref={taRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          rows={1}
          placeholder="Message Claude Code…"
          className="max-h-32 min-h-[2.25rem] flex-1 resize-none border border-line bg-base-2 px-3 py-2 font-mono text-[13px] text-ink transition-colors placeholder:text-ink-faint hover:border-line-strong focus:border-accent-line focus:outline-none"
        />
        {running ? (
          <button
            onClick={stop}
            title="Stop"
            className="flex items-center gap-2 border border-accent-line px-3.5 py-2 text-[11px] uppercase tracking-[0.16em] text-accent transition-colors hover:bg-accent-soft"
          >
            <span className="h-2 w-2 bg-accent pulse" /> Stop
          </button>
        ) : (
          <button
            onClick={send}
            disabled={!input.trim()}
            className="border border-accent-line bg-accent-soft px-4 py-2 text-[11px] uppercase tracking-[0.16em] text-accent transition-colors hover:bg-accent hover:text-base disabled:opacity-40"
          >
            Send
          </button>
        )}
      </div>
    </Panel>
  );
}
