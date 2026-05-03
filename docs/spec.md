---
title: vibe-receipt — Design Spec
date: 2026-05-01
status: draft
owner: loris307
audience: implementer (solo, 1–2 weeks)
---

# vibe-receipt

A pure-local CLI that turns each AI-coding session (Claude Code, OpenAI Codex CLI) into a beautiful, screenshot-ready paper-receipt PNG. Differentiator: per-session cadence (not year-end), monospace receipt aesthetic, and personality stats no other tool extracts (ESC interrupts, permission flips, deep-thought time, subagent breakdowns, AFK summaries).

## 1. TL;DR

`npx vibe-receipt` reads your most recent Claude Code or Codex session JSONL, normalizes it via `ccusage/data-loader` and `@ccusage/codex` plus a custom personality-fields extractor, applies smart-redaction, renders a paper-receipt PNG via Satori + resvg-js, prints a Unicode-block ANSI preview to the terminal, and saves the file to `./vibe-receipts/<session-id>.png`. A `SessionEnd` Claude Code hook (opt-in via `vibe-receipt install-hook`) emits a one-line "📸 Receipt ready: vibe-receipt show" toast at the end of each session — generation stays lazy. Combine modes (`--since`, `--branch`, `--cwd`) merge multiple JSONLs into one card to handle parallel worktrees and feature-branches.

## 2. Background & motivation

Loris runs the German YouTube channel `@lorisgaller` covering Claude Code, vibe-coding, and OSS-solo-founder content. The receipt is the *teilbare Artefakt-Schicht* (shareable artifact layer) of every coding stream — every session ends with a clip-friendly card.

**Why now**: vibe-coding is mainstream in 2026 ($4.7B market, 92% of US devs use AI tools daily). `ccusage` (13.7k ⭐) dominates terminal usage analytics but explicitly does not produce share cards. Three projects already ship Claude-Code wrapped PNGs (`numman-ali/cc-wrapped`, `codecard.dev`, `isaadgulzar/year-in-code`) but all are year-end-framed and Claude-only. Cursor shipped its own first-party `cursor.com/2025` Year-in-Code. The lane for *per-session, multi-source, sharply-designed receipts* is open and closing fast — mover advantage matters.

**Strategic wedge** (locked-in via brainstorm Q1):

1. **Per-session cadence.** Recurring drumbeat of share-worthy artifacts; competitors are stuck in once-a-year frame.
2. **Monospace paper-receipt aesthetic.** Distinct from gradient-block Wrapped imitations.
3. **Personality stats.** Fields no extant tool surfaces: ESC interrupts, permission-mode flips, extended-thinking duration, subagent breakdowns, slash/skill invocations, AFK summaries, structuredPatch line deltas.
4. **Multi-source unifier (Claude + Codex day-1).** Cursor and Copilot deliberately deferred — Cursor's local logs are SQLite blobs with schema drift, Copilot has no extractable local stats.

## 3. Non-goals

- No web app, no public hosting, no public gallery. Pure local CLI. ([Q3])
- No Cursor support in v1. SQLite-blob complexity + multi-GB DBs + schema drift = bad ROI for a 1–2 week build. Defer to v2 by wrapping `saharmor/cursor-view` rather than writing from scratch.
- No GitHub Copilot, no JetBrains AI, no Cody, no Aider in v1. Add via the Source convention as demand emerges.
- No persistent receipt history database, no streaks, no leaderboards, no global cohort comparison. Those are v2 ("Wrapped Engine") and warrant their own content drop.
- No cloud upload, no auth, no telemetry. Zero outbound network calls except: `ccusage`'s LiteLLM pricing fetch (already cached), and explicit `--check-update` invocations.
- No clipboard auto-copy. ([Q9 user override])
- No OG-image generator, no `/r/<hash>` route, no Next.js — these were considered and explicitly dropped.

## 4. Personas & primary use cases

**P1 — Loris (channel creator).** German vibe-coding YouTuber. Wants every coding session to end with a tweet-ready, video-thumbnail-ready PNG. Heavy Claude Code user, occasional Codex. Will install the SessionEnd hook on day 1 and run `vibe-receipt combine --since 4h` after multi-agent worktree streams.

**P2 — Channel viewer / German Vibe-Coder.** Sees the receipt in a video → installs `npx vibe-receipt` → tries it on their last session → tweets it with `#vibereceipt` hashtag. Distribution loop.

**Top use cases:**

1. *"Tweet my last Claude session."* `npx vibe-receipt` → ANSI preview in terminal → PNG saved to `./vibe-receipts/<uuid>.png` → user screenshots/uploads.
2. *"Show what these 4 parallel worktrees did combined."* `vibe-receipt combine --since 2h` → one merged receipt across all JSONLs in that window.
3. *"Receipt for an entire feature branch."* `vibe-receipt combine --branch feature/oss-saint` → merged receipt across all sessions on that branch.
4. *"This week's wrapped."* `vibe-receipt week` → aggregate over last 7 days.
5. *"Year-end content drop."* `vibe-receipt year` → all sessions of the calendar year.
6. *"Auto-toast after every session."* SessionEnd hook prints a one-line tip; user invokes `vibe-receipt show` when they want to render.

## 5. CLI surface

Distribution: `npx vibe-receipt <command>` (also `bunx vibe-receipt`, `pnpm dlx vibe-receipt`). All commands are read-only except `install-hook` and `uninstall-hook`. (Q7, Q8)

