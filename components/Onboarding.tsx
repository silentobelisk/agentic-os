"use client";

import { useEffect, useRef, useState } from "react";
import { entryToFiles, toPayload, initials, type FsEntry } from "@/lib/brain-upload";
import { Panel, SectionHeader, Hair, Chip, Corners, Stat, BrainMark, cn } from "./hud";

// ── shared button vocabulary (matches the dashboard's controls) ───────────
const PRIMARY =
  "group inline-flex items-center gap-2 border border-accent-line bg-accent-soft px-5 py-2.5 font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-accent transition-colors hover:bg-accent hover:text-base disabled:cursor-not-allowed disabled:opacity-40";
const GHOST =
  "inline-flex items-center gap-2 border border-line px-3.5 py-2.5 text-[11px] uppercase tracking-[0.18em] text-ink-dim transition-colors hover:border-line-strong hover:bg-panel-2 hover:text-ink disabled:opacity-40";

interface Account {
  email: string | null;
  org: string | null;
  plan: string;
  multiplier: number;
  memberSince: string | null;
}

const STEPS = [
  { id: "boot", title: "System Boot" },
  { id: "identity", title: "Operator Identity" },
  { id: "plan", title: "Claude Link" },
  { id: "brain", title: "Second Brain" },
  { id: "social", title: "Audience Signals" },
  { id: "ready", title: "System Ready" },
] as const;

