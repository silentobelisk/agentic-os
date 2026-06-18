"use client";

import { useEffect, useRef, useState } from "react";
import { type GraphData, type GraphNode, communityColor, nodeRadius, SIM } from "@/lib/graph";
import { initPositions, tick, type ResolvedEdge } from "@/lib/force-sim";
import { Corners } from "./hud";

const INK = "rgba(243,239,231,0.9)";

export default function GraphCanvas({ data }: { data: GraphData }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<ResolvedEdge[]>([]);
  const adjRef = useRef<Map<string, Set<string>>>(new Map());
  const alphaRef = useRef(1);
  const camRef = useRef({ x: 0, y: 0, k: 1 });
  const sizeRef = useRef({ w: 800, h: 600, dpr: 1 });
  const hoverRef = useRef<GraphNode | null>(null);
  const dragRef = useRef<{ node?: GraphNode; pan?: boolean; sx: number; sy: number; cx: number; cy: number; moved: boolean } | null>(null);
  const rafRef = useRef(0);
  const runningRef = useRef(false);
  const mouseInRef = useRef(false);
  const fittedRef = useRef(false);

  const [selected, setSelected] = useState<{ node: GraphNode; sx: number; sy: number } | null>(null);

  // (re)build sim state when data changes
  useEffect(() => {
    const nodes = data.nodes.map((n) => ({ ...n }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges: ResolvedEdge[] = [];
    const adj = new Map<string, Set<string>>();
    for (const e of data.edges) {
      const s = byId.get(e.source);
      const t = byId.get(e.target);
      if (!s || !t) continue;
      edges.push({ s, t });
      if (!adj.has(s.id)) adj.set(s.id, new Set());
      if (!adj.has(t.id)) adj.set(t.id, new Set());
      adj.get(s.id)!.add(t.id);
      adj.get(t.id)!.add(s.id);
    }
    nodesRef.current = nodes;
    edgesRef.current = edges;
    adjRef.current = adj;
    fittedRef.current = false;
    setSelected(null);
    initPositions(nodes, sizeRef.current.w, sizeRef.current.h);
    // settle synchronously so the first paint is already laid out + fitted
    let a = 1;
    for (let i = 0; i < 450 && a > SIM.alphaMin; i++) {
      a = tick(nodes, edges, a, sizeRef.current.w, sizeRef.current.h);
    }
    alphaRef.current = a;
    ensureLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  function fit() {
    const nodes = nodesRef.current;
    const { w, h } = sizeRef.current;
    if (!nodes.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      if (n.x == null || !Number.isFinite(n.x) || !Number.isFinite(n.y!)) continue;
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y!);
      maxY = Math.max(maxY, n.y!);
    }
    if (!Number.isFinite(minX)) return; // no positioned nodes yet
    const gw = Math.max(1, maxX - minX);
    const gh = Math.max(1, maxY - minY);
    // cap high enough that a small graph fills the panel, but not absurdly zoomed
    const k = Math.min(2.4, Math.max(0.12, Math.min((w - 110) / gw, (h - 110) / gh)));
    camRef.current = { k, x: w / 2 - ((minX + maxX) / 2) * k, y: h / 2 - ((minY + maxY) / 2) * k };
  }

  function draw() {
    const cv = canvasRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const { w, h, dpr } = sizeRef.current;
    const cam = camRef.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(dpr * cam.k, 0, 0, dpr * cam.k, dpr * cam.x, dpr * cam.y);

    const hot = hoverRef.current;
    const neigh = hot ? adjRef.current.get(hot.id) : null;
    const nodeLit = (n: GraphNode) => !hot || n === hot || (neigh ? neigh.has(n.id) : false);

    // edges
    ctx.lineWidth = 1 / cam.k;
    for (const e of edgesRef.current) {
      if (e.s.x == null || e.t.x == null) continue;
      const lit = !hot || e.s === hot || e.t === hot;
      ctx.globalAlpha = !hot ? 0.16 : lit ? 0.75 : 0.04;
      ctx.strokeStyle = lit && hot ? "#ff6a2b" : "rgba(255,255,255,0.5)";
      ctx.beginPath();
      ctx.moveTo(e.s.x!, e.s.y!);
      ctx.lineTo(e.t.x!, e.t.y!);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // nodes
    for (const n of nodesRef.current) {
      if (n.x == null) continue;
      const r = nodeRadius(n);
      const lit = nodeLit(n);
      const color = communityColor(n.community);
      ctx.globalAlpha = lit ? 1 : 0.12;
      if (n.god) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = (n.god ? 1.5 : 1) / cam.k;
      ctx.strokeStyle = lit ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.14)";
      ctx.stroke();
      // labels: god nodes always; hovered + neighbors on hover
      if (n.god || n === hot || (hot && neigh?.has(n.id))) {
        ctx.globalAlpha = lit ? 0.92 : 0.2;
        ctx.fillStyle = INK;
        ctx.font = `${10 / cam.k}px ui-monospace, "SF Mono", monospace`;
        ctx.textAlign = "center";
        const label = (n.label || n.id).toUpperCase().slice(0, 28);
        ctx.fillText(label, n.x!, n.y! + r + 11 / cam.k);
      }
    }
    ctx.globalAlpha = 1;
  }

  function ensureLoop() {
    if (runningRef.current) return;
    runningRef.current = true;
    const frame = () => {
      if (alphaRef.current > SIM.alphaMin) {
        alphaRef.current = tick(nodesRef.current, edgesRef.current, alphaRef.current, sizeRef.current.w, sizeRef.current.h);
      }
      if (!fittedRef.current && sizeRef.current.w > 10 && nodesRef.current.length) {
        fit();
        fittedRef.current = true;
      }
      draw();
      if (alphaRef.current > SIM.alphaMin || mouseInRef.current || dragRef.current || !fittedRef.current) {
        rafRef.current = requestAnimationFrame(frame);
      } else {
        runningRef.current = false;
      }
    };
    rafRef.current = requestAnimationFrame(frame);
  }

  // sizing
  useEffect(() => {
    const el = wrapRef.current;
    const cv = canvasRef.current;
    if (!el || !cv) return;
    const apply = () => {
      const rect = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { w: Math.round(rect.width), h: Math.round(rect.height), dpr };
      cv.width = Math.round(rect.width * dpr);
      cv.height = Math.round(rect.height * dpr);
      cv.style.width = rect.width + "px";
      cv.style.height = rect.height + "px";
      fittedRef.current = false; // re-fit at the new size
      ensureLoop();
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafRef.current);
      runningRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- interaction helpers ----
  const toWorld = (mx: number, my: number) => {
    const cam = camRef.current;
    return { x: (mx - cam.x) / cam.k, y: (my - cam.y) / cam.k };
  };
  const pick = (mx: number, my: number): GraphNode | null => {
    const w = toWorld(mx, my);
    const nodes = nodesRef.current;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (n.x == null) continue;
      const r = nodeRadius(n) + 4;
      if ((n.x! - w.x) ** 2 + (n.y! - w.y) ** 2 <= r * r) return n;
    }
    return null;
  };
  const rel = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { mx: e.clientX - rect.left, my: e.clientY - rect.top };
  };

  const onMove = (e: React.MouseEvent) => {
    mouseInRef.current = true;
    const { mx, my } = rel(e);
    const d = dragRef.current;
    if (d) {
      d.moved = d.moved || Math.abs(mx - d.sx) + Math.abs(my - d.sy) > 3;
      if (d.pan) {
        camRef.current.x = d.cx + (mx - d.sx);
        camRef.current.y = d.cy + (my - d.sy);
      } else if (d.node) {
        const w = toWorld(mx, my);
        d.node.x = w.x;
        d.node.y = w.y;
        d.node.pinned = true;
        alphaRef.current = Math.max(alphaRef.current, 0.3);
      }
    } else {
      hoverRef.current = pick(mx, my);
      if (canvasRef.current) canvasRef.current.style.cursor = hoverRef.current ? "pointer" : "grab";
    }
    ensureLoop();
  };
  const onDown = (e: React.MouseEvent) => {
    const { mx, my } = rel(e);
    const node = pick(mx, my);
    const cam = camRef.current;
    dragRef.current = { node: node || undefined, pan: !node, sx: mx, sy: my, cx: cam.x, cy: cam.y, moved: false };
    if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
  };
  const onUp = (e: React.MouseEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = "grab";
    if (!d) return;
    if (d.node) d.node.pinned = false;
    if (!d.moved) {
      // a click
      if (d.node) {
        const { mx, my } = rel(e);
        setSelected({ node: d.node, sx: mx, sy: my });
      } else {
        setSelected(null);
      }
    }
    ensureLoop();
  };
  const onLeave = () => {
    mouseInRef.current = false;
    hoverRef.current = null;
    dragRef.current = null;
    ensureLoop();
  };
  // wheel zoom as a non-passive native listener so it doesn't scroll the page
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const cam = camRef.current;
      const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nk = Math.min(4, Math.max(0.1, cam.k * f));
      const wx = (mx - cam.x) / cam.k;
      const wy = (my - cam.y) / cam.k;
      cam.k = nk;
      cam.x = mx - wx * nk;
      cam.y = my - wy * nk;
      ensureLoop();
    };
    cv.addEventListener("wheel", handler, { passive: false });
    return () => cv.removeEventListener("wheel", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reheat = () => {
    alphaRef.current = 1;
    ensureLoop();
  };

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className="block"
        style={{ cursor: "grab" }}
        onMouseMove={onMove}
        onMouseDown={onDown}
        onMouseUp={onUp}
        onMouseLeave={onLeave}
      />

      {/* controls */}
      <div className="pointer-events-auto absolute right-3 top-3 flex gap-1.5">
        <button
          onClick={() => {
            fit();
            ensureLoop();
          }}
          title="Fit graph to view"
          className="border border-line bg-base-2/80 px-2 py-1 text-[9px] uppercase tracking-[0.16em] text-ink-dim backdrop-blur transition-colors hover:border-line-strong hover:text-ink"
        >
          Fit
        </button>
        <button
          onClick={reheat}
          title="Re-run the layout"
          className="border border-line bg-base-2/80 px-2 py-1 text-[9px] uppercase tracking-[0.16em] text-ink-dim backdrop-blur transition-colors hover:border-line-strong hover:text-ink"
        >
          Re-heat
        </button>
      </div>

      {/* details popover */}
      {selected && (
        <div
          className="pointer-events-none absolute z-10 panel max-w-[240px] px-3 py-2"
          style={{
            left: Math.min(Math.max(selected.sx + 12, 8), sizeRef.current.w - 248),
            top: Math.min(Math.max(selected.sy + 12, 8), sizeRef.current.h - 96),
          }}
        >
          <Corners accent />
          <div className="mb-1 flex items-center gap-2">
            <span className="h-2 w-2" style={{ background: communityColor(selected.node.community) }} />
            <span className="label text-accent">{selected.node.god ? "HUB NODE" : "NODE"}</span>
          </div>
          <div className="font-display text-[13px] font-semibold leading-tight text-ink">
            {selected.node.label || selected.node.id}
          </div>
          {selected.node.summary && (
            <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-ink-2">{selected.node.summary}</p>
          )}
          <div className="mt-1.5 flex gap-3 text-[10px] uppercase tracking-[0.12em] text-ink-faint">
            <span className="tnum">{adjRef.current.get(selected.node.id)?.size ?? 0} links</span>
            <span>community {selected.node.community}</span>
          </div>
        </div>
      )}
    </div>
  );
}
