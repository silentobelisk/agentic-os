import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SocialPlatform, SocialStat, SocialHandles, SocialBoardResponse } from "./types";

// ----------------------------------------------------------------------------
// Free, no-paid-key social stat tracker. Methods validated to work from the
// user's own machine (residential IP), which is far more reliable than a
// datacenter. Results are cached + last-good is kept on failure (never blanks).
//   YouTube  — scrape channel page; subscriber count anchored to the channel's
//              own video count (the header), parsed compact (rounded, as YT shows).
//   Instagram— www.instagram.com web_profile_info JSON (exact) with public app id.
//   TikTok   — profile page __UNIVERSAL_DATA_FOR_REHYDRATION__ JSON (exact).
// ----------------------------------------------------------------------------

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const IG_APP_ID = "936619743392459"; // public web app id, not a secret/key

interface StoreShape {
  handles: SocialHandles;
  stats: Partial<Record<SocialPlatform, SocialStat>>;
  history: Partial<Record<SocialPlatform, { t: number; primary: number }[]>>;
}

function dataDir(): string {
  return process.env.NERVE_DATA_DIR || path.join(os.homedir(), ".nerve-center");
}
function storePath(): string {
  return path.join(dataDir(), "social.json");
}
function readStore(): StoreShape {
  try {
    const s = JSON.parse(fs.readFileSync(storePath(), "utf8"));
    return { handles: s.handles || {}, stats: s.stats || {}, history: s.history || {} };
  } catch {
    return { handles: {}, stats: {}, history: {} };
  }
}
function writeStore(s: StoreShape): void {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(storePath(), JSON.stringify(s, null, 2));
  } catch {
    /* best-effort */
  }
}

