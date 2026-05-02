# vibe-receipt

> A beautiful paper-receipt card for every Claude Code & Codex CLI session.
> Tokens, cost, files touched, deep-thought time, ESC-rage — all in a screenshot you can actually share.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![status](https://img.shields.io/badge/status-v0.1.0-orange)
![tested-against](https://img.shields.io/badge/tested-Claude%20Code%20%2B%20Codex%20CLI-blueviolet)

<p align="center">
  <img src="docs/images/hero.png" width="540" alt="Single-session receipt example">
</p>

**100% local.** No upload, no telemetry, no auth. Reads your existing session logs and renders a PNG you can drop in a tweet, story, or video.

---

## Quickstart (60 seconds)

You need Node 20+ on your machine. Check with `node --version`.

```bash
# 1. Clone the repo
git clone https://github.com/loris307/vibe-receipt
cd vibe-receipt

# 2. Install dependencies
pnpm install     # or: npm install

# 3. Build it
pnpm build       # or: npm run build

# 4. Run it on your last Claude Code session
node dist/cli.mjs
```

That's it. You'll see a terminal preview, and a PNG saved to `./vibe-receipts/<session-id>.png`.

> **Want to type just `vibe-receipt` from anywhere?** Run `pnpm link --global` once in the repo. Reverse with `pnpm unlink --global vibe-receipt`.

---

## What you get

After a session, the receipt summarizes:

| Section | Stats |
|---|---|
| **SESSION** | duration · model · total tokens · cost (USD) · cache-hit ratio · longest solo-stretch · peak burn rate · rate-limit hits · vs last session · vs last 7 days |
| **WORK** | files touched · lines added/removed · bash commands · web fetches · most-edited single file · $/line shipped |
| **TOP TOOLS** | bar chart of your 5 most-used tools (Edit, Bash, Read, Skill, Agent, …) |
| **SUBAGENTS** | count · total time · total tokens · total tool calls |
| **PERSONALITY** | afk · ESC-rage · permission flips · YOLO mode · deep thought time · skills · slash commands · wait-then-go · manners (please/thanks/sorry) |
| **PROMPTING** | total prompts · longest/shortest/avg length · first-prompt preview · shortest prompt full text |
| **BADGES** | up to 3 rarity-ordered achievements (token-millionaire 🏆, big-spender 💸, marathoner 🏃, auto-pilot 🤝, deep-thinker 🧠, no-error-streak 🔥, sprinter ⚡, toolbox-master 🛠, night-owl 🌙, researcher 📚, bug-hunter 🐛, polite 🙏) |
| **ARCHETYPE** | one of 8 personas stamped at the foot — The Specifier · The Vibe-Coder · The Fixer · The Researcher · The Firefighter · The Trustfall Pilot · The ESC-Rager · The Night Owl |

### v0.2: persistent history & comparisons

`vibe-receipt` now keeps a local `~/.vibe-receipt/history.jsonl` (one row per render, redacted, idempotent). Inspect or wipe it:

```bash
vibe-receipt history list
vibe-receipt history clear
vibe-receipt history export
VIBE_RECEIPT_NO_HISTORY=1 vibe-receipt    # opt-out
```

The receipt's "vs last session" and "week rank" italic lines come from this history file. Combine modes don't appear in history.

---

## Common commands

```bash
# Most recent session (Claude Code or Codex CLI — whichever was last)
vibe-receipt

# Specific session
vibe-receipt --session 297c7fe2

# Combine: merge multiple sessions into one receipt
vibe-receipt combine --since 1h          # last hour
vibe-receipt combine --since 24h         # last day
vibe-receipt combine --cwd .             # only sessions from this directory
vibe-receipt combine --branch feature/x  # only sessions on this git branch

# Window modes — pre-set time ranges
vibe-receipt today                       # everything since midnight (local)
vibe-receipt week                        # last 7 days
vibe-receipt year                        # current calendar year

# Output formats — different sizes always produce different files (suffix in name)
vibe-receipt --size portrait    # default · 1080×min 1500, auto-extends if heavy content
vibe-receipt --size story       # 1080×1920 fixed · IG/TikTok story
vibe-receipt --size og          # 1200×630 fixed · link-unfurl preview
vibe-receipt --size all         # writes all three (no overwriting)

# JSON instead of PNG
vibe-receipt --json

# Diagnostics
vibe-receipt sources    # which JSONL dirs / how many sessions / how big
vibe-receipt doctor     # health check (fonts, resvg, ccusage all loaded)
vibe-receipt --help
```

---

## Privacy: smart-redact by default

Receipts are screenshot-safe out of the box. Sensitive fields are redacted unless you explicitly opt in:

| Field | Default behavior | Opt in with |
|---|---|---|
| Project path | basename only (`myrepo`, not `~/Desktop/clientwork/NDA/myrepo`) | `--reveal=paths` |
| Git branch | first slash-segment + `…` (`feature/…`) | `--reveal=paths` |
| File paths | filename only (`page.tsx` instead of `apps/secret/page.tsx`) | `--reveal=paths` |
| First prompt | shown as `N words · mood-glyph · sha-fingerprint` only | `--reveal=prompt` |
| AFK recap text | replaced with `<recap hidden>` | `--reveal=prompt` |
| Bash commands | omitted entirely | `--reveal=bash` |

```bash
vibe-receipt --reveal=paths,prompt   # show paths and first-prompt content
vibe-receipt --reveal=all            # show everything
```

The ANSI preview always renders BEFORE the PNG is written so you can see what's about to leak.

---

## Auto-receipt on session end (optional hook)

Want a little 📸 toast every time a Claude Code session ends? Install the hook:

```bash
vibe-receipt install-hook    # patches ~/.claude/settings.json (with backup)
vibe-receipt hook-status     # check it's installed
vibe-receipt uninstall-hook  # remove it
```

When a session ends, you'll see:
```
📸 Receipt ready · vibe-receipt show
```

**The hook does NOT auto-render.** It only writes a one-line index entry. You generate the PNG when you actually want it via `vibe-receipt show` — keeps your disk free of stale PNGs.

---

## Combine receipts across sessions

Real-world AI coding rarely fits in one session. You'll spawn parallel worktrees, hop between projects, run subagents. The `combine` command merges them into one card:

<p align="center">
  <img src="docs/images/combined.png" width="540" alt="Combined receipt across 6 sessions">
</p>

The combined card shows:
- `wall window` — earliest start to latest end across all merged sessions
- `active time` — sum of model-active time (can exceed `wall window` for parallel sessions — by design)
- All cost / token / file / personality numbers summed across sessions

---

## Where the data comes from

vibe-receipt reads existing JSONL session logs that Claude Code and Codex CLI already write. **Nothing is uploaded; nothing is sent anywhere.**

- **Claude Code:** `~/.claude/projects/<project>/<session-uuid>.jsonl` (also `~/.config/claude/projects/` if XDG)
- **Codex CLI:** `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
- **Subagent transcripts** (under `<session-uuid>/subagents/`) are summed for cost but don't appear as separate sessions

Token + cost computation is sourced from:
1. [`ccusage`](https://github.com/ryoppippi/ccusage) when its LiteLLM-fetched pricing table has the model
2. A bundled fallback table (`src/extract/claude-pricing.ts`) for fresh models LiteLLM hasn't picked up yet — currently calibrated against [Anthropic's official pricing page](https://platform.claude.com/docs/en/about-claude/pricing) (verified May 2026)

---

## Languages

English by default. German variant via `--lang de` (renames the masthead to **VIBE BON**, all section headers translated).

---

## Troubleshooting

**"command not found: vibe-receipt"**
You haven't installed it globally yet. Either:
- Run `node /path/to/vibe-receipt/dist/cli.mjs ...` directly, or
- `cd /path/to/vibe-receipt && pnpm link --global` to make `vibe-receipt` available everywhere.

**"no sessions found"**
Either you haven't run a Claude Code or Codex session yet on this machine, or you're filtering too tightly. Run `vibe-receipt sources` to see what JSONL files exist.

**"fonts: FAIL — bundled fonts not found"**
The package didn't ship its fonts. Re-run `pnpm install && pnpm build` from the repo.

**Cost looks too high / too low**
Anthropic's actual billing may differ slightly from what receipts show, mainly for two reasons:
- Opus 4.7 ships a new tokenizer that produces ~35% more tokens for the same text. JSONL counts are pre-tokenizer; billing may differ.
- ccusage's LiteLLM table may not include the very newest model — fallback table is used. Compare against [Anthropic console](https://console.anthropic.com) for ground truth.

**The PNG is clipping at the bottom**
Should not happen — heights auto-extend based on content. If it does, please file an issue with the `--json` output.

**JSON output has weird `[ccusage] ℹ Loaded pricing` line at top**
Update — that was fixed in v0.1.x. Run `pnpm build` again.

---

## FAQ

**Does this cost anything to run?**
No. It only reads files that already exist on your disk. No API calls.

**Do you upload anything?**
No. Zero outbound network calls in render or extract paths. The only network call is ccusage's pricing-table fetch from LiteLLM (cached); set `VIBE_RECEIPT_OFFLINE=1` to disable even that.

**Can I share my receipt without leaking secrets?**
Yes — that's the whole point. Default rendering hides paths, prompts, and bash commands. The ANSI preview shows you exactly what the PNG will contain before it's written.

**Does it work with Cursor / Copilot / JetBrains AI?**
Not yet. Cursor stores its history in SQLite blobs that change format every minor release — too fragile for v1. Copilot doesn't persist local stats at all. Open an issue if you want it.

**Why does `combine --since 1h` sometimes show 5 sessions when I only had 2?**
Older versions counted subagent transcripts as separate sessions. Fixed in commit `cbaf124` — update.

---

## Roadmap

- **v1.0** — Claude Code + Codex CLI sources · single + combine + window modes · hook · DE/EN ✓
- **v1.1** — schema-drift canary, OG (1200×630) layout polish, optional AI-mood scoring (opt-in)
- **v2.0** — wrapped engine: persistent SQLite history, streaks, achievements, year-in-review comparisons, Cursor support
- **v3** (speculative) — opt-in cloud share for `vibe-receipt.dev/r/<hash>`, VS Code panel

See [`docs/spec.md`](docs/spec.md) for the full design spec.

---

## License

MIT — see [LICENSE](LICENSE).

## Credits

- [`ccusage`](https://github.com/ryoppippi/ccusage) by [@ryoppippi](https://github.com/ryoppippi) — Claude Code data loader (MIT)
- [Satori](https://github.com/vercel/satori) by Vercel — JSX → SVG renderer (MIT)
- [`@resvg/resvg-js`](https://github.com/yisibl/resvg-js) — SVG → PNG (MPL-2.0)
- [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) — bundled font (OFL-1.1)

Built by [@loris307](https://github.com/loris307) · vibe-coding YouTube channel: [@lorisgaller](https://www.youtube.com/@lorisgaller)
