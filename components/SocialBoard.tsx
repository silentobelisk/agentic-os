"use client";

import { useEffect, useRef, useState } from "react";
import type { SocialBoardResponse, SocialStat, SocialHandles } from "@/lib/types";
import { fmtCount, fmtDelta, ago } from "@/lib/format";
import { Panel, SectionHeader, Hair, cn } from "./hud";

const PLATFORM_LABEL: Record<string, string> = {
  youtube: "YOUTUBE",
  instagram: "INSTAGRAM",
  tiktok: "TIKTOK",
};

function StatCard({ a, now }: { a: SocialStat; now: number }) {
  const stale = a.fetchedAt != null && !a.ok;
  const pending = a.primary == null;
  return (
    <a
      href={a.url || undefined}
      target={a.url ? "_blank" : undefined}
      rel="noreferrer"
      title={a.error ? `${a.displayName} — ${a.error}` : `${a.displayName} — open profile ↗`}
      className={cn(
        "group card-underline relative flex flex-col gap-2.5 border border-line bg-panel p-3.5 transition-all duration-200",
        a.url && "hover:-translate-y-0.5 hover:border-accent-line hover:bg-accent-soft active:translate-y-0"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="label" style={{ letterSpacing: "0.16em" }}>
          {PLATFORM_LABEL[a.platform]}
        </span>
        {a.delta != null && a.delta !== 0 ? (
          <span className={cn("tnum text-[10px] font-semibold tracking-wide", a.delta > 0 ? "text-online" : "text-[#ff5a4a]")}>
            {fmtDelta(a.delta)}
          </span>
        ) : (
          a.url && <span className="text-[11px] text-ink-dim transition-colors group-hover:text-accent">↗</span>
        )}
      </div>

      <div className="flex items-baseline gap-1.5">
        <span
          className={cn(
            "tnum font-display text-[26px] font-semibold leading-none",
            pending ? "text-ink-dim" : "glow-accent text-accent"
          )}
        >
          {pending ? (a.ok ? "—" : "···") : fmtCount(a.primary)}
        </span>
        <span className="label text-ink-dim">{a.primaryLabel}</span>
      </div>

      <p className="truncate text-[12px] font-medium text-ink-2 group-hover:text-ink">{a.displayName}</p>

      {a.secondary.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] uppercase tracking-[0.1em] text-ink-faint">
          {a.secondary.map((s) => (
            <span key={s.label} className="tnum">
              {fmtCount(s.value)} {s.label}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-[10px] uppercase tracking-[0.1em] text-ink-faint">
        <span className="truncate">@{a.handle}</span>
        <span className={cn("shrink-0", stale && "text-[#ff5a4a]")}>
          {pending && !a.ok ? "checking…" : stale ? "stale" : a.fetchedAt ? `${ago(a.fetchedAt, now)} ago` : ""}
        </span>
      </div>
    </a>
  );
}

export default function SocialBoard() {
  const [data, setData] = useState<SocialBoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [yt, setYt] = useState("");
  const [ig, setIg] = useState("");
  const [tt, setTt] = useState("");
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const apply = (d: SocialBoardResponse) => {
    setData(d);
    setYt(d.handles.youtube || "");
    setIg(d.handles.instagram || "");
    setTt(d.handles.tiktok || "");
  };

  const load = (refresh: boolean) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    if (refresh) setRefreshing(true);
    fetch(`/api/social${refresh ? "?refresh=1" : ""}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((d: SocialBoardResponse) => {
        apply(d);
        setLoading(false);
        setRefreshing(false);
      })
      .catch((e) => {
        if (e?.name !== "AbortError") {
          setLoading(false);
          setRefreshing(false);
        }
      });
  };

  useEffect(() => {
    setNow(Date.now());
    fetch("/api/social")
      .then((r) => r.json())
      .then((d: SocialBoardResponse) => {
        apply(d);
        setLoading(false);
        const hasHandles = !!(d.handles.youtube || d.handles.instagram || d.handles.tiktok);
        if (!hasHandles) setEditing(true);
        // auto-refresh if any account is stale / never fetched
        const stale = d.accounts.some((a) => a.fetchedAt == null || Date.now() - a.fetchedAt > 30 * 60_000);
        if (hasHandles && stale) load(true);
      })
      .catch(() => setLoading(false));
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(t);
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const body: SocialHandles = { youtube: yt, instagram: ig, tiktok: tt };
      const r = await fetch("/api/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      apply(await r.json());
      setEditing(false);
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  const accounts = data?.accounts || [];
  const hasHandles = !!(data && (data.handles.youtube || data.handles.instagram || data.handles.tiktok));

  const input = (label: string, value: string, set: (v: string) => void, ph: string) => (
    <div className="space-y-1.5">
      <label className="label">{label}</label>
      <input
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={ph}
        className="w-full border border-line bg-base-2 px-3 py-2 font-mono text-[12px] text-ink transition-colors placeholder:text-ink-faint hover:border-line-strong focus:border-accent-line focus:outline-none"
      />
    </div>
  );

  return (
    <Panel className="overflow-hidden">
      <div className="px-5 pt-4 pb-3">
        <SectionHeader
          index="04 //"
          title="Social Signal"
          right={
            <div className="flex items-center gap-2">
              {data?.total != null && (
                <span className="hidden text-[10px] uppercase tracking-[0.16em] text-ink-dim sm:inline">
                  {fmtCount(data.total)} total audience
                </span>
              )}
              <button
                onClick={() => setEditing((e) => !e)}
                title="Edit your handles"
                className={cn(
                  "border border-line px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] transition-colors",
                  editing ? "bg-accent-soft text-accent" : "text-ink-dim hover:border-line-strong hover:bg-panel-2 hover:text-ink"
                )}
              >
                {editing ? "Close" : "Edit"}
              </button>
              {hasHandles && (
                <button
                  onClick={() => load(true)}
                  title="Pull fresh follower counts"
                  className="flex items-center gap-1.5 border border-line px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-ink-dim transition-colors hover:border-line-strong hover:bg-panel-2 hover:text-ink"
                >
                  {refreshing && <span className="h-1.5 w-1.5 rounded-full bg-accent pulse" />}
                  Refresh
                </button>
              )}
            </div>
          }
        />
      </div>
      <Hair />

      <div className="p-5">
        {editing ? (
          <div className="rise space-y-4">
            <p className="text-[11px] leading-relaxed text-ink-dim">
              Track your own follower counts — free, no API keys. Enter a handle or full profile URL.
              Counts are fetched from your machine and cached.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {input("YouTube · @handle or channel URL", yt, setYt, "@yourhandle")}
              {input("Instagram · username", ig, setIg, "@yourhandle")}
              {input("TikTok · username", tt, setTt, "@yourhandle")}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center gap-2 border border-accent-line bg-accent-soft px-3.5 py-2 text-[10px] uppercase tracking-[0.16em] text-accent transition-colors hover:bg-accent hover:text-base disabled:opacity-40"
              >
                {saving ? (
                  <>
                    <span className="h-1.5 w-1.5 bg-accent pulse" /> Fetching
                  </>
                ) : (
                  "Save & Track"
                )}
              </button>
              {hasHandles && (
                <button
                  onClick={() => setEditing(false)}
                  className="border border-line px-3.5 py-2 text-[10px] uppercase tracking-[0.16em] text-ink-dim transition-colors hover:text-ink"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        ) : loading && !data ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="relative h-[150px] overflow-hidden bg-panel-2 sweep" />
            ))}
          </div>
        ) : accounts.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((a) => (
              <StatCard key={a.platform} a={a} now={now} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <span className="font-display text-sm font-semibold uppercase tracking-[0.16em] text-ink-2">
              Track your channels
            </span>
            <span className="max-w-md text-[11px] leading-relaxed text-ink-dim">
              Add your YouTube, Instagram, and TikTok handles to see live follower counts and growth —
              free, no API keys, fetched locally.
            </span>
            <button
              onClick={() => setEditing(true)}
              className="mt-1 border border-accent-line bg-accent-soft px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-accent transition-colors hover:bg-accent hover:text-base"
            >
              Add handles ▸
            </button>
          </div>
        )}
      </div>
    </Panel>
  );
}
