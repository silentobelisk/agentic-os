# Nerve Center

A cinematic **operations console for Claude Code**. One local screen that reads your
Claude Code data and turns it into signal — usage, skills, your second brain, and a
live terminal — without sending anything off your machine.

0. **Operator Profile** (top) — your name and account vitals (plan, member-since),
   plus a hookup to your **second-brain folder**. Drag in (or pick) a folder of
   notes and Nerve Center ingests them locally, then builds an interactive
   **Knowledge Graph** — a force-directed map of the concepts, files, and entities
   in your notes and how they connect. Hubs glow, communities are color-grouped,
   and you can pan / zoom / click any node. The graph is built by running
   `/graphify` headlessly (`claude -p`, no API key) over your notes; nothing leaves
   your machine. Stored in `~/.nerve-center/`.
1. **Terminal** — a stylized, in-page bridge to a live `claude` session. Talk to
   Claude Code right inside the dashboard; it streams a headless run over your
   **subscription** (no API key), with selectable permission modes and multi-turn
   continuity (`--resume`).
2. **Plan Usage** — your **Claude subscription** usage, not API cost. Auto-detects
   your plan (Pro / Max 5× / Max 20× / Team / Enterprise) from Claude Code's local
   config, then shows two live bars — the **5-hour session window** and the
   **weekly window** — with % used, % left, and a countdown to reset (using
   Claude's real `planLimitsEndDate`). Below that, token **throughput** over
   `24H / 7D / 30D / ALL` (tokens, input/output, cache hit rate, sessions). No
   API key, nothing billed — it reads usage you already paid for in your plan.
3. **Most Used Skills** — your skills ranked by how often you've actually
   invoked them. Click any skill to open a composer ("new window") and either
   **Run Inline** (streams a headless `claude -p` run live) or **Launch in
   Terminal** (opens a real interactive `claude` session) — or just copy the
   command.
4. **Social Signal** — track your own creator follower counts for YouTube,
   Instagram, and TikTok. **Free, no API keys** — counts are fetched from your
   machine and cached. Enter a handle or full profile URL per platform.
5. **Industry Signal** — a live board of AI/agent/dev numbers pulled from
   Hacker News and GitHub (story points, comment counts, repo stars), refreshed
   on demand.

It is a **local tool**: everything is read from your machine. No data leaves your
computer except the public Hacker News / GitHub feeds for the signal board and the
public, keyless lookups used for social follower counts.

## Run it

```bash
npm install      # first time only
npm run dev      # then open the printed URL (default http://localhost:3000)
```

> Tip: set a fixed port with `PORT=3737 npm run dev`.

For a production build:

```bash
npm run build && npm run start
```

## How the data works

| Section | Source | Notes |
|---|---|---|
| Profile | `~/.claude.json` (`oauthAccount`) | Plan, account vitals, and a default name read at runtime. |
| Knowledge Graph | your second-brain folder → `~/.nerve-center/` | Notes are ingested locally; `/graphify` (headless `claude -p`) builds the node/edge graph; rendered with a hand-rolled force simulation. Nothing leaves your machine. |
| Usage | `~/.claude/projects/**/*.jsonl` | Parses `assistant` records' `message.usage`. Incrementally cached by file mtime, so first load parses everything, later loads are instant. |
| Skills | `~/.claude/skills`, `~/.claude/plugins/**/skills`, `~/.claude/commands` + transcript invocations | Catalog from `SKILL.md` frontmatter; usage counts from `Skill` tool calls and `<command-name>` tags. |
| Social | public keyless lookups (per platform) | Follower counts fetched locally from your IP and cached. No API keys. |
| Industry | `hn.algolia.com` + `api.github.com` | Keyless public APIs, cached 5 min, graceful offline fallback. |

Costs are **estimates** using standard Anthropic API rates (see
`lib/pricing.ts`) — useful as a relative signal, not a billing statement.

## Stack

Next.js 16 (App Router) · React 19 · Tailwind v4 · Geist fonts · hand-rolled SVG
chart and a dependency-free canvas **force-directed graph** (`lib/force-sim.ts`).
Route handlers run on the Node.js runtime to read the filesystem and spawn the
`claude` CLI.

## Plan usage — how it's computed (and calibrating it)

Plan + reset timing are **exact** (read straight from `~/.claude.json`:
`oauthAccount.organizationRateLimitTier` and `planLimitsEndDate`). The **% used**
is an **estimate**: Anthropic meters plan limits in a weighted compute unit it
doesn't publish as a token count, and the live server-side percentage is only
fetched by Claude Code's interactive `/usage` command — it isn't cached on disk.

So Nerve Center estimates consumption by weighting your local token usage the way
limits actually accrue (output ≫ input ≫ cache reads) and comparing it to a
per-plan budget that scales off a Pro baseline. To make the bars match what
`/usage` shows you exactly, calibrate the budgets for your machine:

```bash
NERVE_SESSION_BUDGET=240 NERVE_WEEKLY_BUDGET=1000 PORT=3737 npm run dev
```

When either is set, the dashboard shows a **CALIBRATED** badge instead of
**ESTIMATED**.

## Config

- `CLAUDE_CONFIG_DIR` — override the Claude home dir (defaults to `~/.claude`).
- `NERVE_DATA_DIR` — override where Nerve Center stores its data (defaults to `~/.nerve-center`).
- `NERVE_SESSION_BUDGET` / `NERVE_WEEKLY_BUDGET` — calibrate plan-usage budgets (weighted units).
- The in-page **Terminal** and "Launch in Terminal" are macOS-oriented (the latter uses `open -a Terminal`).
