# English-only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all German support from `vibe-receipt`. Receipts always render in English. The `--lang` flag, `VIBE BON` masthead, locale auto-detect, and `src/i18n/de.ts` go away. README and `docs/spec.md` are updated. All tests still pass.

**Architecture:** Surgical deletion (Option A from spec). The `Strings` type and the `strings` import path stay so the render pipeline (`card.tsx`, `png.ts`, `ansi.ts`) does not change. `src/i18n/index.ts` collapses to a single re-export. Call sites that did `strings(lang)` or `strings("en")` switch to bare `strings`.

**Tech Stack:** TypeScript, Node 20.19+, pnpm, vitest, Satori, biome.

**Spec:** `docs/superpowers/specs/2026-05-03-english-only-design.md`

---

## File Map

**Delete:**
- `src/i18n/de.ts`

**Modify:**
- `src/i18n/index.ts` — collapse to single re-export of English strings
- `src/cli.ts` — remove `pickLang` import, remove `--lang` from help, remove `pickLang` call site
- `tests/render/render.test.ts` — delete two DE test blocks; change `strings("en")` calls to bare `strings`
- `README.md` — drop `VIBE BON` mention (line 51); delete Languages section (lines 312-314)
- `docs/spec.md` — drop `--lang` flag row (line 80); drop `de.ts` from file tree (line 214); rewrite section 13.5 i18n (line 590); delete DE checklist item (line 759)

**Don't touch:**
- `src/i18n/en.ts`
- `src/render/png.ts`, `src/render/ansi.ts`, `src/render/card.tsx` (type-only imports survive)
- `src/extract/politeness.ts` (multilingual prompt detection — out of scope per spec)
- `docs/masterplan-v0.2.md`, `docs/masterplan-v0.3.md` (frozen historical docs)

---

### Task 1: Update tests — drop German cases & switch to bare `strings`

**Files:**
- Modify: `tests/render/render.test.ts`

- [ ] **Step 1.1: Delete the DE PNG test block (lines 47-53)**

Open `tests/render/render.test.ts` and delete the entire `it("renders DE labels", ...)` block — these lines:

```ts
  it("renders DE labels", async () => {
    const ns = await loadClaudeFromFile(SHORT);
    const r = applyRedaction(buildSingleReceipt(ns));
    const png = await renderPng({ receipt: r, s: strings("de"), size: "portrait" });
    expect(png.length).toBeGreaterThan(5_000);
    writeFileSync(resolve(OUT_DIR, "snap-claude-portrait-de.png"), png);
  });
```

- [ ] **Step 1.2: Delete the DE ANSI test block (lines 77-83)**

Delete the entire `it("renders DE labels in ANSI", ...)` block:

```ts
  it("renders DE labels in ANSI", async () => {
    const ns = await loadClaudeFromFile(SHORT);
    const r = applyRedaction(buildSingleReceipt(ns));
    const ansi = renderAnsi(r, strings("de"));
    expect(ansi).toContain("VIBE BON");
    expect(ansi).toContain("ARBEIT");
  });
```

- [ ] **Step 1.3: Replace every `strings("en")` with bare `strings`**

There are 5 remaining occurrences after the deletes (lines that were 24, 34, 42, 61, 71 before deletions). Replace each:

- `s: strings("en")` → `s: strings`
- `renderAnsi(r, strings("en"))` → `renderAnsi(r, strings)`

Tip: a single `replace_all` on the literal `strings("en")` → `strings` is safe — there are no other occurrences in this file.

- [ ] **Step 1.4: Verify the test file**

Run:

```bash
grep -n 'strings(' tests/render/render.test.ts
```

Expected output: only the import line `import { strings } from "../../src/i18n/index.js";` (no calls). Specifically NO matches for `strings("en")` or `strings("de")`.

- [ ] **Step 1.5: Skip running tests yet**

Tests will fail right now because `strings` is still typed as a function in `src/i18n/index.ts`. We'll fix that in Task 2 and then run the suite. Do NOT commit yet.

---

### Task 2: Collapse `src/i18n/index.ts` to a single English re-export

**Files:**
- Modify: `src/i18n/index.ts`

