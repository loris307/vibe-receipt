# vibe-receipt fixes

Review date: 2026-05-03

Scope: read-only ultrareview of the current `main` checkout. I exercised the built CLI, the source CLI, real Claude Code logs, real Codex logs, temp isolated `HOME`/`CLAUDE_CONFIG_DIR`/`CODEX_HOME` fixtures, and the package scripts. No code was changed.

## 1. Real Codex sessions render with zero tokens, zero cost, and no prompt

Severity: High

Affected feature: Codex CLI extraction, default `vibe-receipt`, `--source codex`, Codex parts of `combine`, `today`, `week`, and `year`.

Repro:

```bash
VIBE_RECEIPT_NO_HISTORY=1 VIBE_RECEIPT_OFFLINE=1 node dist/cli.mjs --source codex --json
```

Actual on a real local Codex session:

```json
{
  "source": ["codex"],
  "cost": 0,
  "tokens": 0,
  "promptCount": 0
}
```

The same real Codex JSONL contains `event_msg` token-count records under `payload.info.total_token_usage` and user prompts as `response_item.payload.type === "message"` with `role: "user"`.

Expected: Codex receipts should show nonzero tokens/cost and prompt stats for real Codex logs.

Root cause:

- `src/extract/personality/codex-jsonl.ts` only recognizes the older fixture shape `response_item.payload.type === "user_message"`.
- It reads token counts from top-level `payload.input_tokens`, `payload.cached_input_tokens`, etc., but current logs put them under `payload.info.total_token_usage` / `payload.info.last_token_usage`.
- It counts Bash as tool name `shell`, while current Codex tool calls are names like `exec_command`.
- `src/extract/codex.ts` computes Codex cost from those zero parsed values instead of using `@ccusage/codex` as the README/spec claim.

## 2. `today`, `week`, and `year` only aggregate one session per source

Severity: High

Affected feature: window receipts.

Repro on this machine:

```bash
VIBE_RECEIPT_NO_HISTORY=1 VIBE_RECEIPT_OFFLINE=1 node dist/cli.mjs today --json
VIBE_RECEIPT_NO_HISTORY=1 VIBE_RECEIPT_OFFLINE=1 node dist/cli.mjs combine --since 1h --json
```

Actual:

- `today` returned `sessionCount: 2`.
- `combine --since 1h` returned `sessionCount: 8` over the same current local activity window.
- `week` and `year` also returned only `sessionCount: 2` despite many source files.

Expected: window commands should aggregate all sessions in the relevant window.

Root cause: `cmdWindow` in `src/cli.ts` calls `loadAllSources({})`. Both source loaders treat an unfiltered load as default picker mode and cap to one recent session per source.

Secondary issue: `week` returns `scope.kind: "combine-since"` instead of the schema-supported `window-week`, so it renders semantically as a combined receipt rather than a week receipt.

## 3. `combine --branch` includes unrelated Codex sessions

Severity: High

Affected feature: branch-filtered combine receipts.

Repro:

```bash
VIBE_RECEIPT_NO_HISTORY=1 VIBE_RECEIPT_OFFLINE=1 \
  node dist/cli.mjs combine --branch '__definitely_no_such_branch__' --json
```

Actual:

```json
{
  "scope": {
    "kind": "combine-branch",
    "branch": "__definitely_no_such_branch__"
  },
  "sessionCount": 1,
  "sources": ["codex"],
  "branch": null
}
```

Expected: exit 1 with no matching sessions.

Root cause: `src/extract/codex.ts` ignores `opts.branch` in `passesFilters`. Codex sessions have `branch: null`, but they still pass branch-filtered combines.

## 4. Default redaction leaks prompt text

Severity: High

Affected feature: privacy, smart-redact, ANSI preview, PNG rendering, JSON output.

Repro:

```bash
VIBE_RECEIPT_NO_HISTORY=1 VIBE_RECEIPT_OFFLINE=1 \
  node dist/cli.mjs --source claude \
  --session 6e20cefd-1021-4d70-8118-27631fd02a9a \
  --out /tmp/vibe-preview-check.png
```

Actual ANSI preview without `--reveal=prompt` contained:

