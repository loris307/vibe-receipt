/**
 * Anthropic Claude pricing (per million tokens, USD).
 * Source: https://platform.claude.com/docs/en/about-claude/pricing  (verified 2026-05-02)
 *
 * Cache multiplier semantics (relative to base input rate):
 *   5-minute cache write = 1.25× base input
 *   1-hour cache write   = 2× base input
 *   Cache read (hit)     = 0.10× base input
 *
 * Used as a fallback when ccusage's LiteLLM-fetched table doesn't have the model
 * (e.g. claude-opus-4-7 — LiteLLM returns $0 for it as of early May 2026, so this
 * table is the source of truth for receipt costs).
 *
 * NOTE: Opus 4.5 / 4.6 / 4.7 are priced THREE TIMES CHEAPER than Opus 4 / 4.1.
 * Don't confuse them. The 4.5+ generation is on the $5/$25 tier.
 */

interface ClaudePrice {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

const PRICES: Record<string, ClaudePrice> = {
  // Opus 4.5+ — $5/$25 tier
  "claude-opus-4-7": {
    input: 5.0,
    output: 25.0,
    cacheWrite5m: 6.25,
    cacheWrite1h: 10.0,
    cacheRead: 0.5,
  },
  "claude-opus-4-6": {
    input: 5.0,
    output: 25.0,
    cacheWrite5m: 6.25,
    cacheWrite1h: 10.0,
    cacheRead: 0.5,
  },
  "claude-opus-4-5": {
    input: 5.0,
    output: 25.0,
    cacheWrite5m: 6.25,
    cacheWrite1h: 10.0,
    cacheRead: 0.5,
  },

  // Older Opus — $15/$75 tier
  "claude-opus-4-1": {
    input: 15.0,
    output: 75.0,
    cacheWrite5m: 18.75,
    cacheWrite1h: 30.0,
    cacheRead: 1.5,
  },
  "claude-opus-4": {
    input: 15.0,
    output: 75.0,
    cacheWrite5m: 18.75,
    cacheWrite1h: 30.0,
    cacheRead: 1.5,
  },
  "claude-3-opus": {
    input: 15.0,
    output: 75.0,
    cacheWrite5m: 18.75,
    cacheWrite1h: 30.0,
    cacheRead: 1.5,
  },

  // Sonnet 4 / 4.5 / 4.6 — $3/$15 tier
  "claude-sonnet-4-6": {
    input: 3.0,
    output: 15.0,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6.0,
    cacheRead: 0.3,
  },
  "claude-sonnet-4-5": {
    input: 3.0,
    output: 15.0,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6.0,
    cacheRead: 0.3,
  },
  "claude-sonnet-4": {
    input: 3.0,
    output: 15.0,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6.0,
    cacheRead: 0.3,
  },
  "claude-3-7-sonnet": {
    input: 3.0,
    output: 15.0,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6.0,
    cacheRead: 0.3,
  },
  "claude-3-5-sonnet": {
    input: 3.0,
    output: 15.0,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6.0,
    cacheRead: 0.3,
  },

  // Haiku 4.5
  "claude-haiku-4-5": {
    input: 1.0,
    output: 5.0,
    cacheWrite5m: 1.25,
    cacheWrite1h: 2.0,
    cacheRead: 0.1,
  },
  "claude-haiku-4-5-20251001": {
    input: 1.0,
    output: 5.0,
    cacheWrite5m: 1.25,
    cacheWrite1h: 2.0,
    cacheRead: 0.1,
  },

  // Haiku 3.5
  "claude-3-5-haiku": {
    input: 0.8,
    output: 4.0,
    cacheWrite5m: 1.0,
    cacheWrite1h: 1.6,
    cacheRead: 0.08,
  },
};

function priceFor(model: string): ClaudePrice {
  if (PRICES[model]) return PRICES[model];
  for (const [k, v] of Object.entries(PRICES)) {
    if (model.includes(k)) return v;
  }
  // Default: Sonnet 4 tier — middle of the road
  return PRICES["claude-sonnet-4-6"]!;
}

export interface CostInputs {
  models: string[];
  inputTokens: number;
  outputTokens: number;
  /** Total cache-creation tokens (5m + 1h). */
  cacheCreateTokens: number;
  /** OPTIONAL: split out 1h cache writes if known; else assume all are 5m (Claude Code default). */
  cacheCreate1hTokens?: number;
  cacheReadTokens: number;
}

export function computeClaudeCostUsd(opts: CostInputs): number {
  const model = opts.models[0] ?? "claude-sonnet-4-6";
  const p = priceFor(model);

  const cacheCreate1h = opts.cacheCreate1hTokens ?? 0;
  const cacheCreate5m = Math.max(0, opts.cacheCreateTokens - cacheCreate1h);

  const cost =
    opts.inputTokens * (p.input / 1_000_000) +
    opts.outputTokens * (p.output / 1_000_000) +
    cacheCreate5m * (p.cacheWrite5m / 1_000_000) +
    cacheCreate1h * (p.cacheWrite1h / 1_000_000) +
    opts.cacheReadTokens * (p.cacheRead / 1_000_000);

  return Math.max(0, cost);
}