- [ ] **Step 2.1: Replace the file contents**

Open `src/i18n/index.ts` and replace its entire contents with:

```ts
export { en as strings } from "./en.js";
export type { Strings } from "./en.js";
```

That is the whole file — 2 lines, no blank lines after.

- [ ] **Step 2.2: Verify the file**

Run:

```bash
cat src/i18n/index.ts
```

Expected: the two-line file above. No `pickLang`, no `Lang` type, no `de` import, no `strings()` function.

---

### Task 3: Delete `src/i18n/de.ts`

**Files:**
- Delete: `src/i18n/de.ts`

- [ ] **Step 3.1: Delete the file**

Run:

```bash
rm /Users/lorisgaller/Desktop/Projekte/vibe-receipt/src/i18n/de.ts
```

- [ ] **Step 3.2: Verify the deletion**

Run:

```bash
ls /Users/lorisgaller/Desktop/Projekte/vibe-receipt/src/i18n/
```

Expected: only `en.ts` and `index.ts` (and possibly a `personality/` dir or similar if it existed before — but currently `de.ts en.ts index.ts`).

---

### Task 4: Update `src/cli.ts` — drop `--lang` plumbing

**Files:**
- Modify: `src/cli.ts` (lines 38, 113, 172-173)

- [ ] **Step 4.1: Drop `pickLang` from the i18n import (line 38)**

Change:

```ts
import { pickLang, strings } from "./i18n/index.js";
```

to:

```ts
import { strings } from "./i18n/index.js";
```

- [ ] **Step 4.2: Remove the `--lang` row from the `--help` text (line 113)**

Find this line in the `help()` function:

```
  --lang en|de               label language (default: auto from $LANG)
```

Delete the entire line (and only that line — leave the surrounding `--reveal` and `--review` rows intact).

- [ ] **Step 4.3: Replace `pickLang` + `strings(lang)` (lines 172-173)**

Find:

```ts
  const lang = pickLang(typeof flags.lang === "string" ? flags.lang : null);
  const sStrings = strings(lang);
```

Replace both lines with one:

```ts
  const sStrings = strings;
```

- [ ] **Step 4.4: Verify cli.ts has no German plumbing**

Run:

```bash
grep -nE 'pickLang|--lang |flags\.lang' /Users/lorisgaller/Desktop/Projekte/vibe-receipt/src/cli.ts
```

Expected: zero matches. (Patterns are anchored: `pickLang` literal, `--lang` followed by a space (the flag in help text), and `flags.lang` (the runtime read). Bare-word `lang` is intentionally NOT matched to avoid false positives on `language`, `slang`, etc.)

---

### Task 5: Run typecheck + tests + fix any fallout

**Files:** none directly — verifies Tasks 1-4 above.

- [ ] **Step 5.1: Run typecheck**

Run from repo root:

```bash
cd /Users/lorisgaller/Desktop/Projekte/vibe-receipt && pnpm typecheck
```

Expected: zero errors.

If you see errors:
- "Cannot find module './i18n/index.js' or its corresponding type declarations" → spelling in import.
- "Module './i18n/index.js' has no exported member 'pickLang'" → you missed Task 4.1; remove `pickLang` from the import in `cli.ts`.
- "This expression is not callable. Type 'X' has no call signatures" → some test or call site still does `strings("en")` or `strings(lang)`. Find with `grep -rn 'strings(' src tests`.

Fix and re-run until green.

- [ ] **Step 5.2: Run tests**

Run:

```bash
pnpm test
```

Expected: all tests pass. The two deleted DE test blocks are gone; the remaining render tests use bare `strings`.

If tests fail:
- "VIBE BON" assertion still present → re-check Task 1 deletions.
- snapshot mismatch: snapshots may have been updated to a German variant in a previous run — not expected for this codebase, but if so, delete the offending snapshot file and re-run.

- [ ] **Step 5.3: Commit code changes**

