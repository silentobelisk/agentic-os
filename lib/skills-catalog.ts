import fs from "node:fs";
import path from "node:path";
import { globalSkillsDir, pluginsDir, commandsDir } from "./paths";
import { getSkillEvents } from "./transcripts";
import { getClaudeConfig } from "./plan";
import type { SkillEntry, SkillsResponse } from "./types";

// Read only the head of a SKILL.md to pull YAML frontmatter cheaply.
function readFrontmatter(file: string): { name?: string; description?: string } {
  let head: string;
  try {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    head = buf.toString("utf8", 0, n);
  } catch {
    return {};
  }
  const fm = head.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fm) return {};
  const body = fm[1];
  const name = body.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  // description may be a long single line, possibly quoted
  let description = body.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (description) description = description.replace(/^["']|["']$/g, "");
  return { name, description };
}

function shortDesc(desc: string | undefined, fallback: string): string {
  if (!desc) return fallback;
  // take the first sentence / clause for the card
  const firstSentence = desc.split(/(?<=[.!?])\s/)[0];
  return firstSentence.length > 160 ? firstSentence.slice(0, 157) + "…" : firstSentence;
}

const CATEGORY_RULES: [RegExp, string][] = [
  [/research|deep-research|brief|competitor|topics|find-topics/, "RESEARCH"],
  [/ad|ads|creative|recontextualize/, "ADS"],
  [/video|clip|motion|overlay|transcribe|download|remotion|luxury/, "VIDEO"],
  [/thumbnail|design|graphic|carousel|nano-banana|excalidraw|figma/, "DESIGN"],
  [/deploy|form-hookup|conversion|landing|website|clone/, "WEB"],
  [/x-post|tweet|skool|youtube|yt-|post|content|calendar|announcement/, "SOCIAL"],
  [/security|audit|graphify|skill-creator|config|keybind/, "SYSTEM"],
];

function categorize(slug: string): string {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(slug)) return cat;
  return "MISC";
}

function entryFromName(slug: string, name: string, description: string, source: SkillEntry["source"], plugin?: string): SkillEntry {
  const bare = slug.includes(":") ? slug.split(":").pop()! : slug;
  return {
    slug,
    name: (name || bare).replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    command: "/" + slug,
    description: shortDesc(description, "Claude Code skill."),
    source,
    plugin,
    count: 0,
    lastUsed: null,
    category: categorize(slug),
  };
}