```text
first      "Reply exactly: VIBE_RECEIPT_SMOKE_OK"
shortest   "Reply exactly: VIBE_RECEIPT_SMOKE_OK" (36 chars)
```

Expected: default redaction should show prompt metadata only, matching the README privacy table: word count, mood glyph, and SHA/fingerprint, with prompt text hidden unless `--reveal=prompt` is set.

Root cause:

- `src/redact/smart-redact.ts` only nulls `firstPrompt.revealed`.
- It leaves `firstPrompt.preview` and `personality.shortestPromptText` intact.
- `src/render/ansi.ts` and `src/render/card.tsx` render those fields unconditionally.

## 5. Claude subagent cost is undercounted

Severity: High

Affected feature: Claude subagent cost handling.

Repro with an isolated temp Claude config: parent session has 1,000,000 Sonnet input tokens and one subagent transcript has another 1,000,000 Sonnet input tokens.

```bash
CLAUDE_CONFIG_DIR=/tmp/vibe-claude-subagent-cost/claude \
CODEX_HOME=/tmp/vibe-claude-subagent-cost/codex \
HOME=/tmp/vibe-claude-subagent-cost/home \
VIBE_RECEIPT_NO_HISTORY=1 VIBE_RECEIPT_OFFLINE=1 \
node dist/cli.mjs show --source claude \
  --session 55555555-5555-4555-8555-555555555555 \
  --json
```

Actual:

```json
{
  "inputTokens": 2000000,
  "totalUsd": 3
}
```

Expected: `totalUsd` should be about `6` with the repo's Sonnet `$3/MTok` input pricing, because the receipt already includes both parent and subagent tokens.

Root cause: `fallbackTokenSum` in `src/extract/claude.ts` includes subagent transcript tokens, but `mergeTokensAndCost` later prefers `ccusage` cost when it is nonzero. `ccusage` returns the parent-session cost, so the final receipt combines parent+subagent tokens with parent-only cost.

## 6. `uninstall-hook` can delete unrelated SessionEnd hooks

Severity: High

Affected feature: hook uninstall safety.

Repro with an isolated temp home:

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "vibe-receipt --hook-receive" },
          { "type": "command", "command": "echo keep-me" }
        ]
      }
    ]
  }
}
```

Then:

```bash
HOME=/tmp/vibe-hook-sibling/home node dist/cli.mjs uninstall-hook
```

Actual:

```json
{
  "hooks": {
    "SessionEnd": []
  }
}
```

Expected: only the `vibe-receipt --hook-receive` hook should be removed. The sibling `echo keep-me` hook should remain.

Root cause: `entryReferencesUs` in `src/hook/install.ts` marks the entire `SessionEnd` entry as ours if any child hook command contains `vibe-receipt`, and `uninstallHook` filters out the whole entry.

## 7. Documented short `--session` IDs do not work

Severity: Medium

Affected feature: specific session selection.

Repro:

```bash
VIBE_RECEIPT_NO_HISTORY=1 VIBE_RECEIPT_OFFLINE=1 \
  node dist/cli.mjs --source claude --session 6e20cefd --json
```

Actual:

```text
no sessions found · install-hook to start logging or run a Claude Code session first
```

The full UUID works:

```bash
node dist/cli.mjs --source claude \
  --session 6e20cefd-1021-4d70-8118-27631fd02a9a \
  --json
```

Expected: short IDs should work because the README documents `vibe-receipt --session 297c7fe2`, and `history list` displays only the first 8 characters.

Root cause: exact equality checks are used in `cmdShow`, `loadClaudeSessions`, and `loadCodexSessions`.

## 8. `VIBE_RECEIPT_NO_HISTORY=1` still reads history and shows comparisons

Severity: Medium

Affected feature: history opt-out and privacy expectations.

Repro:

```bash
VIBE_RECEIPT_NO_HISTORY=1 VIBE_RECEIPT_OFFLINE=1 \
  node dist/cli.mjs --source claude \
  --session 6e20cefd-1021-4d70-8118-27631fd02a9a \
  --json