```bash
git -C /Users/lorisgaller/Desktop/Projekte/vibe-receipt add \
  src/i18n/index.ts \
  src/cli.ts \
  tests/render/render.test.ts
git -C /Users/lorisgaller/Desktop/Projekte/vibe-receipt rm src/i18n/de.ts
git -C /Users/lorisgaller/Desktop/Projekte/vibe-receipt commit -m "$(cat <<'EOF'
refactor: drop German support — English-only renders

- Delete src/i18n/de.ts.
- Collapse src/i18n/index.ts to a single English re-export; drop pickLang
  and the Lang type.
- Remove --lang flag from cli.ts (import, --help row, pickLang call).
- Drop two DE-specific render tests; switch remaining strings("en") calls
  to bare strings.

The Strings type still flows through unchanged, so card.tsx / png.ts /
ansi.ts need no edits.
EOF
)"
```

---

### Task 6: Update README.md

**Files:**
- Modify: `README.md` (lines 51, 312-314)

- [ ] **Step 6.1: Strip the `VIBE BON` mention from line 51**

Find this row in the Header table:

```
| `VIBE RECEIPT` | Masthead at the top. Renders as `VIBE BON` under `--lang de`. |
```

Replace with:

```
| `VIBE RECEIPT` | Masthead at the top. |
```

- [ ] **Step 6.2: Delete the Languages section (lines 312-314)**

Find this block:

```
## Languages

English by default. German variant via `--lang de` (renames the masthead to **VIBE BON**, all section headers translated).
```

Delete those three lines (heading, blank line, body sentence).

The `---` divider on the line before and after the section bracket adjacent sections — leave them; the result will read `Where the data comes from … (divider) … Troubleshooting`. Verify by reading the surrounding 5 lines after the edit.

- [ ] **Step 6.3: Verify README has no stray German render references**

Run:

```bash
grep -nE 'VIBE BON|--lang|^## Languages' /Users/lorisgaller/Desktop/Projekte/vibe-receipt/README.md
```

Expected: zero matches.

> **Important:** README.md:130 contains the phrase "(English + German patterns)" describing the politeness-row stat. **This is intentionally kept** per the spec's "Out of scope" section — it documents `src/extract/politeness.ts`'s prompt-detection regexes, which are unchanged. The grep above is anchored so it does NOT match line 130; if the executor ever broadens the grep and sees that hit, leave it alone.

- [ ] **Step 6.4: Commit**

```bash
git -C /Users/lorisgaller/Desktop/Projekte/vibe-receipt add README.md
git -C /Users/lorisgaller/Desktop/Projekte/vibe-receipt commit -m "docs: drop German references from README"
```

---

### Task 7: Update `docs/spec.md`

**Files:**
- Modify: `docs/spec.md` (lines 80, 214, 590, 759)

- [ ] **Step 7.1: Drop the `--lang` row from the flag table (line 80)**

Find:

```
--lang de|en                                 # label language (default: en; auto-detect via $LANG)
```

Delete the entire line.

- [ ] **Step 7.2: Drop `de.ts` from the file tree (line 214)**

Find this region (lines ~212-214):

```
│   ├── i18n/
│   │   ├── en.ts
│   │   └── de.ts
```

Replace with:

```
│   ├── i18n/
│   │   └── en.ts
```

(Note: `└──` is the last-child glyph; `en.ts` is now the only entry.)

- [ ] **Step 7.3: Rewrite section 13.5 (line 588-590)**

Find:

```
### 13.5 i18n

`--lang de|en` swaps section labels via `i18n/{en,de}.ts`. Defaults to `en`; if `$LANG` starts with `de_` and no flag is given, defaults to `de`. German labels: `SESSION` / `ARBEIT` / `TOP TOOLS` / `SUB-AGENTS` / `CHARAKTER` / `ERSTER PROMPT` / „dauer" / „kosten" / „dateien" / „afk" / „esc-rage" / „yolo-modus" / „tiefer gedanke".
```

Replace the entire block (heading + body) with:

```
### 13.5 Labels

All section labels are English. Strings live in `src/i18n/en.ts`. (Earlier versions supported a German variant; that was removed in 2026-05.)
```

- [ ] **Step 7.4: Delete the DE checklist item (line 759)**

Find:

```
- [ ] `--lang de` produces an entirely German card.
```

Delete the entire line.

