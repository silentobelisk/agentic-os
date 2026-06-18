import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { estimateCost } from "./pricing";
import { getUsageRecords } from "./transcripts";
import type { PlanInfo, PlanWindow, PlanUsageResponse, UsageRecord } from "./types";

// ----------------------------------------------------------------------------
// ~/.claude.json reader — the local source of truth for plan + skill usage.
// ----------------------------------------------------------------------------

interface ClaudeConfig {
  oauthAccount?: {
    organizationRateLimitTier?: string | null;
    organizationType?: string | null;
    emailAddress?: string;
    displayName?: string;
    accountCreatedAt?: string;
    subscriptionCreatedAt?: string;
    organizationName?: string;
  };
  skillUsage?: Record<string, { usageCount?: number; lastUsedAt?: number }>;
  cachedGrowthBookFeatures?: {
    tengu_saffron_lattice?: { planLimitsEndDate?: string };
  };
}

let cfgCache: { mtimeMs: number; data: ClaudeConfig } | null = null;

function configPaths(): string[] {
  const paths: string[] = [];
  if (process.env.CLAUDE_CONFIG_DIR) {
    paths.push(path.join(process.env.CLAUDE_CONFIG_DIR, ".claude.json"));
    paths.push(path.join(process.env.CLAUDE_CONFIG_DIR, "..", ".claude.json"));
  }
  paths.push(path.join(os.homedir(), ".claude.json"));
  return paths;
}

export function getClaudeConfig(): ClaudeConfig {
  for (const p of configPaths()) {
    let st: fs.Stats;
    try {
      st = fs.statSync(p);
    } catch {
      continue;
    }
    if (cfgCache && cfgCache.mtimeMs === st.mtimeMs) return cfgCache.data;
    try {
      const data = JSON.parse(fs.readFileSync(p, "utf8")) as ClaudeConfig;
      cfgCache = { mtimeMs: st.mtimeMs, data };
      return data;
    } catch {
      return {};
    }
  }
  return {};
}

// ----------------------------------------------------------------------------
// Plan detection
// ----------------------------------------------------------------------------

export function detectPlan(): PlanInfo {
  const acct = getClaudeConfig().oauthAccount || {};
  const tier = (acct.organizationRateLimitTier || "").toLowerCase();
  const orgType = acct.organizationType || null;

  const base = {
    rateTier: acct.organizationRateLimitTier || null,
    organizationType: orgType,
    detected: true,
  };

  if (tier.includes("max_20x")) return { key: "max20x", name: "Claude Max 20×", multiplier: 20, ...base };
  if (tier.includes("max_5x")) return { key: "max5x", name: "Claude Max 5×", multiplier: 5, ...base };
  if (tier.includes("pro")) return { key: "pro", name: "Claude Pro", multiplier: 1, ...base };
  if (tier.includes("free")) return { key: "free", name: "Claude Free", multiplier: 0.35, ...base };
  if (tier.includes("team")) return { key: "team", name: "Claude Team", multiplier: 5, ...base };
  if (tier.includes("enterprise")) return { key: "enterprise", name: "Claude Enterprise", multiplier: 20, ...base };
  // fall back on the coarse org type
  if (orgType === "claude_max") return { key: "max5x", name: "Claude Max", multiplier: 5, ...base };
  if (orgType === "claude_pro") return { key: "pro", name: "Claude Pro", multiplier: 1, ...base };
  return {
    key: "unknown",
    name: "Claude (plan unknown)",
    multiplier: 1,
    rateTier: acct.organizationRateLimitTier || null,
    organizationType: orgType,
    detected: false,
  };
}

// ----------------------------------------------------------------------------
// Budget model. Plan limits are measured by Anthropic in a weighted compute
// metric that isn't published as a token count, so we approximate "plan budget"
// in the same cost-weighted units we use for usage (output >> input >> cache).
// Defaults scale with the plan multiplier off a Pro baseline and are calibratable
// per-machine via env so a user can match what /usage reports.
// ----------------------------------------------------------------------------

