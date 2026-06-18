"use client";

import { useEffect, useState } from "react";
import { clockHHMMSS } from "@/lib/format";
import { Chip, BrainMark } from "./hud";

export default function Header() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const dateStr = now
    ? now
        .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "2-digit", year: "numeric" })
        .toUpperCase()
    : "";

  return (
    <header className="relative">
      {/* top crop ticks */}
      <div className="pointer-events-none absolute -top-2 left-0 h-2 w-2 border-l border-t border-line-strong" />
      <div className="pointer-events-none absolute -top-2 right-0 h-2 w-2 border-r border-t border-line-strong" />

      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <div className="flex items-center gap-4">
          <div className="flex h-9 w-9 items-center justify-center border border-accent-line bg-accent-soft">
            <BrainMark className="h-6 w-6 text-accent" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h1 className="font-display text-lg font-bold uppercase tracking-[0.28em] text-ink">
                Nerve Center
              </h1>
              <span className="hidden text-[10px] uppercase tracking-[0.2em] text-accent sm:inline">
                v1.0
              </span>
            </div>
            <span className="text-[10px] uppercase tracking-[0.24em] text-ink-dim">
              // Claude Code Operations Console
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:gap-5">
          <div className="hidden flex-col items-end md:flex">
            <span className="tnum font-display text-xl font-semibold leading-none text-ink">
              {now ? clockHHMMSS(now) : "--:--:--"}
            </span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-ink-dim">{dateStr}</span>
          </div>
          <div className="hidden h-8 w-px bg-line md:block" />
          <Chip tone="online" pulse>
            Online
          </Chip>
          <Chip tone="accent">Opus 4.8</Chip>
        </div>
      </div>
    </header>
  );
}
