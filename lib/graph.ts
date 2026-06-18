// Knowledge-graph data model + HUD palette + force-sim constants.
// graphify output is normalized into this shape (see lib/graphify.ts).

export interface GraphNode {
  id: string;
  label: string;
  community: number; // cluster id → color group
  god?: boolean; // high-degree hub → larger + glowing
  degree?: number; // drives radius
  summary?: string; // optional detail for the popover
  type?: string;
  // simulation state (mutated in place by the sim)
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  pinned?: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight?: number;
  relation?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta?: {
    communities?: number;
    godNodes?: string[];
    generatedAt?: number;
    title?: string;
    communityLabels?: Record<string, string>;
    nodeCount?: number;
    edgeCount?: number;
    capped?: boolean;
  };
}

// Single amber accent, spread into a warm analogous ramp so communities read as
// "one family, many channels" rather than a rainbow. Cool blue is reserved for a
// special/external community only.
export const COMMUNITY_COLORS = [
  "#ff6a2b", // accent (canonical)
  "#ff8a3d", // orange
  "#ffb24d", // amber-gold
  "#ff5340", // ember-red
  "#e0531a", // accent-deep
  "#ffd166", // warn-gold
  "#ff7a6b", // rose
  "#5aa9ff", // cool (special)
] as const;

export function communityColor(c: number): string {
  const n = COMMUNITY_COLORS.length;
  return COMMUNITY_COLORS[(((c | 0) % n) + n) % n];
}

export function nodeRadius(n: GraphNode): number {
  return n.god ? 11 : 4 + Math.min(7, Math.sqrt(n.degree ?? 1));
}

export const SIM = {
  alphaDecay: 0.0205,
  alphaMin: 0.001,
  velocityDecay: 0.4,
  chargeK: -320, // repulsion
  chargeMaxDist: 480, // repulsion cutoff — beyond this, only centering acts (keeps sparse/isolated nodes from flying off; also speeds the O(n²) loop)
  maxVelocity: 48, // per-tick speed clamp — insurance against single-step blowups
  linkDist: 70,
  linkK: 0.3,
  centerStr: 0.05,
  collidePad: 3,
};
