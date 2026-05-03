# CLAUDE.md

## Project
CLI that reads Claude Code and Codex CLI session logs and renders Spotify-Wrapped-style receipt cards (PNG + ANSI preview + optional JSON).

## Stack
TypeScript 5.7 (ESM-only, `"type": "module"`), Node ≥ 20.19.4, pnpm. Bundled with tsdown to `dist/cli.mjs` (bin: `vibe-receipt`). React 18 + satori (JSX → SVG) + @resvg/resvg-js (SVG → PNG). ccusage / @ccusage/codex for cost. valibot for schemas. Tests: vitest. Lint/format: biome.

## Commands
- Dev: `pnpm dev` (runs `tsx src/cli.ts`)
- Build: `pnpm build` (tsdown bundle to `dist/`)
- Test all: `pnpm test`
- Test single file: `pnpm vitest run tests/path/to/file.test.ts`
- Test watch: `pnpm test:watch`
- Type check: `pnpm typecheck`
- Lint: `pnpm lint` (`biome check src tests`)
- Format: `pnpm format` (`biome format --write src tests`)

## Architecture
- `src/cli.ts` → command dispatcher (show, combine, today, week, year, history, install-hook, sources, doctor)
- `src/extract/` → JSONL parsers for Claude Code (`~/.claude/projects`) + Codex (`~/.codex/sessions`) → `NormalizedSession`
- `src/aggregate/` → builds `Receipt` (single, combine, window, achievements, archetype, comparisons)
- `src/redact/` → `smart-redact.ts` applies `--reveal` flags (paths, prompt, bash); runs BEFORE render and JSON emit
- `src/render/` → `card.tsx` (962-line Satori JSX) → `png.ts` / `ansi.ts`; size presets in `sizes.ts`
- `src/data/receipt-schema.ts` → single source of truth for the `Receipt` shape
- `src/history/` → `~/.vibe-receipt/history.jsonl` (one row per render, used for `vs last` / `week rank`)
- `src/hook/` → Claude Code SessionEnd hook installer + receiver
- `src/i18n/` → English only; structure ready but no other locales
- `assets/fonts/` → JetBrains Mono, required at render time (satori loads it)
- `tests/` mirrors `src/`; `tests/fixtures/**/*.jsonl` are frozen real-world captures
- `docs/spec.md`, `docs/masterplan-v*.md` → hand-written specs/plans; check before large changes
- `fixes.md` → live audit log of known bugs (dated, current); read before touching extract/aggregate/render

## Rules
- ESM only. Use `node:` import protocol (biome enforces `useNodejsImportProtocol`). No `require()`, no CommonJS output.
- Use pnpm. Never `npm install` / `yarn` — lockfile is `pnpm-lock.yaml`.
- Never hand-edit `tests/fixtures/**/*.jsonl` — they are frozen Claude Code / Codex captures and are biome-ignored on purpose.
- Redaction defaults must hide prompt text, file paths, AFK recaps, and bash commands. Apply `applyRedaction(receipt, reveal)` in `cli.ts` BEFORE rendering or `--json` emit. `--reveal=paths|prompt|bash` opts in.
- When changing the `Receipt` shape, update `src/data/receipt-schema.ts` first, then propagate through aggregate → render → ansi. Schema is the contract.
- Before claiming a fix or feature done, check `fixes.md` (dated audit log) — many bugs there are still open. Don't introduce regressions of issues already documented.
- IMPORTANT: run `pnpm typecheck` AND `pnpm lint` after every code change. Biome's `organizeImports` is canonical — never hand-sort imports; run `pnpm format`.

## Workflow
- Conventional commits with em-dashes for clauses, e.g. `refactor: drop German support — English-only renders`. Prefixes in use: `feat`, `fix`, `refactor`, `docs`, `chore`, `release`.
- Make minimal changes. Don't refactor unrelated code in the same commit.
- For multi-step features, write a plan in `docs/` first — this project plans before coding (see `docs/masterplan-v0.3.md`, `docs/spec.md`).
- Prefer separate commits per logical change over one monster commit.
- When two approaches are reasonable, explain both and let me choose — don't pick architecture silently.
- Verify CLI changes by actually running the built binary against real local logs (`VIBE_RECEIPT_NO_HISTORY=1 VIBE_RECEIPT_OFFLINE=1 node dist/cli.mjs ...`), not just unit tests.

## Out of scope
- `dist/` — build output, gitignored, never hand-edit.
- `vibe-receipts/` — generated PNG samples, gitignored, never commit.
- `pnpm-lock.yaml` — only via `pnpm install` / `pnpm update`.
- `tests/fixtures/**/*.jsonl` — frozen real-world JSONL, do not modify.
- `assets/fonts/` — bundled third-party fonts, do not regenerate.
- `node_modules/`, `.vitest-cache`, `.turbo`, `*.tsbuildinfo` — local caches.
