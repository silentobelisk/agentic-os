import fs from "node:fs";
import path from "node:path";
import { projectsDir } from "./paths";
import type {
  Period,
  UsageRecord,
  SkillEvent,
  UsageBucket,
  UsageResponse,
} from "./types";
import { estimateCost } from "./pricing";

// ----------------------------------------------------------------------------
// Incremental, mtime-aware cache over ~/.claude/projects/**/*.jsonl
// ----------------------------------------------------------------------------

interface FileEntry {
  mtimeMs: number;
  size: number;
  usage: UsageRecord[];
  skills: SkillEvent[];
}

const fileCache = new Map<string, FileEntry>();
let flat: { usage: UsageRecord[]; skills: SkillEvent[] } | null = null;
let loading: Promise<void> | null = null;
let lastScanAt = 0;
const RESCAN_MS = 4000; // re-stat the tree at most this often

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

const BUILTIN_COMMANDS = new Set([
  "effort", "model", "login", "logout", "clear", "compact", "goal", "loop",
  "help", "config", "init", "resume", "cost", "status", "doctor", "bug",
  "mcp", "ide", "memory", "agents", "add-dir", "vim", "exit", "quit", "fast",
  "release-notes", "terminal-setup", "pr-comments", "schedule", "context",
  "export", "permissions", "hooks", "todos", "rewind", "feedback", "upgrade",
]);

const CMD_RE = /<command-name>\/?([a-z0-9:_-]+)<\/command-name>/gi;

function scanCommands(text: string, t: number, skills: SkillEvent[]) {
  let m: RegExpExecArray | null;
  CMD_RE.lastIndex = 0;
  while ((m = CMD_RE.exec(text)) !== null) {
    const raw = m[1].toLowerCase();
    const bare = raw.includes(":") ? raw.split(":").pop()! : raw;
    if (BUILTIN_COMMANDS.has(bare)) continue;
    skills.push({ skill: raw, t, source: "command" });
  }
}

function parseFile(file: string): { usage: UsageRecord[]; skills: SkillEvent[] } {
  const usage: UsageRecord[] = [];
  const skills: SkillEvent[] = [];
  let data: string;
  try {
    data = fs.readFileSync(file, "utf8");
  } catch {
    return { usage, skills };
  }
  const lines = data.split("\n");
  for (const line of lines) {
    if (!line || line.length < 2) continue;
    let o: Record<string, unknown> & {
      type?: string;
      timestamp?: string;
      message?: {
        model?: string;
        usage?: Record<string, number | undefined> & {
          server_tool_use?: Record<string, number>;
          cache_creation?: Record<string, number>;
        };
        content?: unknown;
      };
      sessionId?: string;
      cwd?: string;
    };
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = o.timestamp ? Date.parse(o.timestamp) : NaN;

    if (o.type === "assistant" && o.message?.usage && !Number.isNaN(ts)) {
      const u = o.message.usage;
      const ccTotal = u.cache_creation_input_tokens || 0;
      const split5m = u.cache_creation?.ephemeral_5m_input_tokens;
      const split1h = u.cache_creation?.ephemeral_1h_input_tokens;
      const hasSplit = split5m != null || split1h != null;
      const cacheCreate5m = hasSplit ? split5m || 0 : ccTotal; // no breakdown → assume 5m
      const cacheCreate1h = hasSplit ? split1h || 0 : 0;
      usage.push({
        t: ts,
        model: o.message.model || "unknown",
        input: u.input_tokens || 0,
        output: u.output_tokens || 0,
        cacheCreate: hasSplit ? cacheCreate5m + cacheCreate1h : ccTotal,
        cacheCreate5m,
        cacheCreate1h,
        cacheRead: u.cache_read_input_tokens || 0,
        webSearch: u.server_tool_use?.web_search_requests || 0,
        webFetch: u.server_tool_use?.web_fetch_requests || 0,
        sessionId: o.sessionId || "",
        cwd: o.cwd || "",
      });
    }

    const content = o.message?.content;
    if (Array.isArray(content)) {
      for (const c of content as Array<Record<string, unknown>>) {
        if (c?.type === "tool_use" && c?.name === "Skill") {
          const sk = (c.input as { skill?: string } | undefined)?.skill;
          if (sk) skills.push({ skill: String(sk).toLowerCase(), t: Number.isNaN(ts) ? 0 : ts, source: "tool" });
        }
        if (c?.type === "text" && typeof c.text === "string") {
          scanCommands(c.text as string, Number.isNaN(ts) ? 0 : ts, skills);
        }
      }
    } else if (typeof content === "string") {
      scanCommands(content, Number.isNaN(ts) ? 0 : ts, skills);
    }
  }
  return { usage, skills };
}

