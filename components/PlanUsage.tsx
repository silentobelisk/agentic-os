"use client";

import { useEffect, useRef, useState } from "react";
import type { PlanUsageResponse, PlanWindow } from "@/lib/types";
import { Tag, cn } from "./hud";

function resetLabel(resetAt: number | null, now: number): string {
  if (!resetAt) return "READY";
  const d = resetAt - now;
  if (d <= 0) return "NOW";
  const h = Math.floor(d / 3_600_000);
  const m = Math.floor((d % 3_600_000) / 60_000);
  const s = Math.floor((d % 60_000) / 1000);
  if (d < 3_600_000) return `IN ${m}M ${String(s).padStart(2, "0")}S`;
  if (d < 86_400_000) return `IN ${h}H ${String(m).padStart(2, "0")}M`;
  const days = Math.floor(d / 86_400_000);
  const date = new Date(resetAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${date} · ${days}D`;
}

function Bar({ w, now, sub }: { w: PlanWindow; now: number; sub: string }) {
  const pct = w.pct;
  const over = pct > 1;
  const clamped = Math.min(Math.max(pct, 0), 1);
  const pctLeft = Math.max(0, Math.round((1 - pct) * 100));
  const fill = over ? "bg-[#ff5a4a]" : pct >= 0.85 ? "bg-[#ffb27a]" : "bg-accent";
  const numColor = over ? "text-[#ff5a4a]" : "text-accent";

  return (
    <div className="space-y-2" title={`${w.label} — ${sub} · ${pctLeft}% of your plan budget remaining`}>
      <div className="flex items-baseline justify-between">
        <span className="label text-ink-2" style={{ letterSpacing: "0.16em" }}>
          {w.label}
        </span>
        <div className="flex items-baseline gap-2">
          <span className={cn("tnum font-display text-2xl font-semibold leading-none glow-accent", numColor)}>
            {Math.round(pct * 100)}%
          </span>
          {over && <span className="label text-[#ff5a4a]">OVER LIMIT</span>}
        </div>
      </div>

      <div
        className="relative h-2.5 w-full overflow-hidden border border-line bg-base-2"
        role="progressbar"
        aria-label={`${w.label} plan usage`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(Math.round(pct * 100), 100)}
        aria-valuetext={`${Math.round(pct * 100)} percent used, ${pctLeft} percent left`}
      >
        <div
          className={cn("h-full transition-[width] duration-700 ease-out", fill)}
          style={{ width: `${clamped * 100}%` }}
        />
        <div
          className="ticks pointer-events-none absolute inset-0 opacity-30"
          style={{ backgroundSize: "10% 100%" }}
        />
      </div>

      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-ink-faint">
        <span>{w.active ? sub : "IDLE — NO ACTIVITY"}</span>
        <span className={cn(!!w.resetAt && w.resetAt - now < 3_600_000 && "text-accent")}>
          RESETS {resetLabel(w.resetAt, now)}
        </span>
      </div>
    </div>
  );
}

function BarSkeleton() {
  return (
    <div className="space-y-2">
      <div className="flex justify-between">
        <div className="h-3 w-24 bg-panel-2" />
        <div className="h-5 w-16 bg-panel-2" />
      </div>
      <div className="relative h-2.5 w-full overflow-hidden bg-panel-2 sweep" />
    </div>
  );
}

export default function PlanUsage() {
  const [data, setData] = useState<PlanUsageResponse | null>(null);
  const [now, setNow] = useState<number>(0);
  const [err, setErr] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    fetch("/api/plan", { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
      .then((d: PlanUsageResponse) => setData(d))
      .catch((e) => {
        if (e?.name !== "AbortError") setErr(true);
      });
  };

  useEffect(() => {
    setNow(Date.now());
    load();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const refresh = setInterval(load, 60_000);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const plan = data?.plan;

  return (
    <div className="px-5 py-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="label text-ink-dim">Subscription</span>
          {plan ? (
            <span className="border border-accent-line bg-accent-soft px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
              {plan.name}
            </span>
          ) : (
            <span className="h-6 w-28 bg-panel-2" />
          )}
          {plan && plan.multiplier !== 1 && (
            <span className="label text-ink-faint">{plan.multiplier}× base capacity</span>
          )}
          {plan && !plan.detected && <Tag>plan unverified</Tag>}
        </div>
        <div className="flex items-center gap-2">
          {data?.calibrated ? (
            <span className="label text-online">calibrated</span>
          ) : (
            <span className="label text-ink-faint">estimated budget</span>
          )}
        </div>
      </div>

      {err ? (
        <div className="py-4 text-[12px] text-accent">Could not read plan — is this signed into Claude Code?</div>
      ) : !data ? (
        <div className="grid gap-5 sm:grid-cols-2">
          <BarSkeleton />
          <BarSkeleton />
        </div>
      ) : (
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <Bar w={data.session} now={now} sub="5-hour rolling window" />
          <Bar w={data.weekly} now={now} sub="7-day plan window" />
        </div>
      )}
    </div>
  );
}
