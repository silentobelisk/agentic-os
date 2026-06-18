"use client";

import { useEffect, useRef, useState } from "react";
import type { Period, UsageResponse } from "@/lib/types";
import { fmtTokens, fmtInt, fmtPct } from "@/lib/format";
import { Panel, SectionHeader, Hair } from "./hud";
import UsageChart from "./UsageChart";
import PlanUsage from "./PlanUsage";

const PERIODS: { key: Period; label: string }[] = [
  { key: "24h", label: "24H" },
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "all", label: "ALL" },
];

function PeriodToggle({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="flex items-center border border-line" role="group" aria-label="Throughput period">
      {PERIODS.map((p) => (
        <button
          key={p.key}
          onClick={() => onChange(p.key)}
          aria-pressed={value === p.key}
          title={`Show ${p.label} of throughput`}
          className={`px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] transition-colors ${
            value === p.key
              ? "bg-accent-soft text-accent"
              : "text-ink-dim hover:bg-panel-2 hover:text-ink"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

function Tile({
  label,
  value,
  unit,
  sub,
  glow,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  glow?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 px-4 py-3">
      <span className="label">{label}</span>
      <div className="flex items-baseline gap-1">
        <span
          className={`tnum font-display text-[26px] font-semibold leading-none ${
            glow ? "glow-accent text-accent" : "text-ink"
          }`}
        >
          {value}
        </span>
        {unit && <span className="label text-ink-dim">{unit}</span>}
      </div>
      {sub && <span className="truncate text-[10px] tracking-wide text-ink-dim">{sub}</span>}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4 p-5">
      <div className="grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="relative h-[72px] overflow-hidden bg-panel-2 sweep" />
        ))}
      </div>
      <div className="relative h-[260px] overflow-hidden bg-panel-2 sweep" />
    </div>
  );
}

export default function UsagePanel() {
  const [period, setPeriod] = useState<Period>("7d");
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    fetch(`/api/usage?period=${period}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
      .then((d: UsageResponse) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        if (e.name === "AbortError") return;
        setError(String(e.message || e));
        setLoading(false);
      });
    return () => ac.abort();
  }, [period]);

  const t = data?.totals;

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-col gap-0">
        <div className="px-5 pt-4 pb-3">
          <SectionHeader index="02 //" title="Plan Usage" />
        </div>
        <Hair />

        {/* hero: subscription plan limits (5-hour + weekly) */}
        <PlanUsage />
        <Hair />

        {/* throughput subsection — token detail over the selected period */}
        <div className="flex items-center gap-3 px-5 pt-4 pb-1">
          <h3 className="shrink-0 font-display text-[12px] font-semibold uppercase tracking-[0.22em] text-ink-2">
            Throughput
          </h3>
          <span className="leader" />
          <PeriodToggle value={period} onChange={setPeriod} />
        </div>

        {loading && !data ? (
          <Skeleton />
        ) : error ? (
          <div className="p-6 text-[12px] text-accent">
            Could not load usage — {error}
          </div>
        ) : (
          t &&
          data && (
            <div className={`rise transition-opacity duration-200 ${loading ? "opacity-40" : "opacity-100"}`}>
              {/* stat tiles */}
              <div className="grid grid-cols-2 divide-x divide-y divide-line border-b border-line sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
                <Tile
                  label="Total Tokens"
                  value={fmtTokens(t.tokens)}
                  glow
                  sub={`${fmtInt(t.messages)} model calls`}
                />
                <Tile label="Output" value={fmtTokens(t.output)} />
                <Tile label="Input" value={fmtTokens(t.input)} />
                <Tile
                  label="Cache Read"
                  value={fmtTokens(t.cacheRead)}
                  sub={`${fmtPct(t.cacheHitRate)} hit rate`}
                />
                <Tile label="Sessions" value={fmtInt(t.sessions)} />
              </div>

              {/* chart */}
              <div className="px-3 pt-4 pb-2">
                <UsageChart buckets={data.buckets} bucketMs={data.bucketMs} />
              </div>

              {/* footer: model split + context */}
              <Hair />
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3 text-[10px] uppercase tracking-[0.14em] text-ink-dim">
                <span className="text-ink-faint">MODELS</span>
                {data.models.slice(0, 3).map((m) => (
                  <span key={m.model} className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 bg-accent" />
                    <span className="text-ink-2">{m.model.replace("claude-", "")}</span>
                    <span className="tnum">{fmtTokens(m.tokens)}</span>
                  </span>
                ))}
                <span className="leader hidden sm:block" />
                {data.busiestHour && (
                  <span>
                    PEAK HOUR{" "}
                    <span className="text-ink-2 tnum">
                      {String(data.busiestHour.hour).padStart(2, "0")}:00
                    </span>
                  </span>
                )}
                {data.topProjects[0] && (
                  <span className="hidden md:inline">
                    TOP PROJECT <span className="text-ink-2">{data.topProjects[0].name}</span>
                  </span>
                )}
              </div>
            </div>
          )
        )}
      </div>
    </Panel>
  );
}