function cleanHandle(h: string): string {
  return (h || "").trim().replace(/^@/, "").replace(/\/$/, "").split(/[?#]/)[0];
}

async function fetchWithTimeout(url: string, headers: Record<string, string>, ms = 9000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { headers, signal: ctrl.signal, cache: "no-store", redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

function parseCompact(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.trim().replace(/,/g, "").match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return null;
  let n = parseFloat(m[1]);
  const u = (m[2] || "").toUpperCase();
  if (u === "K") n *= 1e3;
  else if (u === "M") n *= 1e6;
  else if (u === "B") n *= 1e9;
  return Math.round(n);
}

// ---- per-platform fetchers (throw on failure) ----

async function fetchYouTube(raw: string): Promise<Partial<SocialStat>> {
  const h = cleanHandle(raw.replace(/^.*youtube\.com\//i, ""));
  const url = /^UC[\w-]{20,}$/.test(h)
    ? `https://www.youtube.com/channel/${h}`
    : `https://www.youtube.com/@${h}`;
  const r = await fetchWithTimeout(url, { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" });
  if (!r.ok) throw new Error(`YouTube HTTP ${r.status}`);
  const html = await r.text();
  // anchor: subscribers immediately followed (within the header block) by this
  // channel's own video count — the only place both appear together.
  const win = html.match(/([\d.,]+[KMB]?)\s+subscribers[\s\S]{0,200}?([\d.,]+[KMB]?)\s+videos/i);
  const subs = parseCompact(win?.[1]);
  if (subs == null) throw new Error("Subscriber count not found");
  const videos = parseCompact(win?.[2]);
  const title = html.match(/"channelMetadataRenderer":\{[\s\S]{0,500}?"title":"([^"]+)"/)?.[1];
  return {
    displayName: title || `@${h}`,
    primary: subs,
    primaryLabel: "subscribers",
    secondary: [{ label: "videos", value: videos }],
    url,
  };
}

async function fetchInstagram(raw: string): Promise<Partial<SocialStat>> {
  const user = cleanHandle(raw.replace(/^.*instagram\.com\//i, ""));
  const r = await fetchWithTimeout(
    `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(user)}`,
    {
      "User-Agent": UA,
      "x-ig-app-id": IG_APP_ID,
      "Accept-Language": "en-US,en;q=0.9",
      Accept: "*/*",
      Referer: `https://www.instagram.com/${user}/`,
      "X-Requested-With": "XMLHttpRequest",
    }
  );
  if (!r.ok) throw new Error(`Instagram HTTP ${r.status}`);
  const j = (await r.json()) as {
    data?: {
      user?: {
        full_name?: string;
        edge_followed_by?: { count: number };
        edge_follow?: { count: number };
        edge_owner_to_timeline_media?: { count: number };
      };
    };
  };
  const u = j?.data?.user;
  if (!u || u.edge_followed_by == null) throw new Error("Instagram profile not found");
  return {
    displayName: u.full_name || `@${user}`,
    primary: u.edge_followed_by.count,
    primaryLabel: "followers",
    secondary: [
      { label: "posts", value: u.edge_owner_to_timeline_media?.count ?? null },
      { label: "following", value: u.edge_follow?.count ?? null },
    ],
    url: `https://www.instagram.com/${user}/`,
  };
}

async function fetchTikTok(raw: string): Promise<Partial<SocialStat>> {
  const user = cleanHandle(raw.replace(/^.*tiktok\.com\/@?/i, ""));
  const r = await fetchWithTimeout(`https://www.tiktok.com/@${user}`, {
    "User-Agent": UA,
    "Accept-Language": "en-US,en;q=0.9",
  });
  if (!r.ok) throw new Error(`TikTok HTTP ${r.status}`);
  const html = await r.text();
  const m = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("TikTok profile not found");
  const data = JSON.parse(m[1]) as Record<string, Record<string, unknown>>;
  const detail = (data?.__DEFAULT_SCOPE__?.["webapp.user-detail"] || {}) as {
    userInfo?: {
      user?: { nickname?: string };
      stats?: Record<string, number>;
      statsV2?: Record<string, string>;
    };
  };
  const info = detail.userInfo;
  const stats = info?.stats || info?.statsV2;
  if (!stats) throw new Error("TikTok stats unavailable");
  const num = (v: unknown): number | null => (v == null ? null : typeof v === "string" ? parseInt(v, 10) : (v as number));
  return {
    displayName: info?.user?.nickname || `@${user}`,
    primary: num(stats.followerCount),
    primaryLabel: "followers",
    secondary: [
      { label: "likes", value: num((stats as Record<string, unknown>).heartCount ?? (stats as Record<string, unknown>).heart) },
      { label: "videos", value: num(stats.videoCount) },
    ],
    url: `https://www.tiktok.com/@${user}`,
  };
}

const FETCHERS: Record<SocialPlatform, (h: string) => Promise<Partial<SocialStat>>> = {
  youtube: fetchYouTube,
  instagram: fetchInstagram,
  tiktok: fetchTikTok,
};

const PLATFORMS: SocialPlatform[] = ["youtube", "instagram", "tiktok"];

// ----------------------------------------------------------------------------

export function saveHandles(patch: SocialHandles): SocialHandles {
  const store = readStore();
  store.handles = { ...store.handles, ...patch };
  // dropping a handle clears its stored stat
  for (const p of PLATFORMS) {
    if (patch[p] !== undefined && !cleanHandle(patch[p] || "")) {
      delete store.stats[p];
      delete store.history[p];
      store.handles[p] = "";
    }
  }
  writeStore(store);
  return store.handles;
}

async function refreshPlatform(store: StoreShape, p: SocialPlatform): Promise<void> {
  const handle = cleanHandle(store.handles[p] || "");
  if (!handle) return;
  const prev = store.stats[p];
  try {
    const got = await FETCHERS[p](store.handles[p]!);
    const primary = got.primary ?? null;
    const prevPrimary = store.history[p]?.length ? store.history[p]![store.history[p]!.length - 1].primary : prev?.primary ?? null;
    const delta = primary != null && prevPrimary != null ? primary - prevPrimary : null;
    store.stats[p] = {
      platform: p,
      handle,
      displayName: got.displayName || `@${handle}`,
      primary,
      primaryLabel: got.primaryLabel || "followers",
      secondary: got.secondary || [],
      url: got.url || "",
      delta,
      fetchedAt: Date.now(),
      ok: true,
    };
    if (primary != null) {
      const hist = store.history[p] || [];
      // record at most one snapshot per ~6h to keep deltas meaningful
      const last = hist[hist.length - 1];
      if (!last || Date.now() - last.t > 6 * 3_600_000 || last.primary !== primary) {
        hist.push({ t: Date.now(), primary });
      }
      store.history[p] = hist.slice(-120);
    }
  } catch (e) {
    // keep last-good values, mark stale with the error
    store.stats[p] = {
      ...(prev || {
        platform: p,
        handle,
        displayName: `@${handle}`,
        primary: null,
        primaryLabel: "followers",
        secondary: [],
        url: "",
        delta: null,
        fetchedAt: null,
      }),
      ok: false,
      error: String((e as Error).message || e),
    };
  }
}

export async function getSocialBoard(refresh: boolean): Promise<SocialBoardResponse> {
  const store = readStore();
  const active = PLATFORMS.filter((p) => cleanHandle(store.handles[p] || ""));

  if (refresh && active.length) {
    await Promise.all(active.map((p) => refreshPlatform(store, p)));
    writeStore(store);
  }

  const accounts: SocialStat[] = active.map(
    (p) =>
      store.stats[p] || {
        platform: p,
        handle: cleanHandle(store.handles[p] || ""),
        displayName: `@${cleanHandle(store.handles[p] || "")}`,
        primary: null,
        primaryLabel: p === "youtube" ? "subscribers" : "followers",
        secondary: [],
        url: "",
        delta: null,
        fetchedAt: null,
        ok: false,
        error: "not fetched yet",
      }
  );

  const totals = accounts.map((a) => a.primary).filter((n): n is number => n != null);
  const total = totals.length ? totals.reduce((a, b) => a + b, 0) : null;

  return { accounts, handles: store.handles, total, generatedAt: Date.now() };
}
