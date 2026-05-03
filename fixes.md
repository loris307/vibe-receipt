# vibe-receipt fixes

Most recent audit pass: 2026-05-03. All audit findings have been resolved on `main`.

If you discover a new bug, add a new section below with: severity, repro, actual,
expected, and root cause. Once fixed, move it into the "Resolved" archive at the
bottom (one-line entry — keep this file usable as a working bug list, not a changelog).

## Open

_(none — audit clean)_

## Resolved

The 2026-05-03 ultrareview surfaced 12 issues; all are fixed in `main` and
verified by smoke tests against real Claude Code and Codex sessions:

- Codex extraction returning zero tokens/cost on current Codex JSONL shape
- `today / week / year` aggregating only one session per source
- `combine --branch` matching unrelated Codex sessions
- Default redaction leaking `firstPrompt.preview` and `personality.shortestPromptText`
- Subagent-token cost not added to parent-session ccusage cost
- `uninstall-hook` deleting sibling SessionEnd hooks alongside ours
- Short `--session` prefixes (e.g. `6e20cefd`) failing exact-match checks
- `VIBE_RECEIPT_NO_HISTORY=1` still reading history for comparisons
- `--reveal=paths` not surfacing full project path; `--reveal=bash` ignored entirely
- `--size all` ignoring `--out` (silently writing into `./vibe-receipts/`)
- `--lang` auto-detect / partial German strings (later resolved by removing German support entirely)
- `pnpm typecheck` and `pnpm lint` failing on `main`

Subsequent render polish (also fixed):

- Badge emoji glyphs rendered as tofu boxes in PNG (bundled mono font lacks emoji coverage) — replaced with ASCII glyphs
- Long tool names like `exec_command` painted over the bar chart — truncated to fit the name column

Second-pass audit (also fixed):

- Codex window mode dropped sessions whose `session_meta` predated the cutoff and over-counted tokens because `token_count` is cumulative — added a metadata pre-pass and a baseline subtraction
- `installHook`/`uninstallHook` cast `hooks.SessionEnd` without `Array.isArray` validation — would crash or silently overwrite on a malformed value; now refuses with a clear error
- `backupSettings` overwrote `.bak` on every run, destroying the user's original pre-vibe-receipt state after the first round-trip — now writes the backup once and never overwrites
- `combine` selected `firstPrompt` (and `firstCompactCarrier`) from sessions with non-finite `startUtc` because they were mapped to `ts=0` — those sessions are now skipped

Third-pass (live end-to-end smoke test against fresh `codex exec` + `claude -p` sessions):

- Codex `input_tokens` is GROSS (already includes `cached_input_tokens`), but the Codex loader stored both as separate fields — render formula `input + output + cacheCreate + cacheRead` then double-counted the cached portion. The 17.7k-token smoke session reported as 30k tokens with 40% cache hit when it's really 18k tokens with 66% cache hit. Loader now subtracts cached from input to align with Claude's net-input semantics; cost was already correct but is unchanged because the cost formula simplified accordingly.

Fourth-pass (live tool-using `codex exec` session that called `apply_patch`):

- Codex CLI now emits `apply_patch` as a `response_item/custom_tool_call` with the raw patch text in `payload.input`, not as a `function_call` with `payload.arguments` containing `{"patch": "..."}`. The extractor only handled `function_call`, so apply_patch was completely invisible — files touched, lines added, lines removed, and the apply_patch entry in TOP TOOLS were all silently zero for any session that edited files via the new shape. A fresh `codex exec` smoke that created hello.txt with two lines reported 0 files / 0 lines / no apply_patch tool. Extractor now handles both payload shapes uniformly via a `patchTextFromPayload` helper.

Fifth-pass (rendered the long-running ongoing session and noticed `corrections 6/6 = 100%`):

- `\bactually[\s,]` (English) and `\beigentlich[\s,]` (German) treated *every* in-sentence use of those words as a correction, but both double as intensifiers ("you actually have to test it", "ich war eigentlich zufrieden"). Real prompt repeated 5× in a /loop conversation reported 100% correction rate. Patterns now fire only on sentence-initial, post-comma, or pronoun-prefixed forms. The same session re-renders as 2/6 (33%).
