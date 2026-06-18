import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ProfileCard } from "./types";

const TEXT_EXT = new Set([".md", ".markdown", ".mdx", ".txt", ".org", ".rst", ".text"]);
const SKIP_DIR = new Set([".git", "node_modules", ".obsidian", ".trash", ".vscode", ".next", "__pycache__"]);
const MAX_FILES_SAMPLED = 40;
const PER_FILE_CHARS = 3000;
const TOTAL_SAMPLE_CHARS = 24000;

export function expandPath(p: string): string {
  let out = (p || "").trim();
  if (out.startsWith("~")) out = path.join(os.homedir(), out.slice(1));
  return out;
}

export interface BrainDigest {
  ok: boolean;
  error?: string;
  fileCount: number;
  totalChars: number;
  words: number;
  sample: string;
  newestName: string | null;
  newestAt: number | null;
  oldestAt: number | null;
}

interface FileRef {
  abs: string;
  rel: string;
  mtimeMs: number;
}

function walk(dir: string, root: string, out: FileRef[], depth = 0): void {
  if (depth > 6 || out.length > 5000) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.isDirectory()) continue;
    if (SKIP_DIR.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(abs, root, out, depth + 1);
    } else if (e.isFile() && TEXT_EXT.has(path.extname(e.name).toLowerCase())) {
      let st: fs.Stats;
      try {
        st = fs.statSync(abs);
      } catch {
        continue;
      }
      out.push({ abs, rel: path.relative(root, abs), mtimeMs: st.mtimeMs });
    }
  }
}

export function readBrainDigest(rawPath: string): BrainDigest {
  const root = expandPath(rawPath);
  const empty: BrainDigest = {
    ok: false,
    fileCount: 0,
    totalChars: 0,
    words: 0,
    sample: "",
    newestName: null,
    newestAt: null,
    oldestAt: null,
  };
  if (!root) return { ...empty, error: "No folder provided" };
  let st: fs.Stats;
  try {
    st = fs.statSync(root);
  } catch {
    return { ...empty, error: "Folder not found" };
  }
  if (!st.isDirectory()) return { ...empty, error: "Path is not a folder" };

  const files: FileRef[] = [];
  walk(root, root, files);
  if (!files.length) return { ...empty, error: "No notes (.md/.txt/…) found in folder" };

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const newestAt = files[0].mtimeMs;
  const oldestAt = files[files.length - 1].mtimeMs;
  const newestName = files[0].rel;

  let sample = "";
  let totalChars = 0;
  let sampled = 0;
  for (const f of files) {
    if (sampled >= MAX_FILES_SAMPLED || sample.length >= TOTAL_SAMPLE_CHARS) break;
    let content = "";
    try {
      content = fs.readFileSync(f.abs, "utf8");
    } catch {
      continue;
    }
    totalChars += content.length;
    const excerpt = content.slice(0, PER_FILE_CHARS).trim();
    if (excerpt) {
      sample += `\n\n=== ${f.rel} ===\n${excerpt}`;
      sampled += 1;
    }
  }
  sample = sample.slice(0, TOTAL_SAMPLE_CHARS).trim();

  return {
    ok: true,
    fileCount: files.length,
    totalChars,
    words: Math.round(totalChars / 5.5),
    sample,
    newestName,
    newestAt,
    oldestAt,
  };
}

// ----------------------------------------------------------------------------
// Deterministic fallback cards (always available, even with no model / offline)
// ----------------------------------------------------------------------------

function shortNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function monthYear(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export function deterministicCards(d: BrainDigest): ProfileCard[] {
  return [
    { label: "SECOND BRAIN", value: `${d.fileCount} notes · ~${shortNum(d.words)} words indexed` },
    { label: "TIMELINE", value: `Active ${monthYear(d.oldestAt)} → ${monthYear(d.newestAt)}` },
    {
      label: "LATEST THREAD",
      value: d.newestName ? d.newestName.replace(/\.[a-z]+$/i, "").replace(/[-_/]/g, " ") : "—",
    },
  ];
}

// ----------------------------------------------------------------------------
// AI synthesis via the user's own Claude subscription (headless claude -p).
// No API key — reuses their authenticated CLI. Pure text synthesis (no tools).
// ----------------------------------------------------------------------------

function runClaude(prompt: string, timeoutMs = 90_000): Promise<string> {
  return new Promise((resolve, reject) => {
    // ENOENT (claude not on PATH) and other spawn failures arrive via 'error'.
    const child = spawn("claude", ["-p", "--output-format", "json"], {
      env: process.env,
      detached: true,
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGTERM");
      } catch {
        /* noop */
      }
      reject(new Error("Synthesis timed out"));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => (out += d));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (out.trim()) resolve(out);
      else reject(new Error(err.trim() || `claude exited ${code}`));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function extractCards(text: string): ProfileCard[] {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("No JSON in model output");
  const parsed = JSON.parse(m[0]) as { cards?: Array<{ label?: string; value?: string }> };
  const cards = (parsed.cards || [])
    .filter((c) => c && c.value)
    .slice(0, 3)
    .map((c) => ({
      label: String(c.label || "SIGNAL").toUpperCase().slice(0, 28),
      value: String(c.value).trim().slice(0, 200),
    }));
  if (!cards.length) throw new Error("No cards in model output");
  return cards;
}

export async function synthesizeCards(
  d: BrainDigest,
  name: string,
  bio: string
): Promise<ProfileCard[]> {
  const prompt = `You are generating a terse "operator profile" for someone's personal command-center dashboard.

Their name: ${name || "(unknown)"}.
How they describe themselves: "${bio || "(not provided)"}".

Below are excerpts from their personal "second brain" notes (${d.fileCount} files, most-recent first). Read them and infer who this person actually is and what they are about RIGHT NOW.

Return ONLY a JSON object — no prose, no code fences — in exactly this shape:
{"cards":[{"label":"<2-4 word UPPERCASE label>","value":"<one specific, vivid sentence>"},{"label":"...","value":"..."},{"label":"...","value":"..."}]}

Exactly 3 cards. Make them meaningful and personal — grounded in real specifics from the notes (actual projects, goals, recurring themes), not generic flattery. Strong label ideas: OPERATOR, CURRENT FOCUS, BUILDING TOWARD, SIGNATURE OBSESSION, DEFAULT MODE, OPEN LOOP. Each value under 140 characters. No clichés, no "passionate about".

NOTES:
${d.sample}`;

  const raw = await runClaude(prompt);
  let resultText = raw;
  try {
    const outer = JSON.parse(raw) as { result?: string };
    if (typeof outer.result === "string") resultText = outer.result;
  } catch {
    /* not the json envelope — parse raw directly */
  }
  return extractCards(resultText);
}
