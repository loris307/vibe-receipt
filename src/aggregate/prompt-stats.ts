/**
 * Derive prompt statistics from a list of prompt lengths.
 * Single source of truth — used by both single.ts and combine.ts.
 */
export function promptStatsOf(lengths: number[]): {
  promptCount: number;
  longestPromptChars: number;
  shortestPromptChars: number;
  avgPromptChars: number;
} {
  if (lengths.length === 0) {
    return {
      promptCount: 0,
      longestPromptChars: 0,
      shortestPromptChars: 0,
      avgPromptChars: 0,
    };
  }
  let max = lengths[0]!;
  let min = lengths[0]!;
  let sum = 0;
  for (const n of lengths) {
    if (n > max) max = n;
    if (n < min) min = n;
    sum += n;
  }
  return {
    promptCount: lengths.length,
    longestPromptChars: max,
    shortestPromptChars: min,
    avgPromptChars: Math.round(sum / lengths.length),
  };
}
