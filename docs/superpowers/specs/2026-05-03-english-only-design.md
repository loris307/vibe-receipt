# Spec: Remove German support — English-only

**Date:** 2026-05-03
**Author:** Loris Galler (driven via Claude)
**Status:** Approved (brainstorming gate)
**Approach:** Option A — surgical removal; preserve `Strings` type abstraction for minimal diff

## Why

The German translation is a maintenance overhead Loris no longer wants to carry. Receipts always render in English. The `--lang` flag, `VIBE BON` masthead, and `src/i18n/de.ts` go away. The README's Languages section disappears.

## What changes (behavioral)

- CLI: `--lang` flag removed entirely. Passing it is rejected as an unknown flag (existing flag-parsing behavior).
- Render: receipts always render English labels. `VIBE BON` is no longer reachable.
- Locale auto-detect (`pickLang` reading `LC_ALL` / `LC_MESSAGES` / `LANG`) is removed. Even on `LANG=de_DE.UTF-8`, output is English.

## What changes (code)

### Deletions
- **`src/i18n/de.ts`** — delete the file entirely.
- **`src/cli.ts:113`** — remove the `--lang en|de` line from the `--help` block.
- **`src/cli.ts:172-173`** — remove `pickLang(...)` call and its result; replace `strings(lang)` use with the single English module.
- **`src/cli.ts:38`** — drop `pickLang` from the import; keep `strings`.

### Simplifications
- **`src/i18n/index.ts`** — collapse to:
  ```ts
  export { en as strings } from "./en.js";
  export type { Strings } from "./en.js";
  ```
  Removes: `Lang` type, `pickLang()`, the `de` import, the conditional inside `strings()`. Call sites that previously did `strings(lang)` or `strings("en")` must change to bare `strings`.

### Call site updates
- **`src/cli.ts:173`** `const sStrings = strings(lang);` → `const sStrings = strings;`
- **`tests/render/render.test.ts`** — every `strings("en")` becomes `strings` (5 occurrences at lines 24, 34, 42, 61, 71).

### Test deletions
- **`tests/render/render.test.ts:47-53`** — delete the entire `it("renders DE labels", ...)` block.
- **`tests/render/render.test.ts:77-83`** — delete the entire `it("renders DE labels in ANSI", ...)` block.

### Files that don't change
- `src/i18n/en.ts` — untouched.
- `src/render/png.ts`, `src/render/ansi.ts`, `src/render/card.tsx` — they only import the `Strings` *type* from `i18n/index.js`. Type still exported, so no change.

## README changes

- **README.md:51** — delete "Renders as `VIBE BON` under `--lang de`." sentence inside the `VIBE RECEIPT` row.
- **README.md:312-314** — delete the entire `## Languages` section. The heading is at line 312 ("## Languages"), the body sentence is at line 314, and the surrounding `---` dividers (lines 310 and 316) are kept since they bracket adjacent sections.
- README.md:130 — the politeness row description currently says "(English + German patterns)". This is **kept as-is**: German politeness-word *detection* (`bitte`, `danke`, etc. in `src/extract/politeness.ts`) is independent of render language and stays. See "Out of scope" below.
- Sweep `src/`, `tests/`, `README.md`, **`docs/`** for any other `--lang` / `VIBE BON` / `i18n/de` / `pickLang` mention; rewrite or delete. (Confirmed in `docs/spec.md`: lines 80, 214, 590, 759 all reference `--lang de` or `i18n/de` and must be addressed — see next bullet.)
- **`docs/spec.md`** — this is a frozen design doc from before the German-removal decision. Update inline:
  - Line 80: rewrite the `--lang de|en` flag-table row to remove German (or delete the row).
  - Line 214: drop `de.ts` from the file-tree listing.
  - Line 590: rewrite the "Localization" paragraph as English-only, or delete it.
  - Line 759: delete the `--lang de produces an entirely German card` test-checklist item.

## Verification gate (must all pass)

1. `pnpm typecheck` — green.
2. `pnpm test` — green (DE-specific tests removed; remaining tests use bare `strings`).
3. `pnpm build` — green; `dist/cli.mjs` rebuilt.
4. `node dist/cli.mjs --help` — output does not contain `--lang` or `de`.
5. `grep -rn "VIBE BON\|--lang\|i18n/de\|pickLang\|de\.ts" src/ tests/ docs/ README.md` — returns zero matches. (Note: scope explicitly includes `docs/` per the docs/spec.md updates above.)
6. Smoke render: `node dist/cli.mjs --json` against any existing session — emits a valid Receipt JSON, no errors.

## Verification gate (must all pass)

1. `pnpm typecheck` — green.
2. `pnpm test` — green (DE-specific tests removed; remaining tests use bare `strings`).
3. `pnpm build` — green; `dist/cli.mjs` rebuilt.
4. `node dist/cli.mjs --help` — output does not contain `--lang` or `de`.
5. `grep -rn "VIBE BON\|--lang\|i18n/de\|pickLang\|de\.ts" src/ tests/ README.md` — returns zero matches.
6. Smoke render: `node dist/cli.mjs --json` against any existing session — emits a valid Receipt JSON, no errors.

## Out of scope

- The 7 audit issues from the previous task (Satori license, rate-limits format, `VIBE_RECEIPT_OFFLINE`, etc.) — separate task.
- Any refactor of the `Strings` type, the receipt schema, or the render pipeline.
- Removing `i18n/` directory (could rename `en.ts` → `strings.ts`, but that's churn for no win — kept).
- **`src/extract/politeness.ts`** — keeps its German + Spanish + French politeness-word regexes. These detect what the *user* typed in their prompts; they're not render-language settings. Removing them would change the `manners` stat's meaning. README.md:130's mention of "German patterns" stays accurate. (Note: the broader audit flagged that README.md:130 understates the actual coverage — that's a separate fix in the audit-issues task.)

## Rollback

`git revert <commit>` cleanly. No data migration. No persisted state references "de" — `~/.vibe-receipt/history.jsonl` schema does not include language.