const BASE_SESSION_BUDGET = 12; // Pro 5-hour baseline, weighted units
const BASE_WEEKLY_BUDGET = 50; // Pro weekly baseline, weighted units

function budgetsFor(plan: PlanInfo): { session: number; weekly: number; calibrated: boolean } {
  const envSession = Number(process.env.NERVE_SESSION_BUDGET);
  const envWeekly = Number(process.env.NERVE_WEEKLY_BUDGET);
  const calibrated = !!(envSession > 0 || envWeekly > 0);
  return {
    session: envSession > 0 ? envSession : BASE_SESSION_BUDGET * plan.multiplier,
    weekly: envWeekly > 0 ? envWeekly : BASE_WEEKLY_BUDGET * plan.multiplier,
    calibrated,
  };
}

// ----------------------------------------------------------------------------
// Window math
// ----------------------------------------------------------------------------

const FIVE_H = 5 * 3_600_000;
const WEEK = 7 * 86_400_000;

// Weighted compute consumed by one record — the same shape as the cost estimate
// (so cache reads barely count and output dominates), which tracks how plan
// limits are actually consumed. Units are dollar-equivalents but never shown as $.
function weight(r: UsageRecord): number {
  return estimateCost(r.model, r.input, r.output, r.cacheCreate5m, r.cacheCreate1h, r.cacheRead);
}

function floorHour(t: number): number {
  const d = new Date(t);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

// The weekly window resets at planLimitsEndDate (rolled forward to the future);
// fall back to a fixed 7-day cadence if Claude hasn't cached the date.
function weeklyReset(now: number): number {
  const raw = getClaudeConfig().cachedGrowthBookFeatures?.tengu_saffron_lattice?.planLimitsEndDate;
  let t = raw ? Date.parse(raw) : NaN;
  if (!Number.isNaN(t)) {
    while (t <= now) t += WEEK;
    return t;
  }
  let r = Date.UTC(2025, 0, 6, 0, 0, 0); // arbitrary Monday anchor
  while (r <= now) r += WEEK;
  return r;
}

export async function computePlanUsage(): Promise<PlanUsageResponse> {
  const recs = await getUsageRecords(); // sorted ascending by time
  const now = Date.now();
  const plan = detectPlan();
  const budgets = budgetsFor(plan);

  // Build rolling 5-hour blocks (ccusage-style): a new block starts when the
  // current block is older than 5h or there's a >5h gap since the last record.
  let cur: { start: number; last: number; used: number } | null = null;
  for (const r of recs) {
    if (!cur || r.t - cur.start >= FIVE_H || r.t - cur.last >= FIVE_H) {
      cur = { start: floorHour(r.t), last: r.t, used: 0 };
    }
    cur.last = r.t;
    cur.used += weight(r);
  }
  const sessionActive = !!(cur && now < cur.start + FIVE_H);
  const sUsed = sessionActive ? cur!.used : 0;

  // Weekly window
  const wReset = weeklyReset(now);
  const wStart = wReset - WEEK;
  let wUsed = 0;
  for (const r of recs) if (r.t >= wStart && r.t < wReset) wUsed += weight(r);

  const win = (
    label: string,
    used: number,
    budget: number,
    resetAt: number | null,
    startAt: number | null,
    active: boolean
  ): PlanWindow => ({
    label,
    used,
    budget,
    pct: budget > 0 ? used / budget : 0,
    resetAt,
    startAt,
    active,
  });

  return {
    plan,
    estimated: true,
    calibrated: budgets.calibrated,
    generatedAt: now,
    session: win(
      "Session · 5-hour",
      sUsed,
      budgets.session,
      sessionActive ? cur!.start + FIVE_H : null,
      sessionActive ? cur!.start : null,
      sessionActive
    ),
    weekly: win("Weekly", wUsed, budgets.weekly, wReset, wStart, wUsed > 0),
  };
}