function monthYear(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(+d) ? "—" : d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [account, setAccount] = useState<Account | null>(null);
  const [accountLoaded, setAccountLoaded] = useState(false);

  // second brain
  const [fileCount, setFileCount] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [building, setBuilding] = useState(false);
  const [buildDone, setBuildDone] = useState(false);
  const [buildLog, setBuildLog] = useState<string[]>([]);
  const [brainError, setBrainError] = useState<string | null>(null);

  // social
  const [yt, setYt] = useState("");
  const [ig, setIg] = useState("");
  const [tt, setTt] = useState("");

  const [savingIdentity, setSavingIdentity] = useState(false);
  const [savingSocial, setSavingSocial] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const watchRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const primaryRef = useRef<() => void>(() => {});

  // pre-fill name + account from the local Claude config (already merged into
  // /api/profile, which falls back name → account.displayName for us).
  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d) => {
        setName(d.name || "");
        setBio(d.bio || "");
        setAccount(d.account || null);
      })
      .catch(() => {})
      .finally(() => setAccountLoaded(true));
    // Reflect any state the operator already has (so a re-run after a version
    // bump shows real values, not empty fields). Harmless on a fresh machine.
    fetch("/api/brain")
      .then((r) => r.json())
      .then((b) => {
        if (b.fileCount) setFileCount(b.fileCount);
        if (b.hasGraph) setBuildDone(true);
      })
      .catch(() => {});
    fetch("/api/social")
      .then((r) => r.json())
      .then((s) => {
        const h = s.handles || {};
        if (h.youtube) setYt(h.youtube);
        if (h.instagram) setIg(h.instagram);
        if (h.tiktok) setTt(h.tiktok);
      })
      .catch(() => {});
    return () => watchRef.current?.abort();
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [buildLog]);

  // Enter advances the current step (except inside a textarea, where it's a newline).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      if (e.isComposing || e.keyCode === 229) return; // don't hijack IME confirm
      const t = e.target as HTMLElement | null;
      if (t && t.tagName === "TEXTAREA") return;
      e.preventDefault();
      primaryRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── persistence handlers (reuse the existing dashboard endpoints) ────────
  const saveIdentity = async () => {
    setSavingIdentity(true);
    try {
      await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), bio: bio.trim() }),
      });
    } catch {
      /* best-effort; user can edit later on the dashboard */
    } finally {
      setSavingIdentity(false);
      setStep(2); // → Claude link
    }
  };

  const ingest = async (files: { file: File; path: string }[]) => {
    const payload = await toPayload(files);
    if (!payload.length) {
      setBrainError("No supported notes (.md, .txt, …) found in that drop.");
      return;
    }
    setBrainError(null);
    setUploading(true);
    try {
      const r = await fetch("/api/brain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: payload }),
      });
      const j = await r.json();
      if (!j.ok) setBrainError(j.error || "Upload failed");
      else {
        setFileCount(j.fileCount);
        setBuildDone(false);
      }
    } catch {
      setBrainError("Upload failed");
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
          if (Array.isArray(d.lines) && d.lines.length) setBuildLog((p) => [...p, ...d.lines].slice(-120));
          if (d.done) {
            setBuilding(false);
            if (d.status === "error") setBrainError(d.error || "Build failed");
            else setBuildDone(true);
          }
        }
      }
    } catch (e: unknown) {
      if ((e as { name?: string })?.name !== "AbortError") setBuilding(false);
    }
  };

  const startBuild = async () => {
    setBrainError(null);
    setBuildLog([]);
    setBuilding(true);
    try {
      await fetch("/api/brain/graphify", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    } catch {
      /* ignore */
    }
    watchBuild();
  };

  const saveSocial = async () => {
    const patch: Record<string, string> = {};
    if (yt.trim()) patch.youtube = yt.trim();
    if (ig.trim()) patch.instagram = ig.trim();
    if (tt.trim()) patch.tiktok = tt.trim();
    if (Object.keys(patch).length) {
      setSavingSocial(true);
      try {
        await fetch("/api/social", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
      } catch {
        /* best-effort */
      } finally {
        setSavingSocial(false);
      }
    }
    setStep(5);
  };

  const finish = async () => {
    setFinishing(true);
    setFinishError(null);
    try {
      const r = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboardingComplete: true }),
      });
      const d = await r.json();
      if (r.ok && d?.onboardedAt) {
        // setup persisted — enter the console. A full navigation guarantees the
        // (now force-dynamic) root re-evaluates the gate and renders the dashboard.
        window.location.assign("/");
      } else {
        setFinishError("Couldn't save setup — your ~/.nerve-center folder may be read-only.");
        setFinishing(false);
      }
    } catch {
      setFinishError("Couldn't reach the local server. Please try again.");
      setFinishing(false);
    }
  };

  const socialCount = [yt, ig, tt].filter((v) => v.trim()).length;
  const planBase = account ? account.plan.replace(/^Claude\s+/i, "").replace(/\s*\d+×$/, "") : "";

  // keep the Enter-key handler pointed at the right action for this step
  primaryRef.current =
    step === 0 ? () => setStep(1)
    : step === 1 ? () => { if (!savingIdentity) saveIdentity(); }
    : step === 2 ? () => setStep(3)
    : step === 3 ? () => setStep(4)
    : step === 4 ? () => { if (!savingSocial) saveSocial(); }
    : () => { if (!finishing) finish(); };

  // ── step bodies ──────────────────────────────────────────────────────────
  const Footer = ({
    onBack,
    onSkip,
    onNext,
    nextLabel,
    busy,
  }: {
    onBack?: () => void;
    onSkip?: () => void;
    onNext: () => void;
    nextLabel: string;
    busy?: boolean;
  }) => (
    <div className="mt-7 flex items-center gap-3">
      {onBack ? (
        <button onClick={onBack} className={GHOST}>
          ◂ Back
        </button>
      ) : (
        <span />
      )}
      <span className="leader" />
      {onSkip && (
        <button onClick={onSkip} className={GHOST}>
          Skip
        </button>
      )}
      <button onClick={onNext} disabled={busy} className={PRIMARY}>
        {busy ? "Saving…" : nextLabel}
        {!busy && <span className="transition-transform group-hover:translate-x-0.5">▸</span>}
      </button>
    </div>
  );

  const renderStep = () => {
    switch (step) {
      // ── 0 · BOOT ──────────────────────────────────────────────────────
      case 0:
        return (
          <div className="flex flex-col items-center px-8 py-12 text-center">
            <BrainMark className="h-14 w-14 text-accent glow-accent" />
            <h1 className="mt-6 font-display text-3xl font-bold uppercase tracking-[0.28em] text-ink">
              Agentic OS
            </h1>
            <div className="mt-1 label">Nerve Center · Operator Console</div>
            <div className="mx-auto mt-7 max-w-md">
              <div className="mb-3 flex items-center justify-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-online pulse" />
                <span className="label text-online">First boot detected</span>
              </div>
              <p className="text-[12px] leading-relaxed text-ink-2">
                Everything here runs on <span className="text-ink">your machine</span>, on{" "}
                <span className="text-ink">your Claude subscription</span>. No API keys, no metered
                charges — and nothing ever leaves this device. Let&apos;s tune the console to you.
              </p>
            </div>
            <div className="mt-7 flex items-center gap-2 label">
              <span>6 steps</span>
              <span className="text-ink-faint">·</span>
              <span>~90 seconds</span>
              <span className="text-ink-faint">·</span>
              <span>skip anything optional</span>
            </div>
            <button onClick={() => setStep(1)} className={cn(PRIMARY, "mt-8")}>
              Initialize <span className="transition-transform group-hover:translate-x-0.5">▸</span>
            </button>
          </div>
        );

      // ── 1 · IDENTITY ──────────────────────────────────────────────────
      case 1:
        return (
          <div className="px-7 py-6">
            <p className="mb-6 text-[12px] leading-relaxed text-ink-dim">
              Who&apos;s at the controls? This is the operator the whole console is tuned to.
            </p>
            <div className="flex items-start gap-4">
              <div className="relative flex h-16 w-16 shrink-0 items-center justify-center border border-accent-line bg-accent-soft">
                <Corners accent />
                <span className="font-display text-2xl font-bold tracking-wider text-accent glow-accent">
                  {initials(name)}
                </span>
              </div>
              <div className="min-w-0 flex-1 space-y-4">
                <div>
                  <label htmlFor="onb-name" className="label">
                    Name
                  </label>
                  <input
                    id="onb-name"
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={80}
                    placeholder="Your name"
                    className="mt-1 w-full border-0 border-b border-line bg-transparent px-1.5 pb-1.5 font-display text-xl font-semibold text-ink transition-colors placeholder:text-ink-faint hover:border-ink-dim focus:border-accent-line focus:outline-none"
                  />
                  {account?.email && (
                    <div className="mt-1.5 px-1.5 font-mono text-[10px] text-ink-dim">{account.email}</div>
                  )}
                </div>
                <div>
                  <div className="flex items-baseline justify-between">
                    <label htmlFor="onb-bio" className="label">
                      Role / one-liner
                    </label>
                    <span className="tnum text-[9px] text-ink-faint">{bio.length}/240</span>
                  </div>
                  <textarea
                    id="onb-bio"
                    value={bio}
                    onChange={(e) => setBio(e.target.value.slice(0, 240))}
                    rows={2}
                    placeholder="e.g. Founder at CortexTools — building agentic content systems."
                    className="mt-1 w-full resize-none border border-line bg-base-2 px-3 py-2 font-mono text-[12px] leading-relaxed text-ink transition-colors placeholder:text-ink-faint hover:border-line-strong focus:border-accent-line focus:outline-none"
                  />
                </div>
              </div>
            </div>
            <Footer onBack={() => setStep(0)} onNext={saveIdentity} nextLabel="Continue" busy={savingIdentity} />
          </div>
        );

      // ── 2 · CLAUDE LINK ───────────────────────────────────────────────
      case 2:
        return (
          <div className="px-7 py-6">
            {account ? (
              <>
                <Panel accent className="p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="label text-ink-2">Detected account</span>
                    <Chip tone="online" pulse>
                      Connected
                    </Chip>
                  </div>
                  <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
                    <Stat
                      label="Plan"
                      glow="accent"
                      value={
                        account.multiplier > 1 ? (
                          <>
                            {planBase.toUpperCase()} <span className="text-accent">{account.multiplier}×</span>
                          </>
                        ) : (
                          account.plan.replace(/^Claude\s+/i, "").toUpperCase()
                        )
                      }
                    />
                    <Stat label="Member since" value={monthYear(account.memberSince)} />
                    <Stat label="Billing" value="$0" unit="api cost" />
                  </div>
                  {account.email && (
                    <div className="mt-4 font-mono text-[10px] text-ink-dim">
                      {account.email}
                      {account.org ? ` · ${account.org}` : ""}
                    </div>
                  )}
                </Panel>
                <p className="mt-5 text-[12px] leading-relaxed text-ink-2">
                  <span className="text-accent">▸</span> Nerve Center runs every agent on your existing
                  Claude plan — it reads usage straight from <span className="text-ink">~/.claude</span>.
                  No API key, no per-token charges. You&apos;re already wired in.
                </p>
              </>
            ) : (
              <Panel className="p-5">
                <div className="mb-3 flex items-center justify-between">
                  <span className="label text-ink-2">Claude account</span>
                  <Chip tone="dim">Not linked</Chip>
                </div>
                <p className="text-[12px] leading-relaxed text-ink-2">
                  {accountLoaded
                    ? "No Claude account detected yet. Run "
                    : "Checking your local Claude config… "}
                  {accountLoaded && (
                    <>
                      <span className="font-mono text-accent">claude</span> in your terminal and sign in,
                      then relaunch — the console will pick it up automatically. You can continue setup
                      either way.
                    </>
                  )}
                </p>
              </Panel>
            )}
            <Footer onBack={() => setStep(1)} onNext={() => setStep(3)} nextLabel="Looks good" />
          </div>
        );

      // ── 3 · SECOND BRAIN ──────────────────────────────────────────────
      case 3:
        return (
          <div className="px-7 py-6">
            <p className="mb-5 text-[12px] leading-relaxed text-ink-dim">
              Point the console at a folder of notes and it maps them into a live{" "}
              <span className="text-accent">knowledge graph</span>. Read locally, with{" "}
              <span className="text-ink">/graphify</span> — nothing leaves your machine. Totally optional.
            </p>

            {brainError && <div className="mb-3 text-[11px] text-accent">{brainError}</div>}

            {building ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-accent pulse" />
                  <span className="label text-ink-2">Mapping your second brain — ~1–3 min</span>
                  <span className="leader" />
                  <span className="label text-ink-faint">keeps running in the background</span>
                </div>
                <div
                  ref={logRef}
                  className="rail-scroll h-[150px] overflow-y-auto border border-line-soft bg-base px-4 py-3 font-mono text-[11px] leading-relaxed text-ink-dim"
                >
                  {buildLog.length === 0 ? (
                    <span className="text-ink-faint">Starting graphify…</span>
                  ) : (
                    buildLog.map((l, i) => (
                      <div
                        key={i}
                        className={cn("break-words", l.startsWith("→") && "text-cool", l.startsWith("✓") && "text-online")}
                      >
                        {l}
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : fileCount > 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 border border-line-strong bg-base-2 px-6 py-8 text-center">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-online" />
                  <span className="font-display text-sm font-semibold uppercase tracking-[0.16em] text-ink">
                    {fileCount} notes loaded
                  </span>
                </div>
                {buildDone ? (
                  <span className="label text-online">Knowledge graph mapped ✓</span>
                ) : (
                  <>
                    <span className="max-w-md text-[11px] leading-relaxed text-ink-dim">
                      Map them into a graph now (~1–3 min on your Claude plan), or do it later from the
                      dashboard.
                    </span>
                    <button onClick={startBuild} className={cn(PRIMARY, "mt-1")}>
                      Build graph <span className="transition-transform group-hover:translate-x-0.5">▸</span>
                    </button>
                  </>
                )}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-1 text-[10px] uppercase tracking-[0.16em] text-ink-faint underline-offset-4 hover:text-ink-dim hover:underline"
                >
                  Choose a different folder
                </button>
              </div>
            ) : (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-2 border border-dashed px-6 text-center transition-colors",
                  dragOver
                    ? "border-accent-line bg-accent-soft"
                    : "border-line-strong hover:border-accent-line hover:bg-accent-soft"
                )}
              >
                <span className="font-display text-sm font-semibold uppercase tracking-[0.16em] text-ink-2">
                  {uploading ? "Uploading…" : "Drop your second brain"}
                </span>
                <span className="max-w-md text-[11px] leading-relaxed text-ink-dim">
                  Drag a folder of notes here, or click to choose one. Markdown, text & JSON are read
                  locally.
                </span>
                <span className="mt-1 text-[10px] uppercase tracking-[0.16em] text-accent">Choose folder ▸</span>
              </div>
            )}

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

            <Footer
              onBack={() => setStep(2)}
              onSkip={fileCount === 0 ? () => setStep(4) : undefined}
              onNext={() => setStep(4)}
              nextLabel="Continue"
            />
          </div>
        );

      // ── 4 · AUDIENCE SIGNALS ──────────────────────────────────────────
      case 4:
        return (
          <div className="px-7 py-6">
            <p className="mb-5 text-[12px] leading-relaxed text-ink-dim">
              Wire up your channels and the dashboard tracks follower counts — free, no API keys. Every
              field is optional.
            </p>
            <div className="space-y-4">
              {(
                [
                  ["YouTube", yt, setYt, "@handle or channel URL"],
                  ["Instagram", ig, setIg, "@username"],
                  ["TikTok", tt, setTt, "@username"],
                ] as const
              ).map(([label, val, set, ph]) => {
                const id = `onb-${label.toLowerCase()}`;
                return (
                  <div key={label} className="flex items-center gap-4">
                    <label htmlFor={id} className="label w-20 shrink-0">
                      {label}
                    </label>
                    <input
                      id={id}
                      value={val}
                      onChange={(e) => set(e.target.value)}
                      placeholder={ph}
                      className="w-full border-0 border-b border-line bg-transparent px-1.5 pb-1.5 font-mono text-[13px] text-ink transition-colors placeholder:text-ink-faint hover:border-ink-dim focus:border-accent-line focus:outline-none"
                    />
                  </div>
                );
              })}
            </div>
            <Footer
              onBack={() => setStep(3)}
              onSkip={() => setStep(5)}
              onNext={saveSocial}
              nextLabel="Continue"
              busy={savingSocial}
            />
          </div>
        );

      // ── 5 · SYSTEM READY ──────────────────────────────────────────────
      default:
        return (
          <div className="flex flex-col items-center px-8 py-10 text-center">
            <BrainMark className="h-12 w-12 text-accent glow-accent" />
            <div className="mt-4 flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-online pulse" />
              <h2 className="font-display text-xl font-bold uppercase tracking-[0.24em] text-ink">
                All systems nominal
              </h2>
            </div>

            <div className="mt-8 flex w-full flex-wrap items-end justify-center gap-x-10 gap-y-5">
              <Stat label="Operator" value={(name.trim() || "—").split(/\s+/)[0]} />
              {account && (
                <Stat
                  label="Plan"
                  glow="accent"
                  value={
                    account.multiplier > 1 ? (
                      <>
                        {planBase.toUpperCase()} <span className="text-accent">{account.multiplier}×</span>
                      </>
                    ) : (
                      account.plan.replace(/^Claude\s+/i, "").toUpperCase()
                    )
                  }
                />
              )}
              {fileCount > 0 && <Stat label="Brain" glow="accent" value={fileCount} unit="notes" />}
              {socialCount > 0 && <Stat label="Signals" value={socialCount} unit="linked" />}
            </div>

            <div className="mt-8 flex flex-wrap justify-center gap-2">
              <Chip tone="online">Identity set</Chip>
              <Chip tone={account ? "online" : "dim"}>{account ? "Claude linked" : "Claude pending"}</Chip>
              {fileCount > 0 && <Chip tone={buildDone || building ? "online" : "accent"}>Brain {buildDone ? "mapped" : building ? "mapping" : "loaded"}</Chip>}
              {socialCount > 0 && <Chip tone="online">Signals wired</Chip>}
            </div>

            {finishError && <div className="mt-6 text-[11px] text-accent">{finishError}</div>}

            <button onClick={finish} disabled={finishing} className={cn(PRIMARY, "mt-9 px-7 py-3")}>
              {finishing ? "Entering…" : "Enter Nerve Center"}
              {!finishing && <span className="transition-transform group-hover:translate-x-0.5">▸</span>}
            </button>
          </div>
        );
    }
  };

  const isHero = step === 0 || step === 5;

  return (
    <main className="flex min-h-screen w-full items-center justify-center p-5 sm:p-8">
      <div className="w-full max-w-[680px]">
        {/* brand bar */}
        <div className="mb-3 flex items-center gap-2 px-1">
          <BrainMark className="h-4 w-4 text-accent" />
          <span className="label text-ink-2">Agentic OS</span>
          <span className="leader" />
          <span className="label text-ink-faint">Setup · v0.1.0</span>
        </div>

        <Panel accent className="overflow-hidden">
          {/* header + stepper (hidden on the hero boot screen for drama) */}
          {!isHero && (
            <>
              <div className="px-7 pt-5 pb-3">
                <SectionHeader
                  index={`${String(step).padStart(2, "0")} //`}
                  title={STEPS[step].title}
                  right={<span className="label text-ink-faint">Step {step} / {STEPS.length - 1}</span>}
                />
              </div>
              <Hair />
            </>
          )}

          <div key={step} className="rise">
            {renderStep()}
          </div>

          {/* progress segments */}
          <div
            className="flex gap-1 px-7 pb-5 pt-1"
            role="progressbar"
            aria-label="Setup progress"
            aria-valuemin={1}
            aria-valuemax={STEPS.length}
            aria-valuenow={step + 1}
          >
            {STEPS.map((s, i) => (
              <div
                key={s.id}
                aria-hidden="true"
                className={cn(
                  "h-0.5 flex-1 transition-colors",
                  i < step ? "bg-accent-line" : i === step ? "bg-accent glow-accent" : "bg-line"
                )}
              />
            ))}
          </div>
        </Panel>

        <div className="mt-3 px-1 text-center label text-ink-faint">
          Local-first · Runs on your Claude subscription · Nothing leaves this device
        </div>
      </div>
    </main>
  );
}
