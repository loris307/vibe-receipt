# vibe-receipt

> Per-session paper-receipt cards for Claude Code & Codex CLI sessions.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![status](https://img.shields.io/badge/status-v0.1.0-orange)

`vibe-receipt` reads your last AI-coding session JSONL and renders a sharable PNG receipt — tokens, cost, files touched, ESC-rage, deep-thought time, subagent breakdowns, and the rest of the personality stats nobody else surfaces. **100% local** — no upload, no telemetry, no auth.

## Install

```bash
npx vibe-receipt
# or
pnpm dlx vibe-receipt
# or globally:
npm install -g vibe-receipt
```

Requires Node ≥ 20.19.4. macOS / Linux / Windows.

## Usage

```bash
# render the most recent session (Claude Code or Codex CLI)
vibe-receipt

# specific session
vibe-receipt --session 297c7fe2

# combine multiple sessions
vibe-receipt combine --since 2h
vibe-receipt combine --branch feature/oss-saint
vibe-receipt combine --cwd ~/Projects/myrepo

# windows
vibe-receipt today
vibe-receipt week
vibe-receipt year

# install the SessionEnd hook (toast + lazy gen)
vibe-receipt install-hook
```

## What's on the card

The card is split into four sections:

- **SESSION** — duration, model, tokens, cost (USD), cache-hit ratio
- **WORK** — files touched, lines added/removed, bash command count, web fetches
- **TOP TOOLS** — bar chart of the 5 most-used tools (Edit, Bash, Read, Skill, Agent…)
- **SUBAGENTS** — duration + tokens for every dispatched subagent
- **PERSONALITY** — afk, esc-rage, permission flips, yolo mode, deep thought time, skills, slash commands
- **FIRST PROMPT** — word count + mood glyph + content fingerprint (sha:6)

## Privacy: smart-redact by default

Out of the box, the card is screenshot-safe:

| Field | Default | `--reveal` to show |
|---|---|---|
| `cwd` | basename only (`myrepo`, not `~/Desktop/clientwork/NDA/myrepo`) | `paths` |
| Branch | first slash-segment + `…` (`feature/…`) | `paths` |
| File paths | filename only (`page.tsx`) | `paths` |
| First prompt | hidden — only word count + mood + sha-fingerprint | `prompt` |
| AFK recap | `<recap hidden>` | `prompt` |
| Bash commands | omitted entirely | `bash` |

Use `--reveal=all` to opt out of all redaction. The ANSI terminal preview always renders **before** the PNG is written so you can see what's about to leak.

## Output formats

```bash
vibe-receipt --size portrait          # 1080×1350 (default)
vibe-receipt --size story             # 1080×1920 (IG/TikTok story)
vibe-receipt --size og                # 1200×630  (link-unfurl)
vibe-receipt --size all               # all three at once
vibe-receipt --json                   # raw Receipt JSON to stdout
```

## Hooks

`vibe-receipt install-hook` adds a one-line `SessionEnd` hook to `~/.claude/settings.json` that prints a toast (`📸 Receipt ready · vibe-receipt show`) at the end of each Claude Code session. **No PNG is rendered at hook time** — generation is lazy, only when you invoke `vibe-receipt show`. This keeps your disk free of stale PNGs while keeping receipts always one keystroke away.

```bash
vibe-receipt install-hook    # adds the hook + writes a settings.json.bak
vibe-receipt hook-status     # check whether it's installed
vibe-receipt uninstall-hook  # remove it
```

## Sources

`vibe-receipt` reads JSONL sessions from:

- `~/.claude/projects/**/*.jsonl` (Claude Code, also reads `~/.config/claude/projects/`)
- `~/.codex/sessions/**/*.jsonl` (OpenAI Codex CLI)

Token + cost data for Claude is computed via [`ccusage`](https://github.com/ryoppippi/ccusage)'s LiteLLM-fetched price table, with a hardcoded fallback for fresh Anthropic models. Codex pricing is local-table-only for v1.

## Languages

English by default. Optional German variant via `--lang de` (renames the masthead to **VIBE BON**).

## Roadmap

- v1.0 — Claude Code + Codex sources · single + combine + window modes · hook · DE/EN
- v1.1 — schema-drift canary, OG layout fixes, optional AI mood scoring (opt-in)
- v2.0 — wrapped engine: persistent SQLite history, streaks, achievements, comparisons; Cursor source via wrapped existing parsers
- v3 — speculative: opt-in cloud share, VS Code surfacing

See [`docs/spec.md`](docs/spec.md) for the full design spec.

## License

MIT — see [LICENSE](LICENSE).

## Credits

- [`ccusage`](https://github.com/ryoppippi/ccusage) by ryoppippi — Claude Code data loader, MIT.
- [Satori](https://github.com/vercel/satori) by Vercel — JSX → SVG renderer, MIT.
- [`@resvg/resvg-js`](https://github.com/yisibl/resvg-js) — SVG → PNG, MPL-2.0.
- [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) — bundled font, OFL-1.1.

Built by [@loris307](https://github.com/loris307).
