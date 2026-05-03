/**
 * Count user prompts that signal "I'm correcting myself / Claude / a prior turn".
 *
 * Calibrated against real user prompts found in observed JSONLs (mix of EN + DE).
 * Word-boundary anchored where appropriate to avoid identifier false positives.
 *
 * Counting model: ONE prompt = ONE count, even if it matches multiple patterns.
 *   ("Nein, ich meinte eigentlich..." hits 3 patterns but counts as 1 correction.)
 */

const CORRECTION_PATTERNS: ReadonlyArray<RegExp> = [
  // German — strongest signals (most observed in real data)
  /^\s*nein[\s,!.]/iu, // "Nein, ..." sentence-initial negation
  /^\s*doch[\s,!.]/iu, // "Doch, ..." sentence-initial contradiction
  /\bdoch\s+nur\b/iu, // "ich wollte doch nur"
  /\bich\s+meine\b/iu, // "Ich meine ..."
  /\beigentlich[\s,]/iu, // "eigentlich, ..."
  /^\s*aber\s/iu, // "Aber, ..." sentence-initial
  /\bsondern\b/iu, // "X, sondern Y"
  /\bnicht\s+so[\s,]/iu, // "nicht so, sondern..."
  /\bkorrigier/iu, // "korrigier(e/en/t/...)"

  // English — equivalent set
  /^\s*no[\s,!.]/iu, // "No, ..." sentence-initial
  /\bactually[\s,]/iu, // "Actually, ..."
  /^\s*sorry[\s,]/iu, // "Sorry, ..." sentence-initial (apology before re-spec)
  /\bi\s+meant\b/iu, // "I meant ..."
  /^\s*wait[\s,!.]/iu, // "Wait, ..." sentence-initial
  /\bnot\s+like\s+that\b/iu,
  /\binstead\s+of\b/iu, // "use X instead of Y"
  /\bnot\s+\w+,?\s+but\b/iu, // "not X, but Y"
];

/**
 * Returns the number of prompts that match any correction pattern.
 * Skips prompts shorter than 4 chars (defensive — single-token "no" is ambiguous).
 */
export function countCorrections(prompts: string[]): number {
  let count = 0;
  for (const text of prompts) {
    if (typeof text !== "string") continue;
    const trimmed = text.trim();
    if (trimmed.length < 4) continue;
    if (CORRECTION_PATTERNS.some((rx) => rx.test(trimmed))) count += 1;
  }
  return count;
}