```
vibe-receipt                                 # render receipt for the most recent session (any source)
vibe-receipt show                            # alias for the bare command
vibe-receipt --session <uuid>                # render a specific session by uuid
vibe-receipt --source claude|codex           # restrict source when picking the most recent

# Aggregation
vibe-receipt combine --since <duration>      # e.g. 1h, 30m, 2d
vibe-receipt combine --branch <branch>       # e.g. feature/oss-saint  (matches gitBranch in events)
vibe-receipt combine --cwd <path>            # absolute or relative path; matches event.cwd
vibe-receipt today                           # all sessions started today (local TZ)
vibe-receipt week                            # rolling last 7 days
vibe-receipt year                            # current calendar year

# Output controls
--out <path>                                 # default: ./vibe-receipts/<session-id-or-hash>.png
--size portrait|story|og|all                 # default: portrait (1080×1350)
--no-preview                                 # skip the ANSI terminal preview
--reveal paths|prompt|bash|all               # opt out of smart-redact for those fields
--review                                     # interactive: show ANSI preview, prompt y/N before writing PNG
--json                                       # emit the raw Receipt JSON to stdout instead of PNG

# Hook management
vibe-receipt install-hook                    # adds SessionEnd hook to ~/.claude/settings.json (with backup)
vibe-receipt uninstall-hook                  # removes it
vibe-receipt hook-status                     # prints whether the hook is installed and where
vibe-receipt --hook-receive                  # internal: receives Claude Code's SessionEnd payload on stdin
                                             # (called by the installed hook entry; not for end users)

# Diagnostics
vibe-receipt sources                         # lists detected JSONL files per source with counts
vibe-receipt doctor                          # health check: fonts loaded, paths writable, ccusage version
```

Examples:
```
# Default
$ npx vibe-receipt
[ANSI receipt preview rendered here]
✓ saved → ./vibe-receipts/297c7fe2.png  (148 KB)

# Combine 4 parallel worktrees from the last 2 hours
$ vibe-receipt combine --since 2h --reveal=paths
✓ merged 4 sessions  ·  saved → ./vibe-receipts/combined-2026-05-01-2329.png

# Year-end drop with story format
$ vibe-receipt year --size=story --out ~/Desktop/2026-wrapped.png
```

## 6. Architecture

Single npm package, layered:

```
            ┌──────────────────────────────────────┐
            │              CLI (gunshi)             │
            └────────────────────┬─────────────────┘
                                 │
   ┌─────────────────────────────┴─────────────────────────────┐
   │                       Aggregator                          │
   │   single │ combine(since|branch|cwd) │ window(today|week│
   │                          │year)                           │
   └───────────────┬───────────┴───────────────────────┬───────┘
                   │                                   │
       ┌───────────┴────────────┐         ┌────────────┴──────┐
       │  Source: Claude Code   │         │  Source: Codex CLI│
       │  ┌──────────────────┐  │         │ ┌───────────────┐ │
       │  │ ccusage/data-    │  │         │ │ @ccusage/codex│ │
       │  │ loader (tokens,  │  │         │ │ (tokens, cost)│ │
       │  │ cost, model)     │  │         │ └───────┬───────┘ │
       │  └────────┬─────────┘  │         │         │         │
       │  ┌────────┴─────────┐  │         │ ┌───────┴───────┐ │
       │  │ Personality      │  │         │ │ Personality   │ │
       │  │ extractor        │  │         │ │ extractor     │ │
       │  │ (custom JSONL)   │  │         │ │ (custom JSONL)│ │
       │  └──────────────────┘  │         │ └───────────────┘ │
       └─────────────┬──────────┘         └────────┬──────────┘
                     │                             │
                     └──────────────┬──────────────┘
                                    │
                            ┌───────┴────────┐
                            │   Normalizer   │
                            │   → Receipt    │
                            └───────┬────────┘
                                    │
                            ┌───────┴────────┐
                            │   Redactor     │
                            │ (smart-redact) │
                            └───────┬────────┘
                                    │
                ┌───────────────────┼─────────────────┐
                │                                     │
        ┌───────┴─────────┐                  ┌────────┴────────┐
        │ Renderer: PNG   │                  │ Renderer: ANSI  │
        │ Satori → resvg  │                  │ chalk + box-art │
        └─────────────────┘                  └─────────────────┘
```

(Q-architecture)

## 7. Source code structure