function enumerateCatalog(): Map<string, SkillEntry> {
  const map = new Map<string, SkillEntry>();

  // global skills: ~/.claude/skills/<slug>/SKILL.md
  try {
    for (const d of fs.readdirSync(globalSkillsDir(), { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const skillFile = path.join(globalSkillsDir(), d.name, "SKILL.md");
      if (!fs.existsSync(skillFile)) continue;
      const fm = readFrontmatter(skillFile);
      const slug = (fm.name || d.name).toLowerCase();
      map.set(slug, entryFromName(slug, fm.name || d.name, fm.description || "", "global"));
    }
  } catch {
    /* no global skills dir */
  }

  // plugin skills: ~/.claude/plugins/**/skills/<slug>/SKILL.md
  const pdir = pluginsDir();
  const pluginSkillFiles: string[] = [];
  const walkPlugins = (dir: string, depth: number) => {
    if (depth > 6) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walkPlugins(p, depth + 1);
      else if (e.isFile() && e.name === "SKILL.md" && p.includes(`${path.sep}skills${path.sep}`)) {
        pluginSkillFiles.push(p);
      }
    }
  };
  walkPlugins(pdir, 0);

  for (const file of pluginSkillFiles) {
    const segs = file.split(path.sep);
    const skillsIdx = segs.lastIndexOf("skills");
    if (skillsIdx < 1) continue;
    const skillName = segs[skillsIdx + 1];
    const plugin = segs[skillsIdx - 1];
    const fm = readFrontmatter(file);
    const slug = `${plugin}:${skillName}`.toLowerCase();
    if (!map.has(slug)) map.set(slug, entryFromName(slug, fm.name || skillName, fm.description || "", "plugin", plugin));
  }

  // custom slash commands: ~/.claude/commands/<slug>.md
  try {
    for (const f of fs.readdirSync(commandsDir())) {
      if (!f.endsWith(".md")) continue;
      const slug = f.replace(/\.md$/, "").toLowerCase();
      if (map.has(slug)) continue;
      const fm = readFrontmatter(path.join(commandsDir(), f));
      map.set(slug, entryFromName(slug, fm.name || slug, fm.description || "", "command"));
    }
  } catch {
    /* no commands dir */
  }

  return map;
}

// Resolve a usage-event slug to a catalog key (handles bare ↔ namespaced).
function resolve(eventSlug: string, catalog: Map<string, SkillEntry>, bareIndex: Map<string, string>): string | null {
  if (catalog.has(eventSlug)) return eventSlug;
  const bare = eventSlug.includes(":") ? eventSlug.split(":").pop()! : eventSlug;
  if (catalog.has(bare)) return bare;
  if (bareIndex.has(bare)) return bareIndex.get(bare)!;
  return null;
}

export async function buildSkills(): Promise<SkillsResponse> {
  const catalog = enumerateCatalog();
  const bareIndex = new Map<string, string>();
  for (const [slug] of catalog) {
    const bare = slug.includes(":") ? slug.split(":").pop()! : slug;
    if (!bareIndex.has(bare)) bareIndex.set(bare, slug);
  }

  let totalInvocations = 0;
  const skillUsage = getClaudeConfig().skillUsage;

  if (skillUsage && Object.keys(skillUsage).length) {
    // Preferred: Claude Code's own authoritative lifetime tally in ~/.claude.json.
    // This is the real per-skill usage count and last-used time — no transcript
    // heuristics, no command/tool double-count to untangle.
    for (const [name, v] of Object.entries(skillUsage)) {
      const slug = String(name).toLowerCase();
      let key = resolve(slug, catalog, bareIndex);
      if (!key) {
        catalog.set(slug, entryFromName(slug, slug, "", slug.includes(":") ? "plugin" : "global"));
        const bare = slug.includes(":") ? slug.split(":").pop()! : slug;
        if (!bareIndex.has(bare)) bareIndex.set(bare, slug);
        key = slug;
      }
      const entry = catalog.get(key)!;
      const c = v?.usageCount || 0;
      entry.count += c;
      totalInvocations += c;
      if (v?.lastUsedAt && (entry.lastUsed === null || v.lastUsedAt > entry.lastUsed)) {
        entry.lastUsed = v.lastUsedAt;
      }
    }
  } else {
    // Fallback: derive counts from transcripts. A skill dispatched via the Skill
    // tool in response to a slash command emits BOTH a <command-name> event and a
    // Skill tool_use event for one invocation; max(commandCount, toolCount) avoids
    // both the double-count and undercounting autonomous tool calls.
    const events = await getSkillEvents();
    for (const ev of events) {
      if (ev.source !== "tool") continue;
      if (resolve(ev.skill, catalog, bareIndex)) continue;
      catalog.set(ev.skill, entryFromName(ev.skill, ev.skill, "", "plugin"));
      const bare = ev.skill.includes(":") ? ev.skill.split(":").pop()! : ev.skill;
      if (!bareIndex.has(bare)) bareIndex.set(bare, ev.skill);
    }
    const tally = new Map<string, { cmd: number; tool: number; last: number }>();
    for (const ev of events) {
      const key = resolve(ev.skill, catalog, bareIndex);
      if (!key) continue;
      const e = tally.get(key) || { cmd: 0, tool: 0, last: 0 };
      if (ev.source === "tool") e.tool += 1;
      else e.cmd += 1;
      if (ev.t > e.last) e.last = ev.t;
      tally.set(key, e);
    }
    for (const [key, e] of tally) {
      const entry = catalog.get(key);
      if (!entry) continue;
      entry.count = Math.max(e.cmd, e.tool);
      entry.lastUsed = e.last || null;
      totalInvocations += entry.count;
    }
  }

  const skills = [...catalog.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if ((b.lastUsed || 0) !== (a.lastUsed || 0)) return (b.lastUsed || 0) - (a.lastUsed || 0);
    return a.name.localeCompare(b.name);
  });

  return { skills, totalInvocations, generatedAt: Date.now() };
}