async function doLoad(): Promise<void> {
  const files = walk(projectsDir());
  const present = new Set(files);

  // prune removed
  for (const k of fileCache.keys()) if (!present.has(k)) fileCache.delete(k);

  for (const file of files) {
    let st: fs.Stats;
    try {
      st = fs.statSync(file);
    } catch {
      fileCache.delete(file);
      continue;
    }
    const cached = fileCache.get(file);
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) continue;
    const parsed = parseFile(file);
    fileCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, ...parsed });
    // yield to the event loop occasionally so the server stays responsive
    if (fileCache.size % 40 === 0) await new Promise((r) => setImmediate(r));
  }

  const usage: UsageRecord[] = [];
  const skills: SkillEvent[] = [];
  for (const entry of fileCache.values()) {
    for (const u of entry.usage) usage.push(u);
    for (const s of entry.skills) skills.push(s);
  }
  usage.sort((a, b) => a.t - b.t);
  flat = { usage, skills };
}

export async function ensureLoaded(force = false): Promise<void> {
  const now = Date.now();
  if (flat && !force && now - lastScanAt < RESCAN_MS) return;
  if (loading) return loading;
  loading = doLoad().finally(() => {
    loading = null;
    lastScanAt = Date.now();
  });
  return loading;
}

export async function getSkillEvents(): Promise<SkillEvent[]> {
  await ensureLoaded();
  return flat ? flat.skills : [];
}

export async function getUsageRecords(): Promise<UsageRecord[]> {
  await ensureLoaded();
  return flat ? flat.usage : [];
}

// ----------------------------------------------------------------------------
// Aggregation
// ----------------------------------------------------------------------------

const HOUR = 3_600_000;
const DAY = 86_400_000;

function periodWindow(period: Period, now: number, dataStart: number): { start: number; bucketMs: number } {
  switch (period) {
    case "24h":
      return { start: now - 24 * HOUR, bucketMs: HOUR };
    case "7d":
      return { start: now - 7 * DAY, bucketMs: DAY };
    case "30d":
      return { start: now - 30 * DAY, bucketMs: DAY };
    case "all":
    default:
      return { start: dataStart, bucketMs: DAY };
  }
}