- [ ] **Step 7.5: Verify the gate grep is clean**

Run from repo root:

```bash
cd /Users/lorisgaller/Desktop/Projekte/vibe-receipt && grep -rn "VIBE BON\|--lang\|i18n/de\|pickLang" src/ tests/ docs/ README.md --exclude='masterplan-v*.md' --exclude-dir='superpowers'
```

Expected output: zero matches. If anything appears, fix it before committing.

- [ ] **Step 7.6: Commit**

```bash
git -C /Users/lorisgaller/Desktop/Projekte/vibe-receipt add docs/spec.md
git -C /Users/lorisgaller/Desktop/Projekte/vibe-receipt commit -m "docs(spec): rewrite i18n section as English-only"
```

---

### Task 8: Build + final verification

**Files:** none — verifies the cumulative change.

- [ ] **Step 8.1: Build**

```bash
cd /Users/lorisgaller/Desktop/Projekte/vibe-receipt && pnpm build
```

Expected: `dist/cli.mjs` regenerated, no errors.

- [ ] **Step 8.2: Confirm `--help` no longer mentions `--lang`**

```bash
node /Users/lorisgaller/Desktop/Projekte/vibe-receipt/dist/cli.mjs --help | grep -- '--lang'
```

Expected: zero matches (grep exits 1, prints nothing).

- [ ] **Step 8.3: Final gate grep (full)**

```bash
cd /Users/lorisgaller/Desktop/Projekte/vibe-receipt && grep -rn "VIBE BON\|--lang\|i18n/de\|pickLang" src/ tests/ docs/ README.md --exclude='masterplan-v*.md' --exclude-dir='superpowers'
```

Expected: zero matches.

- [ ] **Step 8.4: Smoke render (JSON path)**

Render the most recent session as JSON to confirm the pipeline still works end-to-end:

```bash
node /Users/lorisgaller/Desktop/Projekte/vibe-receipt/dist/cli.mjs --json | head -3
```

Expected: a JSON line starting with `{` (or three lines if pretty-printed). No errors. If the user has no Claude or Codex sessions yet, this will print an error like "no sessions found" — that's fine; it confirms the CLI runs without language-related crashes.

- [ ] **Step 8.5: Smoke render (PNG path)**

```bash
cd /Users/lorisgaller/Desktop/Projekte/vibe-receipt && node dist/cli.mjs
```

Expected: ANSI preview prints to terminal, then a PNG is written to `./vibe-receipts/<session-id>.png`. Inspect the preview — masthead should read `VIBE RECEIPT` (NOT `VIBE BON`), section headers should be in English (`SESSION`, `WORK`, `TOP TOOLS`, etc.).

If the user has no sessions, this step is a no-op — skip and report.

---

### Task 9: Final verification commit (if any) + summary

- [ ] **Step 9.1: Confirm working tree is clean**

```bash
git -C /Users/lorisgaller/Desktop/Projekte/vibe-receipt status --short
```

Expected: clean (no `??` untracked, no ` M` modified). If `dist/` shows changes, that is normal because `pnpm build` regenerated artifacts; check whether `dist/` is gitignored:

```bash
git -C /Users/lorisgaller/Desktop/Projekte/vibe-receipt check-ignore -v dist/cli.mjs
```

If the path matches a `.gitignore` rule, leave it. Otherwise, do not commit `dist/` unless that's the established convention (check `.gitignore` and prior commits).

- [ ] **Step 9.2: Show the final commit graph**

```bash
git -C /Users/lorisgaller/Desktop/Projekte/vibe-receipt log --oneline -10
```

You should see the five commits from this plan (spec, then code, README, spec doc, plus any spec-iteration commits already in place).

- [ ] **Step 9.3: Report done**

End with a one-line summary: "English-only refactor complete. <N> commits added. Build, typecheck, and tests all green. `--lang` flag removed; `VIBE BON` no longer reachable; gate grep returns 0 matches."

---

## Rollback

Any single task can be reverted with `git revert <commit-sha>`. The whole change reverts cleanly with `git revert <oldest-sha>..<newest-sha>`. No data migration; no persisted state references "de".
