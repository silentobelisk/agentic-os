"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IndustryResponse, SignalCard } from "@/lib/types";
import { fmtTokens } from "@/lib/format";
import { Panel, SectionHeader, Hair, Corners, cn } from "./hud";

function Card({ card }: { card: SignalCard }) {
  const isMetric = card.kind === "metric";
  const Wrapper = card.url ? "a" : "div";
  return (
    <Wrapper
      {...(card.url ? { href: card.url, target: "_blank", rel: "noreferrer" } : {})}
      title={card.url ? `${card.title} — open source ↗` : card.title}
      className={cn(
        "group relative flex flex-col gap-2.5 border bg-panel p-3.5 transition-all duration-200",
        card.url && "card-underline hover:-translate-y-0.5 hover:bg-accent-soft hover:border-accent-line active:translate-y-0",
        card.accent ? "border-accent-line" : "border-line"
      )}
    >
      {isMetric && <Corners accent />}
      <div className="flex items-center justify-between">
        <span className="label" style={{ letterSpacing: "0.14em" }}>
          {card.source}
        </span>
        {card.url && (
          <span className="text-[12px] text-ink-dim transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent">
            ↗
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-1.5">
        <span
          className={cn(
            "tnum font-display font-semibold leading-none",
            isMetric ? "text-[30px]" : "text-[24px]",
            card.accent ? "glow-accent text-accent" : "text-ink"
          )}
        >
          {card.value != null ? fmtTokens(card.value) : "—"}
        </span>
        <span className="label text-ink-dim">{card.valueLabel}</span>
      </div>

      <p className="line-clamp-2 text-[12px] font-medium leading-snug text-ink-2 group-hover:text-ink">
        {card.title}
      </p>

      <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-[10px] uppercase tracking-[0.1em] text-ink-faint">
        <span className="truncate">{card.sub || ""}</span>
        <span className="shrink-0">{card.meta || ""}</span>
      </div>
    </Wrapper>
  );
}

export default function IndustryBoard() {
  const [data, setData] = useState<IndustryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback((force = false) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    fetch(`/api/industry${force ? "?force=1" : ""}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((d: IndustryResponse) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        if (e?.name !== "AbortError") setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  return (
    <Panel className="overflow-hidden">
      <div className="px-5 pt-4 pb-3">
        <SectionHeader
          index="05 //"
          title="Industry Signal"
          right={
            <div className="flex items-center gap-2">
              <span className="hidden text-[10px] uppercase tracking-[0.16em] text-ink-dim sm:inline">
                AI · agents · dev
              </span>
              <span
                className={cn(
                  "flex items-center gap-1.5 border border-line px-2 py-1 text-[10px] uppercase tracking-[0.16em]",
                  data?.online ? "text-online" : "text-ink-dim"
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    data?.online ? "bg-online pulse" : "bg-ink-dim"
                  )}
                />
                {data?.online ? "Live" : loading ? "Sync" : "Offline"}
              </span>
              <button
                onClick={() => load(true)}
                title="Pull fresh Hacker News + GitHub signal"
                className="border border-line px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-ink-dim transition-colors hover:border-line-strong hover:bg-panel-2 hover:text-ink"
              >
                Refresh
              </button>
            </div>
          }
        />
      </div>
      <Hair />

      <div className="p-5">
        {loading && !data ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="relative h-[130px] overflow-hidden bg-panel-2 sweep" />
            ))}
          </div>
        ) : data && data.cards.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {data.cards.map((c) => (
              <Card key={c.id} card={c} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <span className="text-[12px] uppercase tracking-[0.2em] text-ink-dim">
              {data?.note || "Signal feeds unreachable"}
            </span>
            <button
              onClick={() => load(true)}
              title="Retry fetching the signal feeds"
              className="border border-accent-line bg-accent-soft px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-accent transition-colors hover:bg-accent hover:text-base"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </Panel>
  );
}
