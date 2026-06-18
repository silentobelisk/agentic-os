"use client";

import { useEffect, useRef, useState } from "react";
import type { UsageBucket } from "@/lib/types";
import { fmtTokens } from "@/lib/format";

const H = 260; // px — viewBox height matches rendered height so scaling is 1:1
const PAD_T = 14;
const PAD_B = 24;
const PAD_X = 8;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function xLabel(t: number, bucketMs: number): string {
  const d = new Date(t);
  if (bucketMs <= 3_600_000) return String(d.getHours()).padStart(2, "0") + ":00";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function UsageChart({
  buckets,
  bucketMs,
}: {
  buckets: UsageBucket[];
  bucketMs: number;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(900);
  const [hover, setHover] = useState<number | null>(null);

  // Measure real pixel width so the SVG coordinate space is 1:1 with the screen
  // (no preserveAspectRatio="none" stretching of text/caps).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setW(Math.max(320, Math.round(el.getBoundingClientRect().width)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!buckets.length) {
    return (
      <div className="flex h-[260px] items-center justify-center text-[11px] uppercase tracking-[0.2em] text-ink-dim">
        No activity in this window
      </div>
    );
  }

  const max = niceMax(Math.max(...buckets.map((b) => b.total), 1));
  const innerH = H - PAD_T - PAD_B;
  const innerW = w - PAD_X * 2;
  const n = buckets.length;
  const slot = innerW / n;
  const barW = Math.max(2, Math.min(slot * 0.62, 42));
  const y = (v: number) => PAD_T + innerH * (1 - v / max);
  const gridVals = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const labelEvery = Math.ceil(n / 8);

  // tooltip x, clamped so it never spills past the panel edges
  const tipHalf = 64;
  const tipX = hover !== null ? Math.min(Math.max(PAD_X + slot * hover + slot / 2, tipHalf), w - tipHalf) : 0;

  return (
    <div ref={wrapRef} className="relative w-full">
      <svg
        width={w}
        height={H}
        viewBox={`0 0 ${w} ${H}`}
        className="block"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff7a3d" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#ff6a2b" stopOpacity="0.28" />
          </linearGradient>
          <linearGradient id="barGradHot" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffb27a" stopOpacity="1" />
            <stop offset="100%" stopColor="#ff6a2b" stopOpacity="0.55" />
          </linearGradient>
        </defs>

        {/* gridlines */}
        {gridVals.map((v, i) => (
          <g key={i}>
            <line
              x1={PAD_X}
              x2={w - PAD_X}
              y1={y(v)}
              y2={y(v)}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={1}
              strokeDasharray={i === 0 ? "0" : "2 5"}
            />
            {i !== 0 && (
              <text x={PAD_X + 2} y={y(v) - 4} fontSize={11} fill="rgba(255,255,255,0.3)" fontFamily="var(--font-mono)">
                {fmtTokens(v)}
              </text>
            )}
          </g>
        ))}

        {/* bars */}
        {buckets.map((b, i) => {
          const cx = PAD_X + slot * i + slot / 2;
          const bh = b.total > 0 ? Math.max(1.5, innerH * (b.total / max)) : 0;
          const isHot = hover === i;
          return (
            <g key={b.t}>
              {b.total > 0 && (
                <rect
                  x={cx - barW / 2}
                  y={H - PAD_B - bh}
                  width={barW}
                  height={bh}
                  fill={isHot ? "url(#barGradHot)" : "url(#barGrad)"}
                />
              )}
              {b.total > 0 && (
                <rect
                  x={cx - barW / 2}
                  y={H - PAD_B - bh}
                  width={barW}
                  height={2}
                  fill={isHot ? "#ffd0ad" : "#ff8a4d"}
                />
              )}
              <rect
                x={cx - slot / 2}
                y={PAD_T}
                width={slot}
                height={innerH + PAD_B}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
              {i % labelEvery === 0 && (
                <text
                  x={cx}
                  y={H - 7}
                  fontSize={11}
                  fill="rgba(255,255,255,0.36)"
                  fontFamily="var(--font-mono)"
                  textAnchor="middle"
                >
                  {xLabel(b.t, bucketMs)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* tooltip — clamped within the panel */}
      {hover !== null && buckets[hover] && (
        <div
          className="pointer-events-none absolute top-1 z-10 panel px-2.5 py-2"
          style={{ left: tipX, transform: "translateX(-50%)" }}
        >
          <div className="label mb-1 text-ink-dim">
            {new Date(buckets[hover].t).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: bucketMs <= 3_600_000 ? "2-digit" : undefined,
              minute: bucketMs <= 3_600_000 ? "2-digit" : undefined,
            })}
          </div>
          <div className="tnum font-display text-base font-semibold text-accent">
            {fmtTokens(buckets[hover].total)}
            <span className="ml-1 text-[10px] font-normal text-ink-dim">TOK</span>
          </div>
          <div className="mt-1 flex gap-3 text-[10px] text-ink-dim tnum">
            <span>IN {fmtTokens(buckets[hover].input)}</span>
            <span>OUT {fmtTokens(buckets[hover].output)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
