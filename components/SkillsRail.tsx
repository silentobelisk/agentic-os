"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SkillEntry, SkillsResponse } from "@/lib/types";
import { ago } from "@/lib/format";
import { Panel, SectionHeader, Hair, Tag, cn } from "./hud";
import SkillComposer from "./SkillComposer";

function SkillButton({ skill, onClick }: { skill: SkillEntry; onClick: () => void }) {
  const used = skill.count > 0;
  return (
    <button
      onClick={onClick}
      aria-label={`Run ${skill.name}`}
      title={skill.description || `Run ${skill.name}`}
      className={cn(
        "group card-underline relative flex w-[210px] shrink-0 snap-start flex-col gap-3 border bg-panel px-3.5 py-3 text-left transition-all duration-200",
        "hover:-translate-y-0.5 hover:border-accent-line hover:bg-accent-soft active:translate-y-0",
        used ? "border-line" : "border-line-soft"
      )}
    >
      <div className="flex items-center justify-between">
        <Tag>{skill.category}</Tag>
        {used ? (
          <span className="tnum flex items-center gap-1 text-[11px] font-semibold text-accent">
            {skill.count}
            <span className="text-[8px] uppercase tracking-wider text-ink-faint">×</span>
          </span>
        ) : (
          <span className="text-[10px] text-ink-faint">—</span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-display text-[13px] font-semibold text-ink transition-colors group-hover:text-accent">
          {skill.name}
        </span>
        <span className="truncate font-mono text-[10px] text-ink-dim">{skill.command}</span>
      </div>
      {/* affordance footer: metadata at rest, a clear RUN cue on hover */}
      <div className="relative flex h-3 items-center justify-between text-[9px] uppercase tracking-[0.14em]">
        <span className="text-ink-faint transition-opacity duration-200 group-hover:opacity-0">
          {skill.source}
        </span>
        <span className="text-ink-faint transition-opacity duration-200 group-hover:opacity-0">
          {skill.lastUsed ? ago(skill.lastUsed) + " ago" : "unused"}
        </span>
        <span className="absolute inset-0 flex items-center gap-1.5 font-semibold text-accent opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <span className="text-[11px] leading-none">▸</span> Run skill
        </span>
      </div>
    </button>
  );
}

export default function SkillsRail() {
  const [data, setData] = useState<SkillsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SkillEntry | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const railRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch("/api/skills")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
      .then((d: SkillsResponse) => {
        setData(d);
        setLoading(false);
        // deep-link: /?skill=<slug> opens that skill's composer directly
        const slug = new URLSearchParams(window.location.search).get("skill");
        if (slug) {
          const found = d.skills.find(
            (s) => s.slug === slug || s.slug.endsWith(":" + slug) || s.command === "/" + slug
          );
          if (found) setSelected(found);
        }
      })
      .catch(() => setLoading(false));
  }, []);

  const used = useMemo(() => (data ? data.skills.filter((s) => s.count > 0) : []), [data]);
  const railSkills = useMemo(() => {
    if (!data) return [];
    // most-used first; if too few used, pad with the rest of the catalog
    const base = used.length >= 6 ? used : data.skills;
    return base.slice(0, 24);
  }, [data, used]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.skills;
    return data.skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.slug.includes(q) ||
        s.category.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
    );
  }, [data, query]);

  const scroll = (dir: number) => {
    railRef.current?.scrollBy({ left: dir * 460, behavior: "smooth" });
  };

  return (
    <>
      <Panel className="overflow-hidden">
        <div className="px-5 pt-4 pb-3">
          <SectionHeader
            index="03 //"
            title="Most Used Skills"
            right={
              <div className="flex items-center gap-2">
                {data && (
                  <span className="hidden text-[10px] uppercase tracking-[0.16em] text-ink-dim sm:inline">
                    {data.totalInvocations} invocations · {data.skills.length} available
                  </span>
                )}
                <button
                  onClick={() => setExpanded((e) => !e)}
                  aria-expanded={expanded}
                  title={expanded ? "Collapse the full skill list" : "Browse all skills"}
                  className={cn(
                    "border border-line px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] transition-colors",
                    expanded ? "bg-accent-soft text-accent" : "text-ink-dim hover:border-line-strong hover:bg-panel-2 hover:text-ink"
                  )}
                >
                  {expanded ? "Collapse" : "Browse All"}
                </button>
                <div className="hidden items-center gap-1 sm:flex">
                  <button
                    onClick={() => scroll(-1)}
                    className="flex h-6 w-6 items-center justify-center border border-line text-ink-dim transition-colors hover:border-line-strong hover:bg-panel-2 hover:text-ink"
                    aria-label="Scroll left"
                    title="Scroll skills left"
                  >
                    ‹
                  </button>
                  <button
                    onClick={() => scroll(1)}
                    className="flex h-6 w-6 items-center justify-center border border-line text-ink-dim transition-colors hover:border-line-strong hover:bg-panel-2 hover:text-ink"
                    aria-label="Scroll right"
                    title="Scroll skills right"
                  >
                    ›
                  </button>
                </div>
              </div>
            }
          />
        </div>
        <Hair />

        {loading ? (
          <div className="flex gap-3 overflow-hidden px-5 py-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="relative h-[104px] w-[210px] shrink-0 overflow-hidden bg-panel-2 sweep" />
            ))}
          </div>
        ) : !expanded ? (
          <div className="relative">
            {/* edge fades */}
            <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-8 bg-gradient-to-r from-base to-transparent" />
            <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-8 bg-gradient-to-l from-base to-transparent" />
            <div
              ref={railRef}
              role="group"
              aria-label="Most used skills"
              className="rail-scroll flex snap-x gap-3 overflow-x-auto px-5 py-4"
            >
              {railSkills.map((s) => (
                <SkillButton key={s.slug} skill={s} onClick={() => setSelected(s)} />
              ))}
            </div>
          </div>
        ) : (
          <div className="rise p-5">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter skills…"
              className="mb-4 w-full border border-line bg-base-2 px-3 py-2 font-mono text-[12px] text-ink transition-colors placeholder:text-ink-faint hover:border-line-strong focus:border-accent-line focus:outline-none"
            />
            <div className="grid max-h-[420px] grid-cols-1 gap-3 overflow-y-auto rail-scroll pr-1 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((s) => (
                <SkillButton key={s.slug} skill={s} onClick={() => setSelected(s)} />
              ))}
              {filtered.length === 0 && (
                <div className="col-span-full py-8 text-center text-[11px] uppercase tracking-[0.2em] text-ink-dim">
                  No skills match “{query}”
                </div>
              )}
            </div>
          </div>
        )}
      </Panel>

      <SkillComposer skill={selected} onClose={() => setSelected(null)} />
    </>
  );
}
