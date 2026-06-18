import type { IndustryResponse, SignalCard } from "./types";

// Live "industry signal" board for the AI / agent / dev space.
// Sources are free + keyless: Hacker News (Algolia) + GitHub search.
// Cached in-module so the dashboard doesn't hammer the APIs.

let cache: { data: IndustryResponse; at: number } | null = null;
const TTL_MS = 5 * 60 * 1000;

async function fetchJson(url: string, headers?: Record<string, string>, ms = 5000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

interface HnHit {
  objectID: string;
  title: string;
  url: string | null;
  points: number;
  num_comments: number;
  created_at_i: number;
}

interface GhRepo {
  id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
}

async function getHackerNews(): Promise<SignalCard[]> {
  // Popularity-ranked search, then filter to recent + sort by points so we
  // surface the most-upvoted *recent* AI stories (the public Algolia endpoint
  // rejects combined numericFilters, so we filter client-side).
  const url = "https://hn.algolia.com/api/v1/search?query=AI&tags=story&hitsPerPage=60";
  const data = (await fetchJson(url)) as { hits?: HnHit[] };
  const now = Date.now() / 1000;
  const all = (data.hits || []).filter((h) => h.title && (h.url || h.objectID));
  let hits = all
    .filter((h) => h.points >= 80 && now - h.created_at_i < 30 * 86400)
    .sort((a, b) => b.points - a.points)
    .slice(0, 5);
  if (hits.length < 3) {
    // not enough recent — fall back to the top stories by points
    hits = all.sort((a, b) => b.points - a.points).slice(0, 5);
  }
  return hits.map((h) => ({
    id: "hn-" + h.objectID,
    kind: "story" as const,
    source: "HACKER NEWS",
    title: h.title,
    value: h.points,
    valueLabel: "PTS",
    sub: `${h.num_comments} comments`,
    meta: relTime(h.created_at_i * 1000),
    url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    accent: h.points > 400,
  }));
}

async function getGithub(): Promise<SignalCard[]> {
  const d = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
  const url =
    "https://api.github.com/search/repositories?q=" +
    encodeURIComponent(`topic:ai pushed:>${d}`) +
    "&sort=stars&order=desc&per_page=6";
  const data = (await fetchJson(url, {
    "User-Agent": "nerve-center",
    Accept: "application/vnd.github+json",
  })) as { items?: GhRepo[] };
  const items = (data.items || []).slice(0, 4);
  return items.map((r) => ({
    id: "gh-" + r.id,
    kind: "repo" as const,
    source: "GITHUB",
    title: r.full_name,
    value: r.stargazers_count,
    valueLabel: "STARS",
    sub: r.description ? trim(r.description, 70) : undefined,
    meta: r.language || "—",
    url: r.html_url,
    accent: r.stargazers_count > 50000,
  }));
}

function trim(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function relTime(ms: number): string {
  const h = Math.floor((Date.now() - ms) / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return h + "h ago";
  return Math.floor(h / 24) + "d ago";
}

export async function getIndustry(force = false): Promise<IndustryResponse> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;

  const [hn, gh] = await Promise.allSettled([getHackerNews(), getGithub()]);
  const cards: SignalCard[] = [];
  if (hn.status === "fulfilled") cards.push(...hn.value);
  if (gh.status === "fulfilled") cards.push(...gh.value);

  const online = cards.length > 0;

  // derive a couple of summary metric cards from what we pulled
  if (online) {
    const stories = cards.filter((c) => c.kind === "story");
    const repos = cards.filter((c) => c.kind === "repo");
    const totalPts = stories.reduce((s, c) => s + (c.value || 0), 0);
    const totalStars = repos.reduce((s, c) => s + (c.value || 0), 0);
    const metrics: SignalCard[] = [
      {
        id: "m-pulse",
        kind: "metric",
        source: "SIGNAL",
        title: "AI DISCUSSION HEAT",
        value: totalPts,
        valueLabel: "PTS · TOP 5",
        sub: `${stories.length} front-page stories tracked`,
        meta: "HN · AI tag",
        accent: true,
      },
      {
        id: "m-stars",
        kind: "metric",
        source: "SIGNAL",
        title: "TRENDING REPO MASS",
        value: totalStars,
        valueLabel: "STARS",
        sub: `${repos.length} active AI repos`,
        meta: "GitHub · topic:ai",
      },
    ];
    cards.unshift(...metrics);
  }

  const data: IndustryResponse = {
    cards,
    generatedAt: Date.now(),
    online,
    note: online ? undefined : "Signal feeds unreachable — offline or rate-limited.",
  };
  if (online) cache = { data, at: Date.now() };
  return data;
}