```
vibe-receipt/
├── src/
│   ├── cli.ts                       # entry; defines all gunshi commands
│   ├── version.ts                   # generated at build time
│   │
│   ├── extract/
│   │   ├── claude.ts                # imports `loadSessionData` from ccusage; layers personality fields
│   │   ├── codex.ts                 # imports `@ccusage/codex/data-loader`; layers personality fields
│   │   ├── personality/
│   │   │   ├── claude-jsonl.ts      # ESC interrupts, permission flips, thinking blocks, away_summary, etc.
│   │   │   └── codex-jsonl.ts       # equivalent for codex events (subset; Codex schema is leaner)
│   │   └── normalize.ts             # union { ClaudeRaw, CodexRaw } → NormalizedSession
│   │
│   ├── aggregate/
│   │   ├── single.ts
│   │   ├── combine.ts               # filter by since|branch|cwd, merge into one Receipt
│   │   ├── window.ts                # today|week|year (calls combine internally)
│   │   └── pick-most-recent.ts      # default-mode picker across sources
│   │
│   ├── data/
│   │   ├── receipt-schema.ts        # valibot schema, exported type Receipt
│   │   └── pricing.ts               # re-export ccusage's pricing for codex personality cost
│   │
│   ├── redact/
│   │   ├── smart-redact.ts          # main rule engine
│   │   └── fingerprint.ts           # sha-prefix + emoji-mood from text
│   │
│   ├── render/
│   │   ├── card.tsx                 # Satori JSX root component (paper-receipt layout)
│   │   ├── sections/
│   │   │   ├── header.tsx
│   │   │   ├── session.tsx
│   │   │   ├── work.tsx
│   │   │   ├── tools.tsx            # mini-bar chart (handcrafted SVG)
│   │   │   ├── subagents.tsx
│   │   │   ├── personality.tsx
│   │   │   ├── first-prompt.tsx
│   │   │   └── footer.tsx
│   │   ├── png.ts                   # satori → SVG → @resvg/resvg-js → PNG buffer
│   │   ├── sizes.ts                 # portrait|story|og dimension presets
│   │   ├── theme.ts                 # color palette, accent gradient, font registration
│   │   └── ansi.ts                  # terminal preview using chalk + box-drawing chars
│   │
│   ├── hook/
│   │   ├── install.ts               # patches ~/.claude/settings.json with SessionEnd entry
│   │   ├── uninstall.ts
│   │   ├── on-session-end.ts        # hook handler; appends to ~/.vibe-receipt/index.jsonl
│   │   └── settings-io.ts           # safe read-modify-write with .bak backup
│   │
│   ├── i18n/
│   │   └── en.ts
│   │
│   └── util/
│       ├── duration.ts              # ms → "25m 24s"
│       ├── compact-number.ts        # 47287 → "47.2k"
│       └── git.ts                   # branch from cwd via `git rev-parse --abbrev-ref HEAD`
│
├── assets/
│   └── fonts/
│       ├── JetBrainsMono-Regular.ttf      # OFL license
│       ├── JetBrainsMono-Bold.ttf
│       └── Inter-SemiBold.ttf             # OFL license (heading accent)
│
├── tests/
│   ├── fixtures/
│   │   ├── claude/short-session.jsonl
│   │   ├── claude/with-subagents.jsonl
│   │   ├── claude/with-compaction.jsonl
│   │   ├── codex/standard-session.jsonl
│   │   └── codex/no-turn-context.jsonl
│   ├── extract/claude.test.ts
│   ├── extract/codex.test.ts
│   ├── aggregate/combine.test.ts
│   ├── redact/smart-redact.test.ts
│   ├── render/snapshot.test.ts            # PNG hash + SVG snapshot
│   └── e2e/cli.test.ts                    # spawns the bundled binary
│
├── package.json                            # bin: { vibe-receipt: dist/cli.js }
├── tsdown.config.ts
├── vitest.config.ts
├── tsconfig.json
├── biome.json                              # linter
└── README.md
```

## 8. Data model — the unified Receipt

```ts
// src/data/receipt-schema.ts
import * as v from 'valibot';

export const ReceiptScopeSchema = v.union([
  v.object({ kind: v.literal('single'),    sessionId: v.string() }),
  v.object({ kind: v.literal('combine-since'),  since: v.string() /* ISO duration, e.g. PT2H */ }),
  v.object({ kind: v.literal('combine-branch'), branch: v.string() }),
  v.object({ kind: v.literal('combine-cwd'),    cwd: v.string() }),
  v.object({ kind: v.literal('window-today') }),
  v.object({ kind: v.literal('window-week') }),
  v.object({ kind: v.literal('window-year'),    year: v.number() }),
]);

export const ToolStatSchema = v.object({
  name:  v.string(),       // "Edit", "Bash", "Read", "Skill", "Agent", ...
  count: v.number(),
});

export const SubagentSchema = v.object({
  type:           v.string(),       // "Explore", "general-purpose", "code-reviewer", ...
  durationMs:     v.number(),
  totalTokens:    v.number(),
  toolUseCount:   v.number(),
});

export const ReceiptSchema = v.object({
  scope:        ReceiptScopeSchema,
  generatedAt:  v.string(),         // ISO timestamp of render

  meta: v.object({
    project:    v.string(),         // basename of cwd (smart-redacted by default)
    branch:     v.nullable(v.string()),
    sources:    v.array(v.union([v.literal('claude'), v.literal('codex')])),
    sessionCount: v.number(),       // 1 for single, N for combine
  }),

  time: v.object({
    startUtc:        v.string(),    // ISO
    endUtc:          v.string(),
    durationMs:      v.number(),
    activeMs:        v.number(),    // sum of turn_durations
    afkMs:           v.number(),    // duration - active
    afkRecaps:       v.array(v.string()),  // away_summary contents (truncated, redacted)
  }),

  cost: v.object({
    totalUsd:        v.number(),
    inputTokens:     v.number(),
    outputTokens:    v.number(),
    cacheCreateTokens: v.number(),
    cacheReadTokens: v.number(),
    cacheHitRatio:   v.number(),    // 0..1
    models:          v.array(v.string()),
  }),

  work: v.object({
    filesTouched:    v.number(),
    topFiles:        v.array(v.object({  // length 0..5; redaction may shrink to filename only
      path:          v.string(),
      added:         v.number(),
      removed:       v.number(),
    })),
    linesAdded:      v.number(),
    linesRemoved:    v.number(),
    bashCommands:    v.number(),
    webFetches:      v.number(),
    userModified:    v.number(),    // count of toolUseResult.userModified === true
  }),

  tools: v.object({
    total:           v.number(),
    top:             v.array(ToolStatSchema),  // length 0..5, sorted desc
  }),

  subagents: v.array(SubagentSchema),  // length 0..N, sorted by durationMs desc

  personality: v.object({
    escInterrupts:    v.number(),                // toolUseResult.interrupted === true on Bash
    permissionFlips:  v.number(),                // distinct permission-mode events
    yoloEvents:       v.number(),                // count of bypassPermissions
    thinkingMs:       v.number(),                // sum of extended-thinking durations
    skills:           v.array(v.string()),       // up to 3
    slashCommands:    v.array(v.string()),       // up to 3
    truncatedOutputs: v.number(),                // "Output truncated" hook responses
    hookErrors:       v.number(),
    longestUserMsgChars: v.number(),
  }),

  firstPrompt: v.object({
    wordCount:       v.number(),
    charCount:       v.number(),
    moodEmoji:       v.string(),                 // 1–2 emoji chosen by simple heuristic
    fingerprintSha:  v.string(),                 // first 6 chars of sha256 of normalized prompt
    revealed:        v.nullable(v.string()),     // populated only if --reveal=prompt
  }),
});

export type Receipt = v.InferOutput<typeof ReceiptSchema>;
```

