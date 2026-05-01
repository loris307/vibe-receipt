/**
 * Hardcoded Anthropic Claude prices per million tokens (USD), early 2026.
 * Used as a fallback when ccusage's LiteLLM-fetched table doesn't yet include the model
 * (e.g. claude-opus-4-7 may not be in LiteLLM until shortly after launch).
 *
 * Cache write ≈ 1.25× input · cache read ≈ 0.10× input · output ≈ 5× input.
 */

interface ClaudePrice {
  input: number; // per 1M
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

const PRICES: Record<string, ClaudePrice> = {
  // Opus family
  "claude-opus-4-7": { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.5 },
  "claude-opus-4-6": { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.5 },
  "claude-opus-4-5": { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.5 },
  "claude-opus-4": { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.5 },
  "claude-3-opus": { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.5 },

  // Sonnet
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-sonnet-4-5": { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-sonnet-4": { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-3-5-sonnet": { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-3-7-sonnet": { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },

  // Haiku
  "claude-haiku-4-5": { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 },
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 },
  "claude-3-5-haiku": { input: 0.8, output: 4.0, cacheWrite: 1.0, cacheRead: 0.08 },
};

function priceFor(model: string): ClaudePrice {
  if (PRICES[model]) return PRICES[model];
  // Substring fallback (e.g. "anthropic/claude-opus-4-7" → opus pricing)
  for (const [k, v] of Object.entries(PRICES)) {
    if (model.includes(k)) return v;
  }
  // Reasonable default = sonnet pricing
  return PRICES["claude-sonnet-4-6"]!;
}

export function computeClaudeCostUsd(opts: {
  models: string[];
  inputTokens: number;
  outputTokens: number;
  cacheCreateTokens: number;
  cacheReadTokens: number;
}): number {
  const model = opts.models[0] ?? "claude-sonnet-4-6";
  const p = priceFor(model);
  const cost =
    opts.inputTokens * (p.input / 1_000_000) +
    opts.outputTokens * (p.output / 1_000_000) +
    opts.cacheCreateTokens * (p.cacheWrite / 1_000_000) +
    opts.cacheReadTokens * (p.cacheRead / 1_000_000);
  return Math.max(0, cost);
}
