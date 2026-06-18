// Shared types for Nerve Center data layer.

export type Period = "24h" | "7d" | "30d" | "all";

export interface UsageRecord {
  t: number; // epoch ms
  model: string;
  input: number;
  output: number;
  cacheCreate: number; // total ephemeral cache writes (5m + 1h)
  cacheCreate5m: number;
  cacheCreate1h: number;
  cacheRead: number;
  webSearch: number;
  webFetch: number;
  sessionId: string;
  cwd: string;
}

export interface SkillEvent {
  skill: string; // normalized slug (may be "plugin:name")
  t: number;
  source: "tool" | "command";
}

export interface UsageBucket {
  t: number; // bucket start epoch ms
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  total: number; // input + output + cacheCreate + cacheRead
}

export interface UsageTotals {
  tokens: number;
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  billable: number; // input + output + cacheCreate (cache reads are cheap, excluded from "fresh" view)
  messages: number;
  sessions: number;
  webSearch: number;
  webFetch: number;
  cost: number; // estimated USD
  cacheHitRate: number; // cacheRead / (cacheRead + input + cacheCreate)
}

export interface UsageResponse {
  period: Period;
  bucketMs: number;
  buckets: UsageBucket[];
  totals: UsageTotals;
  models: { model: string; tokens: number; cost: number }[];
  topProjects: { name: string; tokens: number }[];
  range: { start: number; end: number };
  generatedAt: number;
  recordCount: number; // total records across all time
  busiestHour: { hour: number; tokens: number } | null;
}

export interface ProfileCard {
  label: string;
  value: string;
}

export interface ProfileResponse {
  name: string;
  bio: string;
  brainPath: string;
  connected: boolean; // brainPath set and points at a readable folder
  cards: ProfileCard[];
  analyzedAt: number | null;
  fileCount: number | null;
  source: "ai" | "stats" | null; // how the cards were produced
  onboardedAt: number | null; // epoch ms the first-run wizard was completed
  onboardingVersion: number | null; // which wizard version they finished
  error?: string;
}

export interface PlanInfo {
  key: string; // "max20x" | "max5x" | "pro" | "free" | "team" | "enterprise" | "unknown"
  name: string; // display name, e.g. "Claude Max 20×"
  multiplier: number; // capacity relative to Pro (Pro = 1)
  rateTier: string | null; // raw organizationRateLimitTier
  organizationType: string | null;
  detected: boolean; // false if we had to fall back to a default
}

export interface PlanWindow {
  label: string;
  used: number; // weighted compute units consumed in the window
  budget: number; // estimated plan budget for the window (same units)
  pct: number; // used / budget (can exceed 1)
  resetAt: number | null; // epoch ms when the window resets
  startAt: number | null; // epoch ms window start
  active: boolean; // is there activity in the current window
}

export interface PlanUsageResponse {
  plan: PlanInfo;
  session: PlanWindow; // rolling 5-hour block
  weekly: PlanWindow; // 7-day plan window
  estimated: boolean;
  calibrated: boolean; // true if budgets came from env overrides
  generatedAt: number;
}

export interface SkillEntry {
  slug: string; // canonical, e.g. "deep-research" or "youtube-agent:yt-description"
  name: string; // display name
  command: string; // slash command to invoke, e.g. "/deep-research"
  description: string;
  source: "global" | "plugin" | "command";
  plugin?: string;
  count: number; // usage count
  lastUsed: number | null;
  category: string;
}

export interface SkillsResponse {
  skills: SkillEntry[]; // ranked, all
  totalInvocations: number;
  generatedAt: number;
}

export interface SignalCard {
  id: string;
  kind: "story" | "repo" | "metric";
  source: string; // "HACKER NEWS" | "GITHUB" | ...
  title: string;
  value: number | null; // primary big number
  valueLabel: string; // e.g. "PTS", "STARS", "PROJECTS"
  sub?: string; // secondary metric line
  meta?: string; // small dim metadata
  url?: string;
  delta?: number | null; // optional change indicator
  accent?: boolean;
}

export type SocialPlatform = "youtube" | "instagram" | "tiktok";

export interface SocialStat {
  platform: SocialPlatform;
  handle: string;
  displayName: string;
  primary: number | null; // subscribers / followers
  primaryLabel: string; // "subscribers" | "followers"
  secondary: { label: string; value: number | null }[];
  url: string;
  delta: number | null; // change since the previous snapshot
  fetchedAt: number | null;
  ok: boolean;
  error?: string;
}

export interface SocialHandles {
  youtube?: string;
  instagram?: string;
  tiktok?: string;
}

export interface SocialBoardResponse {
  accounts: SocialStat[];
  handles: SocialHandles;
  total: number | null; // combined audience across platforms
  generatedAt: number;
}

export interface IndustryResponse {
  cards: SignalCard[];
  generatedAt: number;
  online: boolean;
  note?: string;
}
