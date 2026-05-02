/**
 * Model → context-window-token-budget lookup for Claude Code v0.3 compaction stats.
 *
 * Source: Anthropic public docs on model capabilities. Hardcoded (offline-friendly);
 * update via release-PRs as new models ship. Conservative fallbacks when unrecognized.
 */

const CONTEXT_WINDOWS: Record<string, number> = {
  // Anthropic 4.x family
  "claude-opus-4-7": 200_000,
  "claude-opus-4-7[1m]": 1_000_000,
  "claude-sonnet-4-6": 200_000,
  "claude-sonnet-4-6[1m]": 1_000_000,
  "claude-haiku-4-5": 200_000,
  // legacy 3.x
  "claude-3-7-sonnet": 200_000,
  "claude-3-5-sonnet": 200_000,
  "claude-3-opus": 200_000,
  "claude-3-haiku": 200_000,
};

/**
 * Returns the context window in tokens for a given model id.
 * Tries exact match, then family-prefix match, then a conservative 200k default.
 */
export function getContextWindow(model: string): number {
  if (CONTEXT_WINDOWS[model]) return CONTEXT_WINDOWS[model]!;
  // 1M-context "[1m]" suffix is opt-in across families
  if (/\[1m\]/.test(model)) return 1_000_000;
  if (/^claude-opus/.test(model)) return 200_000;
  if (/^claude-sonnet/.test(model)) return 200_000;
  if (/^claude-haiku/.test(model)) return 200_000;
  // Conservative ultimate fallback — overestimating context window would
  // under-report the percentage; underestimating clamps to 100% which is
  // still correct directionally ("session was tight").
  return 200_000;
}
