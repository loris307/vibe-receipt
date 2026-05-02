/**
 * Count politeness tokens across a set of prompts. EN + DE + a couple of
 * adjacent languages so it generalises beyond Loris-only sessions.
 *
 * Word-boundary matched, case-insensitive. We deliberately do NOT match
 * substrings like "thanks-test.ts" — boundaries kill that.
 */

const PLEASE_RE = /\b(please|plz|pls|bitte|s'il\s+te\s+pla[iî]t|por\s+favor)\b/giu;
const THANKS_RE = /\b(thanks?|thank\s+you|thx|ty|cheers|danke|dank\s+dir|merci|gracias)\b/giu;
const SORRY_RE = /\b(sorry|sry|apologies|entschuldigung|verzeih(ung)?|pardon|perd[oó]n)\b/giu;

export interface PolitenessCounts {
  please: number;
  thanks: number;
  sorry: number;
}

export function scorePoliteness(prompts: string[]): PolitenessCounts {
  let please = 0;
  let thanks = 0;
  let sorry = 0;
  for (const text of prompts) {
    if (typeof text !== "string" || text.length === 0) continue;
    please += (text.match(PLEASE_RE) || []).length;
    thanks += (text.match(THANKS_RE) || []).length;
    sorry += (text.match(SORRY_RE) || []).length;
  }
  return { please, thanks, sorry };
}
