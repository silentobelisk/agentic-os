import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { brainDir, dataRoot, graphOutDir, clearGraph, hasGraph } from "./brain-store";
import type { GraphData, GraphNode, GraphEdge } from "./graph";

// ----------------------------------------------------------------------------
// Parse graphify-out/graph.json (+ .graphify_labels.json) into our GraphData.
// graphify gives nodes + `links` but NO degree/god-node fields — we compute them.
// ----------------------------------------------------------------------------

const NODE_CAP = 800; // safety cap for the canvas; keep highest-degree nodes

interface RawNode {
  id: string;
  label?: string;
  community?: number | null;
  file_type?: string;
  source_file?: string;
  source_location?: string | null;
}
interface RawLink {
  source: string;
  target: string;
  relation?: string;
  weight?: number;
  confidence_score?: number;
}

export function parseGraph(): GraphData | null {
  const dir = graphOutDir();
  let raw: { nodes?: RawNode[]; links?: RawLink[]; edges?: RawLink[] };
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, "graph.json"), "utf8"));
  } catch {
    return null;
  }
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const rawLinks = Array.isArray(raw.links) ? raw.links : Array.isArray(raw.edges) ? raw.edges : [];

  let labels: Record<string, string> = {};
  try {
    labels = JSON.parse(fs.readFileSync(path.join(dir, ".graphify_labels.json"), "utf8"));
  } catch {
    /* optional */
  }

  // degree from links
  const degree = new Map<string, number>();
  for (const l of rawLinks) {
    if (!l || l.source == null || l.target == null) continue;
    degree.set(l.source, (degree.get(l.source) || 0) + 1);
    degree.set(l.target, (degree.get(l.target) || 0) + 1);
  }

  let nodes: GraphNode[] = rawNodes
    .filter((n) => n && n.id != null)
    .map((n) => ({
      id: String(n.id),
      label: String(n.label || n.id),
      community: typeof n.community === "number" ? n.community : -1,
      degree: degree.get(n.id) || 0,
      type: n.file_type,
      summary: n.source_file ? `${n.file_type || "node"} · ${n.source_file}` : undefined,
    }));

  const ids = new Set(nodes.map((n) => n.id));
  let edges: GraphEdge[] = rawLinks
    .filter((l) => l && ids.has(l.source) && ids.has(l.target))
    .map((l) => ({
      source: String(l.source),
      target: String(l.target),
      weight: typeof l.confidence_score === "number" ? l.confidence_score : l.weight || 1,
      relation: l.relation,
    }));

  // god nodes: top-degree, excluding "concept" nodes and filename-looking hubs
  const looksLikeFile = (n: GraphNode) => /\.[a-z0-9]{1,6}$/i.test(n.label);
  const godRanked = nodes
    .filter((n) => n.type !== "concept" && !looksLikeFile(n))
    .sort((a, b) => (b.degree || 0) - (a.degree || 0));
  const godIds = new Set(godRanked.slice(0, 10).filter((n) => (n.degree || 0) >= 3).map((n) => n.id));
  for (const n of nodes) if (godIds.has(n.id)) n.god = true;

  // cap for canvas performance — keep the highest-degree nodes
  let capped = false;
  if (nodes.length > NODE_CAP) {
    capped = true;
    nodes = [...nodes].sort((a, b) => (b.degree || 0) - (a.degree || 0)).slice(0, NODE_CAP);
    const keep = new Set(nodes.map((n) => n.id));
    edges = edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  }

  const communities = new Set(nodes.map((n) => n.community)).size;
  return {
    nodes,
    edges,
    meta: {
      communities,
      communityLabels: labels,
      godNodes: [...godIds],
      nodeCount: nodes.length,
      edgeCount: edges.length,
      capped,
      generatedAt: Date.now(),
    },
  };
}

// ----------------------------------------------------------------------------
// Background graphify build. Runs `claude -p /graphify ...` detached; the SSE
// progress route only OBSERVES this job, so navigating away doesn't kill it.
// ----------------------------------------------------------------------------

type JobStatus = "idle" | "running" | "done" | "error";
interface Job {
  status: JobStatus;
  startedAt: number;
  endedAt?: number;
  log: string[];
  error?: string;
}
let job: Job = { status: "idle", startedAt: 0, log: [] };
let child: ChildProcessWithoutNullStreams | null = null;

export function graphifyJob(): { status: JobStatus; startedAt: number; endedAt?: number; log: string[]; error?: string } {
  return { ...job, log: job.log };
}

function pushLog(s: string) {
  if (!s) return;
  job.log.push(s);
  if (job.log.length > 500) job.log.splice(0, job.log.length - 500);
}

function handleLine(line: string) {
  let o: { type?: string; message?: { content?: Array<{ type?: string; text?: string; name?: string }> } };
  try {
    o = JSON.parse(line);
  } catch {
    return;
  }
  if (o.type === "assistant" && o.message?.content) {
    for (const c of o.message.content) {
      if (c.type === "text" && c.text) pushLog(c.text.trim().slice(0, 160));
      else if (c.type === "tool_use" && c.name) pushLog("→ " + c.name);
    }
  }
}

export function startGraphify(): { started: boolean; status: JobStatus } {
  if (job.status === "running") return { started: false, status: "running" };
  clearGraph();
  job = { status: "running", startedAt: Date.now(), log: ["Launching graphify…"] };
  const prompt = `/graphify "${brainDir()}" --no-viz`;
  try {
    child = spawn(
      "claude",
      ["-p", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions", prompt],
      { cwd: dataRoot(), env: process.env, detached: true }
    );
    child.stdin.end();
  } catch (e) {
    job.status = "error";
    job.error = String(e);
    job.endedAt = Date.now();
    return { started: false, status: "error" };
  }

  let buf = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) handleLine(line);
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    const t = String(chunk).trim();
    if (t) pushLog(t.slice(0, 200));
  });
  child.on("error", (e) => {
    job.status = "error";
    job.error = String(e);
    job.endedAt = Date.now();
  });
  child.on("close", (code) => {
    if (buf.trim()) handleLine(buf.trim());
    const ok = hasGraph();
    job.status = ok ? "done" : "error";
    if (!ok && !job.error) job.error = `graphify exited (${code}) without producing a graph`;
    job.endedAt = Date.now();
    pushLog(ok ? "✓ Knowledge graph built." : "graphify finished without a graph");
    child = null;
  });

  return { started: true, status: "running" };
}

export function cancelGraphify(): void {
  if (child && child.pid && !child.killed) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
        /* gone */
      }
    }
  }
  if (job.status === "running") {
    job.status = "error";
    job.error = "cancelled";
    job.endedAt = Date.now();
  }
}