## 9. Data sources & extractors

### 9.1 Claude Code

Path: read every JSONL under both `~/.claude/projects/**/*.jsonl` and `~/.config/claude/projects/**/*.jsonl` (XDG dual-default), respecting `CLAUDE_CONFIG_DIR` env var. Filename = sessionId. (Verified via ccusage `data-loader.ts`.)

Token / cost / model: imported wholesale from `ccusage/data-loader`:
```ts
import { loadSessionData, loadSessionBlockData } from 'ccusage/data-loader';
```
This provides `inputTokens`, `outputTokens`, `cacheCreationTokens`, `cacheReadTokens`, `costUSD` per session, dedup'd by `message.id` + `requestId`, with LiteLLM-fetched pricing including 200k-tier and cache premiums. We do not re-implement any of that.

Personality extractor (custom — fields ccusage does not surface): a streaming JSONL pass over the same files extracting:

| Receipt field | JSON path / derivation |
|---|---|
| `time.activeMs` | sum of `system.subtype === "turn_duration".durationMs` |
| `time.afkMs` | `time.durationMs − time.activeMs` |
| `time.afkRecaps` | `system.subtype === "away_summary".content` (first 120 chars, redacted) |
| `work.filesTouched` | distinct `tool_use.input.file_path` where `name ∈ {Edit, Write, MultiEdit, NotebookEdit}` |
| `work.linesAdded/Removed` | sum of `+`/`−` lines in `toolUseResult.structuredPatch[]` for those tool uses |
| `work.bashCommands` | count of `tool_use.name === "Bash"` |
| `work.webFetches` | count of `tool_use.name === "WebFetch"` |
| `work.userModified` | count of `toolUseResult.userModified === true` |
| `tools.top` | group `tool_use.name`, drop dup blocks by `tool_use.id` |
| `subagents` | `tool_use.name === "Agent"` paired with `toolUseResult.{agentType,totalDurationMs,totalTokens,totalToolUseCount}` |
| `personality.escInterrupts` | count of `toolUseResult.interrupted === true` on Bash blocks |
| `personality.permissionFlips` | count of `permission-mode` events |
| `personality.yoloEvents` | count of permissionMode === "bypassPermissions" entries |
| `personality.thinkingMs` | **precise rule** — sum of `assistant.message.usage.cache_creation.ephemeral_*_input_tokens` mapped to elapsed wall time *only* for assistant turns whose `message.content[]` contains a `type === "thinking"` block. Concretely: walk events in order, when we see an assistant event with thinking content, take `nextEvent.timestamp − thisEvent.timestamp` (capped at 5 min to avoid AFK contamination) and sum. This stays correct even when one turn has both thinking and tool-use blocks. (Earlier draft used a coarser `turn_duration` heuristic; this tighter rule avoids double-counting against `time.activeMs`.) |
| `personality.skills` | `tool_use.name === "Skill"` → `input.skill`, distinct top 3 |
| `personality.slashCommands` | regex `<command-name>/(\w+)` over user-string contents, distinct top 3 |
| `personality.truncatedOutputs` | count of `attachment.async_hook_response.stdout` matching "Output truncated" |
| `personality.hookErrors` | count of `attachment.hook_success.exitCode != 0` plus `system.subtype === "stop_hook_summary".hookErrors` length |
| `personality.longestUserMsgChars` | max `user.message.content.length` (string content only) |
| `firstPrompt.wordCount/charCount` | first `user.message.content` string OR first `last-prompt.lastPrompt` |
| `firstPrompt.moodEmoji` | naive sentiment heuristic over first prompt (✨🔥🤖😴😤 — 1–2 chosen) |

Dedupe / robustness:
- Assistant rows are dedup'd by `message.id` (same id is replayed per content block).
- We tolerate missing `usage` blocks, missing `toolUseResult`, missing `permission-mode` — every field has a sensible zero.
- The extractor stamps `claudeCodeVersion` from any event's `version` field; if it differs from a tested version range, we log a warning to stderr but do not abort.

### 9.2 OpenAI Codex CLI

Path: `${CODEX_HOME:-~/.codex}/sessions/**/*.jsonl`. (Verified — `~/.codex/sessions/2026/04/30/rollout-…jsonl`.)

Tokens / cost / model: imported from `@ccusage/codex` (separate npm package). It provides `input_tokens`, `cached_input_tokens`, `output_tokens`, `reasoning_output_tokens` and computes USD against the same LiteLLM table. Cumulative-vs-delta token semantics handled in their loader.

Personality extractor (Codex has fewer extractable fields than Claude — Codex schema is still in flux per ccusage docs):

