import type { MostEditedFile, TopFile } from "../data/receipt-schema.js";

export interface TokenEvent {
  ts: number;
  tokens: number;
}

/**
 * Cost per net line of code shipped, USD.
 * Uses (added - removed); zero or negative net → 0 (display layer hides 0).
 */
export function computeCostPerLine(totalUsd: number, added: number, removed: number): number {
  const net = added - removed;
  if (net <= 0) return 0;
  return totalUsd / net;
}

/**
 * Peak burn rate: max sum of tokens in any 60-second sliding window across all
 * assistant-message events. Returns the peak count and the start-of-window UTC.
 *
 * Empty input → { tpm: 0, windowStartUtc: null }.
 */
export function computeBurnRatePeak(events: TokenEvent[]): {
  tpm: number;
  windowStartUtc: string | null;
} {
  if (events.length === 0) return { tpm: 0, windowStartUtc: null };
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const windowMs = 60_000;
  let peak = 0;
  let peakStart = sorted[0]!.ts;
  let left = 0;
  let sum = 0;
  for (let r = 0; r < sorted.length; r++) {
    sum += sorted[r]!.tokens;
    while (left < r && sorted[r]!.ts - sorted[left]!.ts > windowMs) {
      sum -= sorted[left]!.tokens;
      left += 1;
    }
    if (sum > peak) {
      peak = sum;
      peakStart = sorted[left]!.ts;
    }
  }
  return { tpm: peak, windowStartUtc: new Date(peakStart).toISOString() };
}

/**
 * Pick the file that received the most Edit/Write tool calls in the session.
 * Returns null if every file was touched only once (uninteresting), or
 * if there are no files at all.
 *
 * `editCount` is optional on TopFile (legacy fixtures may not have it). When
 * absent, we treat the entry as 1 edit (matching the historical convention).
 */
export function computeMostEditedFile(entries: TopFile[]): MostEditedFile | null {
  if (entries.length === 0) return null;
  let best: TopFile | null = null;
  let bestCount = 0;
  for (const f of entries) {
    const count = f.editCount ?? 1;
    if (count > bestCount) {
      best = f;
      bestCount = count;
    }
  }
  // Threshold: at least 3 edits to be a meaningful "most edited". A file
  // edited 2× when everyone else was edited 1× is technically max but not
  // a story worth telling.
  if (best === null || bestCount < 3) return null;
  return {
    path: best.path,
    editCount: bestCount,
    added: best.added,
    removed: best.removed,
  };
}
