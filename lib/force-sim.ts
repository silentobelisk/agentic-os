import { type GraphNode, nodeRadius, SIM } from "./graph";

export interface ResolvedEdge {
  s: GraphNode;
  t: GraphNode;
}

// Lay nodes out on a phyllotaxis spiral around the center so the sim settles
// calmly instead of exploding from random positions.
export function initPositions(nodes: GraphNode[], w: number, h: number): void {
  const cx = w / 2;
  const cy = h / 2;
  nodes.forEach((n, i) => {
    const angle = i * 2.399963; // golden angle
    const r = 12 * Math.sqrt(i);
    n.x = cx + r * Math.cos(angle);
    n.y = cy + r * Math.sin(angle);
    n.vx = 0;
    n.vy = 0;
  });
}

// One simulation step. Mutates node positions/velocities. Returns the new alpha;
// caller stops the RAF loop once it drops below SIM.alphaMin.
export function tick(nodes: GraphNode[], edges: ResolvedEdge[], alpha: number, w: number, h: number): number {
  const n = nodes.length;
  const maxD2 = SIM.chargeMaxDist * SIM.chargeMaxDist;

  // 1. charge (repulsion) — O(n²), fine at ≤ ~600 nodes. Skipped beyond
  // chargeMaxDist so far-apart (e.g. disconnected) nodes don't repel each
  // other into infinity — only centering reaches them at long range.
  for (let i = 0; i < n; i++) {
    const a = nodes[i];
    if (a.x == null) continue;
    for (let j = i + 1; j < n; j++) {
      const b = nodes[j];
      if (b.x == null) continue;
      let dx = b.x - a.x!;
      let dy = b.y! - a.y!;
      let d2 = dx * dx + dy * dy;
      if (d2 > maxD2) continue;
      if (d2 < 0.01) {
        dx = (Math.random() - 0.5) * 0.1;
        dy = (Math.random() - 0.5) * 0.1;
        d2 = dx * dx + dy * dy || 0.01;
      }
      let f = (SIM.chargeK * alpha) / d2;
      f *= (a.god ? 1.8 : 1) * (b.god ? 1.8 : 1);
      const fx = dx * f;
      const fy = dy * f;
      // chargeK is negative (repulsion): a moves away from b, b away from a
      a.vx! += fx;
      a.vy! += fy;
      b.vx! -= fx;
      b.vy! -= fy;
    }
  }

  // 2. links (spring toward target length)
  for (const e of edges) {
    const s = e.s;
    const t = e.t;
    if (s.x == null || t.x == null) continue;
    const dx = t.x! - s.x!;
    const dy = t.y! - s.y!;
    const d = Math.hypot(dx, dy) || 1;
    const f = ((d - SIM.linkDist) / d) * SIM.linkK * alpha;
    s.vx! += dx * f;
    s.vy! += dy * f;
    t.vx! -= dx * f;
    t.vy! -= dy * f;
  }

  // 3. centering
  const cx = w / 2;
  const cy = h / 2;
  for (const node of nodes) {
    if (node.x == null) continue;
    node.vx! += (cx - node.x!) * SIM.centerStr * alpha;
    node.vy! += (cy - node.y!) * SIM.centerStr * alpha;
  }

  // 4. collide (resolve worst overlaps)
  for (let i = 0; i < n; i++) {
    const a = nodes[i];
    if (a.x == null) continue;
    const ra = nodeRadius(a) + SIM.collidePad;
    for (let j = i + 1; j < n; j++) {
      const b = nodes[j];
      if (b.x == null) continue;
      const dx = b.x! - a.x!;
      const dy = b.y! - a.y!;
      const min = ra + nodeRadius(b);
      const d = Math.hypot(dx, dy) || 0.01;
      if (d < min) {
        const push = (min - d) / d / 2;
        const px = dx * push;
        const py = dy * push;
        if (!a.pinned) {
          a.x! -= px;
          a.y! -= py;
        }
        if (!b.pinned) {
          b.x! += px;
          b.y! += py;
        }
      }
    }
  }

  // integrate + friction
  for (const node of nodes) {
    if (node.x == null) continue;
    if (node.pinned) {
      node.vx = 0;
      node.vy = 0;
      continue;
    }
    node.vx! *= 1 - SIM.velocityDecay;
    node.vy! *= 1 - SIM.velocityDecay;
    const sp = Math.hypot(node.vx!, node.vy!);
    if (sp > SIM.maxVelocity) {
      const s = SIM.maxVelocity / sp;
      node.vx! *= s;
      node.vy! *= s;
    }
    node.x! += node.vx!;
    node.y! += node.vy!;
  }

  return alpha + (SIM.alphaMin - alpha) * SIM.alphaDecay;
}