| Receipt field | Derivation |
|---|---|
| `time.activeMs` | last_event.timestamp − first_event.timestamp (no per-turn timing in Codex events) |
| `time.afkMs` | currently 0 (Codex does not log AFK) |
| `work.bashCommands` | count of `function_call.type === "shell"` |
| `work.filesTouched`, `linesAdded/Removed` | count of `function_call.type === "apply_patch"` and parse the patch payload |
| `tools.top` | group `function_call.name` |
| `firstPrompt.*` | first `user_message.text` |
| `personality.thinkingMs` | sum of `agent_reasoning.duration_ms` if present, else 0 |
| Others | left at default zero — we do not fake data we do not have |

Codex schema-drift mitigation: extractor reads `session_meta.cli_version` and skips fields known to be missing in pre-1.x builds (e.g., `turn_context`).

### 9.3 Source extension convention

Both extractors implement the same unexported convention (no formal plugin system per Q-architecture):

```ts
type SourceLoader = (opts: LoadOpts) => Promise<NormalizedSession[]>;
type LoadOpts = { sinceMs?: number; sessionId?: string; cwd?: string; branch?: string };
```

Adding Cursor in v2 = drop a third file `extract/cursor.ts` matching the signature, no architectural changes.

## 10. Aggregation engine

`single`: one `NormalizedSession` → `Receipt`.

`combine`: filter sessions by predicate, then merge:
- Sums for tokens, costs, lines, counts.
- `tools.top` re-aggregated across the union (sorted desc, top 5).
- `subagents` concatenated, sorted by durationMs desc, top 8.
- `personality.skills` / `slashCommands` re-deduped, top 3.
- `meta.sessionCount` = N; `meta.sources` = distinct.
- `time.startUtc` = min, `time.endUtc` = max, `time.durationMs` = endUtc − startUtc (wall-clock window, not sum of session durations — important: a 10-min and a 5-min session running in parallel = 10-min window, not 15).
- `time.activeMs` = sum (correct: parallel sessions actively used in the same wall-clock minute count twice — that's the user's real cognitive load).
- **Important semantic note**: in `combine` and `window` modes `activeMs` can legitimately exceed `durationMs` when sessions ran in parallel. The card footer in those modes prints a tiny legend `· active time across parallel sessions · ` so users do not read this as a bug. README also explains it.
- `firstPrompt` = the first prompt of the earliest session in the window.