function bucketStart(t: number, bucketMs: number): number {
  if (bucketMs === DAY) {
    // align to local midnight so daily bars read naturally
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (bucketMs === HOUR) {
    const d = new Date(t);
    d.setMinutes(0, 0, 0);
    return d.getTime();
  }
  return Math.floor(t / bucketMs) * bucketMs;
}

export async function aggregateUsage(period: Period): Promise<UsageResponse> {
  await ensureLoaded();
  const recs = flat ? flat.usage : [];
  const now = Date.now();
  const dataStart = recs.length ? recs[0].t : now - 30 * DAY;
  const dataEnd = recs.length ? recs[recs.length - 1].t : now;
  const { start, bucketMs } = periodWindow(period, now, dataStart);

  const end = period === "all" ? dataEnd : now;
  const inWindow = recs.filter((r) => r.t >= start && r.t <= end + bucketMs);

  // pre-seed empty buckets so the chart has a continuous axis. Advance by
  // re-anchoring to local midnight/hour each step (not a fixed += bucketMs) so
  // a DST transition inside the window doesn't drift the seeded keys off the
  // keys bucketStart() produces for real records.
  const advance = (b: number): number => {
    const d = new Date(b);
    if (bucketMs === DAY) {
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    if (bucketMs === HOUR) {
      d.setHours(d.getHours() + 1);
      d.setMinutes(0, 0, 0);
      return d.getTime();
    }
    return b + bucketMs;
  };
  const buckets = new Map<number, UsageBucket>();
  const firstBucket = bucketStart(start, bucketMs);
  const lastBucket = bucketStart(end, bucketMs);
  for (let b = firstBucket; b <= lastBucket; b = advance(b)) {
    buckets.set(b, { t: b, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, total: 0 });
  }

  // totals
  let input = 0, output = 0, cacheCreate = 0, cacheRead = 0, webSearch = 0, webFetch = 0, cost = 0;
  const sessions = new Set<string>();
  const modelAgg = new Map<string, { tokens: number; cost: number }>();
  const projectAgg = new Map<string, number>();
  const hourAgg = new Array(24).fill(0);

  for (const r of inWindow) {
    const bs = bucketStart(r.t, bucketMs);
    let bk = buckets.get(bs);
    if (!bk) {
      bk = { t: bs, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, total: 0 };
      buckets.set(bs, bk);
    }
    bk.input += r.input;
    bk.output += r.output;
    bk.cacheCreate += r.cacheCreate;
    bk.cacheRead += r.cacheRead;
    const rTotal = r.input + r.output + r.cacheCreate + r.cacheRead;
    bk.total += rTotal;

    input += r.input;
    output += r.output;
    cacheCreate += r.cacheCreate;
    cacheRead += r.cacheRead;
    webSearch += r.webSearch;
    webFetch += r.webFetch;
    if (r.sessionId) sessions.add(r.sessionId);
    const c = estimateCost(r.model, r.input, r.output, r.cacheCreate5m, r.cacheCreate1h, r.cacheRead);
    cost += c;

    const ma = modelAgg.get(r.model) || { tokens: 0, cost: 0 };
    ma.tokens += rTotal;
    ma.cost += c;
    modelAgg.set(r.model, ma);

    if (r.cwd) {
      const name = r.cwd.split("/").filter(Boolean).pop() || r.cwd;
      projectAgg.set(name, (projectAgg.get(name) || 0) + rTotal);
    }
    hourAgg[new Date(r.t).getHours()] += rTotal;
  }

  const bucketArr = [...buckets.values()].sort((a, b) => a.t - b.t);
  const tokens = input + output + cacheCreate + cacheRead;

  const models = [...modelAgg.entries()]
    .map(([model, v]) => ({ model, tokens: v.tokens, cost: v.cost }))
    .filter((m) => m.tokens > 0 && !m.model.startsWith("<"))
    .sort((a, b) => b.tokens - a.tokens);

  const topProjects = [...projectAgg.entries()]
    .map(([name, t]) => ({ name, tokens: t }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 6);

  let busiestHour: { hour: number; tokens: number } | null = null;
  for (let h = 0; h < 24; h++) {
    if (!busiestHour || hourAgg[h] > busiestHour.tokens) busiestHour = { hour: h, tokens: hourAgg[h] };
  }
  if (busiestHour && busiestHour.tokens === 0) busiestHour = null;

  return {
    period,
    bucketMs,
    buckets: bucketArr,
    totals: {
      tokens,
      input,
      output,
      cacheCreate,
      cacheRead,
      billable: input + output + cacheCreate,
      messages: inWindow.length,
      sessions: sessions.size,
      webSearch,
      webFetch,
      cost,
      cacheHitRate:
        cacheRead + input + cacheCreate > 0
          ? cacheRead / (cacheRead + input + cacheCreate)
          : 0,
    },
    models,
    topProjects,
    range: { start: firstBucket, end: lastBucket + bucketMs },
    generatedAt: now,
    recordCount: recs.length,
    busiestHour,
  };
}
