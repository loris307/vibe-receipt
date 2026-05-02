import type { MostEditedFile, TopFile } from "../data/receipt-schema.js";

/**
 * Cost per net line of code shipped, USD.
 * Uses (added - removed); zero or negative net → 0 (display layer hides 0).
 */
export function computeCostPerLine(
  totalUsd: number,
  added: number,
  removed: number,
): number {
  const net = added - removed;
  if (net <= 0) return 0;
  return totalUsd / net;
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
  if (best === null || bestCount <= 1) return null;
  return {
    path: best.path,
    editCount: bestCount,
    added: best.added,
    removed: best.removed,
  };
}