Filters:
- `--since 1h`: parse via `ms` package; filter `endUtc >= now − duration`.
- `--branch <b>`: filter where `meta.branch === b` (resolved via the JSONL's per-event `gitBranch`; the most-frequent branch in the session wins ties).
- `--cwd <p>`: resolve to absolute path; filter where `meta.cwd === resolved`.
- `today` / `week` / `year`: `combine` with appropriate calendar-aware since-filter (TZ = user's local).

## 11. Redactor — Smart-Redact rules

Default = redact. `--reveal=<list>` opts in. (Q5)

| Field | Default behavior | `--reveal` keyword |
|---|---|---|
| `meta.project` | basename of cwd (e.g. `/Users/x/Desktop/clientwork/NDA` → `NDA`) | `paths` (full cwd) |
| `meta.branch` | first slash-segment + `…` (e.g. `feature/oss-saint-cards` → `feature/…`) | `paths` |
| `work.topFiles[].path` | filename only (e.g. `apps/x/page.tsx` → `page.tsx`) | `paths` (full path) |
| `time.afkRecaps` | replaced with `"<away for {n}m>"` | `prompt` |
| `firstPrompt.revealed` | `null`; show wordCount + moodEmoji + fingerprintSha instead | `prompt` (sets `revealed` to first 200 chars) |
| Bash command list | omitted entirely (never on the card) | `bash` (adds top 3 commands) |
| `personality.skills` / `slashCommands` | shown as-is (these are tool names, not user data) | n/a |

`--reveal all` is the same as `--reveal paths,prompt,bash`. `--review` always prints the redacted ANSI preview first and prompts y/N before writing the PNG, regardless of `--reveal` state.

`fingerprint.ts`: `sha256(normalizedPrompt).slice(0, 6)`; `moodEmoji` = lookup-table on a tiny keyword scoring (caps-lock, exclamation, "fix"/"bug"/"why" → 😤; "build"/"create"/"new" → ✨🤖; "explain"/"how" → 🤔; default → 🤖).

## 12. Hook integration

`vibe-receipt install-hook` modifies `~/.claude/settings.json` to add a `SessionEnd` hook entry. (We use Claude Code's documented hook mechanism — confirmed via the `update-config` skill scope.)

```jsonc
{
  "hooks": {
    "SessionEnd": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "vibe-receipt --hook-receive" }]
      }
    ]
  }
}
```

The hook handler (`hook/on-session-end.ts`) is intentionally **lazy** (Q2 — Hybrid Toast):

1. Reads the just-ended session's metadata from stdin (Claude Code passes session info as JSON).
2. Appends a one-line record to `~/.vibe-receipt/index.jsonl` (id, source, endTs, cwd, branch).
3. Prints a single line to stderr: `📸 Receipt ready · vibe-receipt show`
4. Exits 0 (never blocks session shutdown).

**No PNG is rendered at hook time.** Generation only happens when the user explicitly invokes `vibe-receipt show`. This avoids 50-PNG-per-day disk spam.

`install-hook` safety:
- Reads `~/.claude/settings.json`, writes a backup to `~/.claude/settings.json.vibe-receipt.bak` first.
- Refuses to install if a SessionEnd entry already references `vibe-receipt` (no duplicates).
- If the file does not exist, creates it with the minimal hooks structure.
- All JSON I/O via a parser that preserves comments (jsonc) — Claude Code allows JSONC.

`uninstall-hook` removes only the entry whose command starts with `vibe-receipt`; restores from .bak if surgical removal fails.

## 13. Card design — paper-receipt aesthetic

### 13.1 Visual language

- **Format**: portrait card, 1080×1350 default, hard background `#FAFAF7` (off-white paper), text near-black `#111111`, single accent gradient (magenta `#FF3D7F` → orange `#FFB74A`) used only for the title bar, the section dividers, and the tool-bar fill.
- **Type**: JetBrainsMono-Regular for body, JetBrainsMono-Bold for numbers and section headers, Inter-SemiBold for the masthead "VIBE RECEIPT" only. Both bundled as TTF in `assets/fonts/` (OFL license). No system-font fallbacks (Satori would error).
- **Texture**: a faint horizontal scanline overlay (1px dark line every 40px at 4% opacity) gives a printed-receipt feel without being kitschy.
- **Section dividers**: a row of 60 `·` chars in the accent gradient, centered.
- **Numbers**: right-aligned in their column; labels left-aligned. Receipt symmetry.

### 13.2 Layout (1080×1350 portrait — exact composition)

```
═══════════════════════════════════════
       VIBE RECEIPT  ◆  v1.0
       ─── monospace receipt ───
       2026-05-01
       23:14:00  →  23:39:24
       newProjekt  @  feature/…
 ·····················································
 SESSION
   duration               25m 24s
   model                  claude-opus-4.7
   tokens                 47.2k
   cost                   $0.84
   cache hit              71%
 ·····················································
 WORK
   files touched          12
   lines added            +287
   lines removed           −41
   bash commands          9
   web fetches            2
 ·····················································
 TOP TOOLS
   Edit   ████████████   18×
   Bash   ███████         9×
   Read   █████           7×
   Skill  ████            4×
   Agent  ███             3×
 ·····················································
 SUBAGENTS  (5)
   Explore             4m 12s · 12.1k tok
   general-purpose     2m 03s ·  8.4k tok
   code-reviewer       0m 47s ·  3.2k tok
   2 more
 ·····················································
 PERSONALITY
   afk                       6m 18s
   esc-rage                  2 hits
   permission-mode flips     3
   deep thought              1m 47s
   skills                    brainstorming, loop
   slash                     /loop, /clear
 ·····················································
 FIRST PROMPT
   47 words  ·  🔥🤖  ·  sha:9c3e
 ·····················································
                generated with vibe-receipt
                github.com/loris307/vibe-receipt
═══════════════════════════════════════
```

Vertical rhythm: every section header is bold caps, every section body is 6–10 lines, dividers separate. Vertical scroll-friendly: extra sections are appended (not crammed) for `combine` and `wrapped` modes.

### 13.3 Sections by mode

| Section | single | combine | today/week/year |
|---|---|---|---|
| Header | always | shows session count badge | shows "WEEK OF …" / "YEAR 2026" |
| Session block | always | replaces "duration" with "wall window" + "active time" | "active time" + "session count" |
| Work | always | always | always |
| Top Tools | if N≥3 | always | always |
| Subagents | if any | if any | if any |
| Personality | always | always | always |
| First Prompt | always | "first prompt of N" | "first prompt of the year" |
| Footer | always | always | always |

### 13.4 Sizes

| Preset | Pixel size | Layout adjustment |
|---|---|---|
| `portrait` (default) | 1080×1350 | full layout above |
| `story` | 1080×1920 | same layout, taller masthead, larger personality block |
| `og` | 1200×630 | landscape; collapses to 2-column: left = session+work+cost, right = personality+first prompt; drops scanline overlay |

`--size all` writes 3 PNGs.

### 13.5 Labels

All section labels are English. Strings live in `src/i18n/en.ts`. (Earlier versions supported a German variant; that was removed in 2026-05.)

## 14. Render pipeline

```
Receipt → React JSX (card.tsx) → satori(jsx, {width, height, fonts}) → SVG string
        → new Resvg(svg, {fitTo, font: {fontFiles}}).render().asPng() → Buffer → fs.writeFile
```

ANSI preview: same Receipt object → `render/ansi.ts` builds a string using `chalk` for the accent gradient (truecolor terminals only; 256-color fallback) and `cli-table3` / box-drawing chars for divider rows. Width = `process.stdout.columns` clamped to [60, 100].

Performance budget: render full PNG ≤ 200 ms on M-series. Cold-start npx (download + run) ≤ 4 s; warm `bunx`/cached ≤ 600 ms.

Font loading: TTFs are read once via `fs.readFileSync` from `assets/fonts/` (resolved relative to `__dirname`) into `ArrayBuffer`s, passed to both Satori `fonts: [...]` and `Resvg fontBuffers: [...]`. No system-font fallbacks.

## 15. File system layout (user side)

```
~/.vibe-receipt/
├── index.jsonl            # written by hook handler; one record per session-end
└── state.json             # last-shown ids, version, opt-in for update-checks (default false)

~/.claude/settings.json    # patched by `install-hook`
~/.claude/settings.json.vibe-receipt.bak   # backup written at install time

./vibe-receipts/           # cwd-relative; default --out parent
└── <sessionId-or-hash>.png
```

`index.jsonl` record shape:
```json
{"v":1,"ts":"2026-05-01T21:39:24.123Z","src":"claude","sessionId":"297c…","cwd":"/Users/x/Desktop/Videos/Youtube/newProjekt","branch":"feature/oss-saint","tokens":47287,"cost":0.84}
```

The bare `vibe-receipt` command consults `index.jsonl` first if it exists (faster than a full glob); falls back to globbing `~/.claude/projects/**/*.jsonl` and `~/.codex/sessions/**/*.jsonl` on freshly-installed systems.

## 16. Dependencies (locked)

| Dep | Version pin | Why |
|---|---|---|
| `ccusage` | `^18.0.x` | Claude data-loader + pricing engine. MIT. Library export. |
| `@ccusage/codex` | `^1.x` | Codex data-loader. MIT. |
| `satori` | `^0.10.x` | JSX → SVG card renderer. MIT. |
| `@resvg/resvg-js` | `^2.6.x` | SVG → PNG. Node binding for Rust resvg. MPL-2.0. Prebuilt binaries for macOS/Linux/Windows. |
| `react` | `^18.x` | JSX runtime for satori. (No DOM, no React-DOM.) |
| `gunshi` | `^x` | Same CLI framework ccusage uses. Consistency. |
| `valibot` | `^0.x` | Receipt schema validation. Tiny. |
| `chalk` | `^5.x` | ANSI colors for terminal preview. |
| `picocolors` | optional | already a transitive dep via ccusage. |
| `ms` | `^2.x` | parse `--since 1h` etc. |
| `jsonc-parser` | `^3.x` | Claude Code's settings.json may have comments. |
| `tsdown` | dev | bundler used by ccusage; same pattern. |
| `vitest` | dev | tests. |
| `@types/node`, `typescript`, `biome` | dev | self-explanatory. |

No native build steps required at user install (resvg-js ships prebuilt). Total `npm pack` size budget: ≤ 12 MB (fonts dominate).

## 17. Error handling — concrete edge cases

| Situation | Behavior |
|---|---|
| No JSONLs found at all | exit 1 with `"no sessions found · install-hook to start logging or run a Claude Code session first"` |
| Stale ccusage cache vs new model | proceed, log warning; `cost` may show `$≈0.00` rather than crash |
| JSONL line is malformed JSON | skip silently (matches ccusage behavior), increment `_skippedLines` counter; if > 5% of lines, print warning |
| Session JSONL still being written (open file handle, in-flight session) | parse what's there; mark `time.endUtc` as `now`; flag `meta.inFlight: true` (not on card, but in `--json` output) |
| `~/.claude/settings.json` is missing or empty on `install-hook` | create it with the minimal hooks structure, tell user |
| `~/.claude/settings.json` has a JSON parse error | abort install-hook, do not write, print parse error and the exact line |
| User passes `--session <uuid>` that does not exist | exit 1 with `"session uuid <uuid> not found in any source"` |
| `combine` filter matches zero sessions | exit 1 with `"no sessions match filter (since=<x>, branch=<y>); try `vibe-receipt sources` to inspect what's available"` |
| Font file missing from package | abort with clear `"package corrupted: missing assets/fonts/<file> — reinstall vibe-receipt"` |
| Terminal does not support truecolor | ANSI preview falls back to 256-color, then to plain text — never crashes |
| `--out` directory does not exist | create it (`mkdir -p`); fail clearly if cannot write |
| User invokes during an active Claude session (inFlight === true) | render anyway; tag the receipt header with `· in flight` (subtle, not alarming) |
| No fonts loadable in Satori | abort with "fonts could not be loaded — please file a bug with `vibe-receipt doctor` output" |

## 18. Testing strategy

- **Unit tests (vitest)** cover: `extract/personality/*` against checked-in fixture JSONLs; `aggregate/combine.ts` with synthetic NormalizedSessions; `redact/smart-redact.ts` with adversarial inputs; `render/ansi.ts` snapshot tests.
- **Render snapshot tests**: produce a PNG from a fixed Receipt fixture, hash the bytes, compare against committed hash. Regenerate manually with `pnpm test:update-snapshots` after intended visual changes.
- **CLI e2e**: spawn the bundled `dist/cli.js` against the fixture JSONLs in a tmp dir, assert exit code + stdout shape + that PNG was written.
- **Hook install/uninstall**: golden settings.json before/after.
- **Schema-drift canary**: a test that loads a JSONL fixture from `claude-code v2.0.x`, `v2.1.x`, and (when available) `v2.2.x` to detect upstream breaks. CI runs daily on cron via GitHub Actions to catch new Claude releases early.
- Coverage target: 80% lines on extract/aggregate/redact; render is snapshot-tested only.

## 19. Performance budgets

| Metric | Budget | Notes |
|---|---|---|
| `vibe-receipt` cold start (npx download + run) | ≤ 4 s | first invocation |
| `vibe-receipt` warm | ≤ 600 ms | subsequent |
| Single-session render (parse + Satori + resvg) | ≤ 200 ms | M-series |
| Combine `week` (≈ 50 sessions) | ≤ 1.2 s | streaming JSONL parse |
| Memory peak | ≤ 200 MB | hard cap; bail with `"too many sessions, narrow your filter"` |
| Package install size | ≤ 12 MB | fonts dominate |

## 20. Privacy & security

- No outbound network calls in render or extract paths. Pricing fetch is delegated to ccusage and runs only when its cache is stale; users can pin ccusage's `--offline` mode by setting `VIBE_RECEIPT_OFFLINE=1`.
- No telemetry, no analytics, no error reporting service. Crashes print to stderr.
- Hook writes only to user-owned dirs (`~/.vibe-receipt`, `~/.claude/settings.json`). Never world-writable.
- Settings.json modifications are guarded by checksum-and-backup: the install routine writes a backup, applies a JSONC-aware patch, validates the result reparses cleanly, and rolls back if not.
- Receipt filenames use only the session UUID (already opaque) or a content hash; never the cwd path.
- All redaction is applied **before** Receipt object construction — even `--json` output respects the smart-redact defaults unless `--reveal` is set.

## 21. Distribution & versioning

- Published to npm as `vibe-receipt`. `bin.vibe-receipt` → `dist/cli.js`. ESM. Node ≥ 20.19.4 (matches ccusage).
- SemVer. Breaking changes only on major. ccusage and @ccusage/codex pinned to compatible majors; minors auto-track via `^`.
- Public repo: `github.com/loris307/vibe-receipt`. MIT license.
- `npm publish` runs from a tag-triggered GitHub Actions workflow; release notes auto-generated from conventional commits.
- A `vibe-receipt --check-update` command exists for opt-in update checks; off by default. No background checks.

## 22. Build & release

- `tsdown` bundles `src/cli.ts` to `dist/cli.js` (ESM, target Node 20). Fonts emitted to `dist/fonts/`. Source maps included.
- Bun for dev (`bun run dev` runs the CLI from source); Node for distribution (`npx vibe-receipt`).
- `pnpm` workspace at top level (single package, but pnpm for dev consistency with ccusage).
- CI: lint (biome), typecheck (`tsc --noEmit`), test (vitest), and a render-smoke job that produces a PNG and uploads as artifact. All on Linux + macOS runners.
- `pnpm release` is the only path to publish; it runs full CI, bumps version, tags, pushes, and the workflow handles npm publish.

## 23. Roadmap

**v1.0 (this spec, ~1–2 weeks):**
- Single + combine + window modes
- Claude Code + Codex sources
- SessionEnd hook with toast
- Smart-redact + ANSI preview
- Portrait + story + og sizes
- DE + EN labels

**v1.1 (≤ 1 week after v1):**
- Schema-drift canary actions
- `vibe-receipt doctor` diagnostic improvements
- Mood-emoji heuristic upgrade (optional small LLM scoring via the `Anthropic` API). **Strictly opt-in**: only fires when the user has set `ANTHROPIC_API_KEY` *and* passed `--mood=ai`. Default behavior remains 100% offline; this preserves §3's "no outbound network calls" promise for the default install.
- Bug fixes from launch feedback

**v2.0 (Wrapped Engine — separate content drop):**
- Persistent local SQLite history at `~/.vibe-receipt/history.db`
- Streaks, badges, achievements
- Comparison against the user's own historical median
- New "wrapped" supersized layouts
- Cursor source via `saharmor/cursor-view` wrapper

**v3 (speculative):**
- Optional opt-in cloud-share to a community wall (only if v1/v2 land virally).
- VS Code extension surfacing the receipt in a sidebar.

## 24. Content arc (Loris)

Each milestone is a video.

1. *Launch:* "Ich habe ein Receipt für jede Coding-Session gebaut" — demo, install, first run.
2. *Combine:* "4 parallele Worktrees → ein Receipt — wie ich meine Multi-Agent-Sessions tracke."
3. *Personality drop:* "Mein YOLO-Score ist beunruhigend hoch — Claude Code Personality-Stats erklärt."
4. *Receipt-vs-Receipt:* "Ich teile mein Receipt — sendet eures via Reply" (community surface, hashtag #vibereceipt).
5. *Year-end-drop (Dec 2026):* `vibe-receipt year` reveals + Wrapped-Engine v2 launch.
6. *Codex-Mode short:* "Wie sieht Codex CLI im selben Receipt aus?"

## 25. Acceptance criteria for v1.0 ship

- [ ] `npx vibe-receipt` on a fresh machine renders a PNG of the most recent Claude session in ≤ 4 s including download.
- [ ] `vibe-receipt combine --since 2h` correctly merges multiple JSONLs (verified against fixture set).
- [ ] `vibe-receipt install-hook` patches `~/.claude/settings.json` losslessly (idempotent; backup verified).
- [ ] SessionEnd hook prints the toast within 50 ms of session end and never blocks shutdown.
- [ ] Smart-redact: by default, no full file path, no full first prompt, no Bash command appears in the rendered PNG.
- [ ] `--reveal=all` opts into all three.
- [ ] `--review` interactively gates PNG write on user y/N.
- [ ] ANSI preview renders on macOS Terminal.app, iTerm2, Warp, and Linux gnome-terminal without garbled characters.
- [ ] Fonts bundled (no system-font fallback in PNG).
- [ ] All three sizes (`portrait` / `story` / `og`) render correctly at the documented pixel dimensions.
- [ ] Render snapshot tests pass on macOS and Linux.
- [ ] `npm pack` ≤ 12 MB.
- [ ] README has the hero PNG, install line, top 5 use cases, and a privacy section.

## 26. Open questions / known unknowns

1. **Codex personality heuristics**: how rich can we make Codex receipts before v1.1 ships? The current spec says "leaner than Claude". Deferring richer heuristics to a v1.1 task once we have real Codex JSONLs from beta users.
2. **Hook payload format**: Claude Code's SessionEnd hook payload (stdin contract) is documented but evolving. Pin to current schema; add a version-detection canary.
3. **Mood-emoji quality**: rule-based first; consider opt-in `ANTHROPIC_API_KEY`-driven scoring in v1.1 if users complain it feels arbitrary.
4. **Gallery feature ever?** v3 maybe; the local-only stance is currently the privacy moat — do not break it without an explicit re-design pass.
5. **Distribution to non-npm crowds (Homebrew tap)?** Defer to post-launch demand; npm is enough for the target audience.