```

Actual: the JSON still included a populated `comparison` object from `~/.vibe-receipt/history.jsonl`.

Expected: the environment variable documented as the history opt-out should prevent both writing and reading history-derived comparison data.

Root cause: `recordSession` respects `isHistoryDisabled()`, but `emit` still calls `readHistory()` and `deriveComparison()` before that.

## 9. `--reveal` flags are incomplete

Severity: Medium

Affected feature: privacy opt-in controls.

Broken behavior:

- `--reveal=paths` cannot reveal the full project path because `buildSingleReceipt` and `buildCombinedReceipt` store `meta.project` as `basename(cwd)` before redaction. Repro on the real Claude smoke session with `--reveal=paths` still returned `"project": "vibe-receipt"`, not `/Users/lorisgaller/Desktop/Projekte/vibe-receipt`.
- `--reveal=bash` is parsed into `RevealOpts.bash`, but no extractor stores a Bash command list and `applyRedaction` never consumes `reveal.bash`. The flag has no visible effect.

Expected: the README privacy table says project paths and Bash commands can be revealed explicitly.

Root cause: the receipt schema does not retain full project path or Bash command text, and the redaction layer has no Bash-command branch.

## 10. `--size all` ignores explicit `--out`

Severity: Low

Affected feature: output path handling.

Repro:

```bash
mkdir -p /tmp/vibe-receipt-smoke-out
VIBE_RECEIPT_NO_HISTORY=1 VIBE_RECEIPT_OFFLINE=1 \
  node dist/cli.mjs --source claude \
  --session 6e20cefd-1021-4d70-8118-27631fd02a9a \
  --no-preview --size all \
  --out /tmp/vibe-receipt-smoke-out/receipt.png
```

Actual: no files were written under `/tmp/vibe-receipt-smoke-out`. The CLI wrote:

```text
./vibe-receipts/6e20cefd-portrait.png
./vibe-receipts/6e20cefd-story.png
./vibe-receipts/6e20cefd-og.png
```

Expected: either derive all three output files from the requested path, or reject `--out` with `--size all` with a clear error.

Root cause: `emit` in `src/cli.ts` only honors `outFlag` when `sizes.length === 1`.

## 11. Language auto-detection does not read `$LANG`, and German output is partial

Severity: Low

Affected feature: i18n.

Repro:

```bash
LANG=de_DE.UTF-8 VIBE_RECEIPT_NO_HISTORY=1 VIBE_RECEIPT_OFFLINE=1 \
  node dist/cli.mjs --source claude \
  --session 6e20cefd-1021-4d70-8118-27631fd02a9a \
  --out /tmp/vibe-lang-auto.png
```

Actual: output started with `VIBE RECEIPT` and `monospace receipt`.

Expected: README/help say `--lang en|de` defaults to auto from `$LANG`, so this should default to German.

Root cause: `pickLang` in `src/i18n/index.ts` returns `"en"` unless an explicit flag is passed.

Additional partial German issue: explicit `--lang de` still renders English units/labels such as `36 chars` and `tool calls`.

## 12. Developer verification scripts are currently failing

Severity: Medium

Affected feature: package maintenance workflow.

Commands:

```bash
pnpm typecheck
pnpm lint
```

Actual:

- `pnpm typecheck` exits 2 because test builders/fixtures are missing newer v0.3 fields such as `compactionCount`, `mcpServers`, `sidechainEvents`, `correctionCount`, and `correctionRate`.
- `pnpm lint` exits 1 with Biome errors. The run reported 177 errors and 5 warnings, including import sorting, formatting, non-null assertions, and style rules.

Expected: package scripts in `package.json` should pass on `main`, especially before publish/release work.

Note: `pnpm test` passed 13 files / 161 tests, and `pnpm build` passed.

## Verification run summary

Commands that passed:

```bash
pnpm test
pnpm build
node dist/cli.mjs doctor
node dist/cli.mjs sources
```

Real Claude Code smoke session:

```bash
claude -p --output-format json --model sonnet \
  --system-prompt "You are a terse echo bot. Do not use tools." \
  --tools "" --disable-slash-commands --max-budget-usd 0.30 \
  "Reply exactly: VIBE_RECEIPT_SMOKE_OK"
```

That produced session `6e20cefd-1021-4d70-8118-27631fd02a9a`, which `vibe-receipt` could render by full UUID.

