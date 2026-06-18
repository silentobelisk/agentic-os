"use client";

import { useEffect, useRef, useState } from "react";
import type { GraphData } from "@/lib/graph";
import { entryToFiles, toPayload, initials, type FsEntry } from "@/lib/brain-upload";
import { Panel, SectionHeader, Hair, Chip, Corners, cn } from "./hud";
import GraphCanvas from "./GraphCanvas";

interface Account {
  email: string | null;
  org: string | null;
  plan: string;
  multiplier: number;
  memberSince: string | null;
}
function monthYear(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(+d) ? "—" : d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export default function Profile() {
  const [name, setName] = useState("");
  const [fileCount, setFileCount] = useState(0);
  const [hasGraph, setHasGraph] = useState(false);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [uploading, setUploading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [buildLog, setBuildLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const refresh = async () => {
    try {
      const b = await (await fetch("/api/brain")).json();
      setFileCount(b.fileCount || 0);
      setHasGraph(!!b.hasGraph);
      if (b.hasGraph) {
        const g = await (await fetch("/api/graph")).json();
        if (g.ready) setGraph(g.graph);
      }
      return b;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d) => {
        setName(d.name || "");
        setAccount(d.account || null);
      })
      .catch(() => {});
    refresh().then((b) => {
      if (b?.building) {
        setBuilding(true);
        watchBuild();
      }
    });
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      watchRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [buildLog]);

  const onName = (v: string) => {
    setName(v);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: v }),
      }).catch(() => {});
    }, 600);
  };

  const ingest = async (files: { file: File; path: string }[]) => {
    const payload = await toPayload(files);
    if (!payload.length) {
      setError("No supported notes (.md, .txt, …) found in that drop.");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const r = await fetch("/api/brain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: payload }),
      });
      const j = await r.json();
      if (!j.ok) {
        setError(j.error || "Upload failed");
      } else {
        setFileCount(j.fileCount);
        setHasGraph(false);
        setGraph(null);
      }
    } catch {
      setError("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const items = e.dataTransfer?.items;
    let collected: { file: File; path: string }[] = [];
    if (items && items.length && (items[0] as unknown as { webkitGetAsEntry?: unknown }).webkitGetAsEntry) {
      const entries = Array.from(items)
        .map((it) => (it as unknown as { webkitGetAsEntry: () => FsEntry | null }).webkitGetAsEntry())
        .filter(Boolean) as FsEntry[];
      const nested = await Promise.all(entries.map((en) => entryToFiles(en)));
      collected = nested.flat();
    } else if (e.dataTransfer?.files?.length) {
      collected = Array.from(e.dataTransfer.files).map((f) => ({ file: f, path: f.name }));
    }
    await ingest(collected);
  };

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list?.length) return;
    const collected = Array.from(list).map((f) => ({
      file: f,
      path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
    }));
    await ingest(collected);
    e.target.value = "";
  };

  const watchBuild = async () => {
    watchRef.current?.abort();
    const ac = new AbortController();
    watchRef.current = ac;
    try {
      const res = await fetch("/api/brain/graphify", { signal: ac.signal });
      if (!res.body) throw new Error("no stream");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = frame.startsWith("data:") ? frame.slice(5).trim() : frame.trim();
          if (!line) continue;
          const d = JSON.parse(line);
          if (Array.isArray(d.lines) && d.lines.length) setBuildLog((p) => [...p, ...d.lines].slice(-200));
          if (d.done) {
            setBuilding(false);
            if (d.status === "error") setError(d.error || "Build failed");
            await refresh();
          }
        }
      }
    } catch (e: unknown) {
      if ((e as { name?: string })?.name !== "AbortError") setBuilding(false);
    }
  };

  const startBuild = async () => {
    setError(null);
    setBuildLog([]);
    setBuilding(true);
    try {
      await fetch("/api/brain/graphify", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    } catch {
      /* ignore */
    }
    watchBuild();
  };

  const cancelBuild = async () => {
    try {
      await fetch("/api/brain/graphify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancel: true }),
      });
    } catch {
      /* ignore */
    }
    watchRef.current?.abort();
    setBuilding(false);
  };

  const m = graph?.meta;
  const planShort = account ? account.plan.replace(/^Claude\s+/i, "") : "";
  const planBase = planShort.replace(/\s*\d+×$/, "");
  const brainPrimary = hasGraph && m ? String(m.nodeCount ?? 0) : fileCount > 0 ? String(fileCount) : "—";
  const brainUnit = hasGraph && m ? "nodes" : fileCount > 0 ? "notes" : "";
  const brainSub = hasGraph && m ? `${m.communities} clusters` : null;

  const dropzone = (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      onClick={() => fileInputRef.current?.click()}
      className={cn(
        "flex min-h-[160px] cursor-pointer flex-col items-center justify-center gap-2 border border-dashed px-6 text-center transition-colors",
        dragOver ? "border-accent-line bg-accent-soft" : "border-line-strong hover:border-accent-line hover:bg-accent-soft"
      )}
    >
      <span className="font-display text-sm font-semibold uppercase tracking-[0.16em] text-ink-2">
        {uploading ? "Uploading…" : "Drop your second brain"}
      </span>
      <span className="max-w-md text-[11px] leading-relaxed text-ink-dim">
        Drag a folder of notes here, or click to choose one. Markdown & text files are read locally,
        then mapped into a knowledge graph with <span className="text-accent">/graphify</span> — nothing
        leaves your machine.
      </span>
      <span className="mt-1 text-[10px] uppercase tracking-[0.16em] text-accent">Choose folder ▸</span>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        // @ts-expect-error non-standard directory-picker attributes
        webkitdirectory=""
        directory=""
        className="hidden"
        onChange={onPick}
      />
    </div>
  );

  return (
    <Panel className="overflow-hidden">
      <div className="px-5 pt-4 pb-3">
        <SectionHeader
          index="00 //"
          title="Operator Profile"
          right={
            hasGraph ? (
              <Chip tone="online" pulse>
                Brain Mapped
              </Chip>
            ) : fileCount > 0 ? (
              <Chip tone="accent">{fileCount} notes</Chip>
            ) : (
              <Chip tone="dim">No Brain</Chip>
            )
          }
        />
      </div>
      <Hair />

      {/* identity — operator ID + vitals */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 px-5 py-4">
        {/* operator ID */}
        <div className="flex items-center gap-3.5">
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center border border-accent-line bg-accent-soft">
            <Corners accent />
            <span className="font-display text-xl font-bold tracking-wider text-accent glow-accent">
              {initials(name)}
            </span>
          </div>
          <div className="w-[200px] shrink-0 sm:w-[240px]">
            <label className="label">Name</label>
            <input
              value={name}
              onChange={(e) => onName(e.target.value)}
              placeholder="Your name"
              title="Click to edit your name"
              className="mt-1 w-full border-0 border-b border-line bg-transparent px-1.5 pb-1 font-display text-lg font-semibold text-ink transition-colors placeholder:text-ink-faint hover:border-ink-dim hover:bg-panel-2 focus:border-accent-line focus:bg-panel-2 focus:outline-none"
            />
            {account?.email && (
              <div className="mt-1 truncate px-1.5 font-mono text-[10px] text-ink-dim" title={account.org || account.email}>
                {account.email}
              </div>
            )}
          </div>
        </div>

        {/* operator vitals — real, glanceable stats (no decoration) */}
        {account && (
          <div className="flex items-stretch divide-x divide-line">
            <div className="flex flex-col gap-1 px-4 first:pl-0">
              <span className="label">Plan</span>
              <span className="tnum font-display text-[15px] font-semibold leading-none text-ink">
                {account.multiplier > 1 ? (
                  <>
                    {planBase.toUpperCase()} <span className="text-accent">{account.multiplier}×</span>
                  </>
                ) : (
                  planShort.toUpperCase()
                )}
              </span>
            </div>
            <div className="flex flex-col gap-1 px-4">
              <span className="label">Member</span>
              <span className="tnum font-display text-[15px] font-semibold leading-none text-ink">
                {monthYear(account.memberSince)}
              </span>
            </div>
            <div className="flex flex-col gap-1 px-4 last:pr-0">
              <span className="label">Brain</span>
              <span className="flex items-baseline gap-1 leading-none">
                <span className={cn("tnum font-display text-[15px] font-semibold", hasGraph ? "glow-accent text-accent" : "text-ink")}>
                  {brainPrimary}
                </span>
                {brainUnit && <span className="label text-ink-dim">{brainUnit}</span>}
              </span>
              {brainSub && <span className="text-[9px] uppercase tracking-[0.12em] text-ink-faint tnum">{brainSub}</span>}
            </div>
          </div>
        )}
      </div>
      <Hair />

      {/* second brain → knowledge graph */}
      <div className="p-5">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="label text-accent" style={{ letterSpacing: "0.12em" }}>
            SECOND BRAIN //
          </span>
          <h3 className="shrink-0 font-display text-[12px] font-semibold uppercase tracking-[0.22em] text-ink-2">
            Knowledge Graph
          </h3>
          <span className="leader" />
          {hasGraph && m && (
            <span className="hidden text-[10px] uppercase tracking-[0.16em] text-ink-dim sm:inline tnum">
              {m.nodeCount} nodes · {m.edgeCount} links · {m.communities} clusters
              {m.capped ? " · top 800" : ""}
            </span>
          )}
          {(hasGraph || fileCount > 0) && !building && (
            <div className="flex items-center gap-1.5">
              {hasGraph && (
                <button
                  onClick={startBuild}
                  title="Re-run graphify on the current notes"
                  className="border border-line px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-ink-dim transition-colors hover:border-line-strong hover:bg-panel-2 hover:text-ink"
                >
                  Rebuild
                </button>
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                title="Upload a different folder"
                className="border border-line px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-ink-dim transition-colors hover:border-line-strong hover:bg-panel-2 hover:text-ink"
              >
                Re-upload
              </button>
            </div>
          )}
        </div>

        {error && <div className="mb-3 text-[11px] text-accent">{error}</div>}

        {building ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-accent pulse" />
              <span className="label text-ink-2">Mapping your second brain — this takes ~1–3 minutes</span>
              <span className="leader" />
              <button
                onClick={cancelBuild}
                className="border border-accent-line px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-accent transition-colors hover:bg-accent-soft"
              >
                Cancel
              </button>
            </div>
            <div
              ref={logRef}
              className="rail-scroll h-[200px] overflow-y-auto border border-line-soft bg-base px-4 py-3 font-mono text-[11px] leading-relaxed text-ink-dim"
            >
              {buildLog.length === 0 ? (
                <span className="text-ink-faint">Starting graphify…</span>
              ) : (
                buildLog.map((l, i) => (
                  <div key={i} className={cn("break-words", l.startsWith("→") && "text-cool", l.startsWith("✓") && "text-online")}>
                    {l}
                  </div>
                ))
              )}
            </div>
          </div>
        ) : hasGraph && graph ? (
          <div className="relative h-[560px] border border-line bg-base">
            <GraphCanvas data={graph} />
          </div>
        ) : fileCount > 0 ? (
          <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 border border-dashed border-line-strong px-6 text-center">
            <span className="font-display text-sm font-semibold uppercase tracking-[0.16em] text-ink-2">
              {fileCount} notes loaded
            </span>
            <span className="max-w-md text-[11px] leading-relaxed text-ink-dim">
              Build a knowledge graph from your notes — graphify reads every note and maps the people,
              projects, and ideas into a connected graph. Runs on your Claude subscription (~1–3 min).
            </span>
            <button
              onClick={startBuild}
              className="mt-1 flex items-center gap-2 border border-accent-line bg-accent-soft px-4 py-2 text-[11px] uppercase tracking-[0.16em] text-accent transition-colors hover:bg-accent hover:text-base"
            >
              Build Knowledge Graph ▸
            </button>
          </div>
        ) : (
          dropzone
        )}
      </div>
    </Panel>
  );
}
