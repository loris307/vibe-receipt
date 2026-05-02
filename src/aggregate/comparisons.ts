import type { Comparison, Receipt } from "../data/receipt-schema.js";
import type { SessionHistoryEntry } from "../history/types.js";

const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

function pctDelta(current: number, prior: number): number {
  if (!Number.isFinite(prior) || prior === 0) return 0;
  return (current - prior) / prior;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1]! + sorted[mid]!) / 2;
  return sorted[mid]!;
}

/**
 * Compute comparisons for a single-session receipt against persistent history.
 *
 * Returns null when:
 *  - the receipt is not a single-session scope (combine modes etc.)
 *  - there is no relevant history at all
 *
 * Self-exclusion: if the current sessionId already appears in history (from a
 * prior render of the same session), it is excluded from "vs last session"
 * and from the 7-day window's tokensRank. It IS counted in the
 * sessionsInWindow total because the user did render it.
 */
export function deriveComparison(
  receipt: Receipt,
  history: SessionHistoryEntry[],
  now: number = Date.now(),
): Comparison | null {
  if (receipt.scope.kind !== "single") return null;
  const currentSessionId = receipt.scope.sessionId;
  const currentSource = receipt.meta.sources[0];
  if (!currentSource) return null;

  const sameSource = history.filter((h) => h.source === currentSource);
  if (sameSource.length === 0) return null;

  // vs last session: most-recent (by recordedAt) entry that isn't the current session
  const others = sameSource
    .filter((h) => h.sessionId !== currentSessionId)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const last = others[0];
  const currentTotalTokens =
    receipt.cost.inputTokens + receipt.cost.outputTokens + receipt.cost.cacheCreateTokens;

  const vsLastSession = last
    ? {
        deltaTokensPct: pctDelta(currentTotalTokens, last.totalTokens),
        deltaCostPct: pctDelta(receipt.cost.totalUsd, last.totalUsd),
        deltaDurationPct: pctDelta(receipt.time.durationMs, last.durationMs),
        sessionId: last.sessionId,
        recordedAt: last.recordedAt,
      }
    : null;

  // vs last 7 days: rolling window from `now`. Include current session for window
  // count but rank uses tokens (current is implicit at the top if any rendered).
  const sevenDaysAgo = now - SEVEN_DAYS_MS;
  const windowOthers = others.filter((h) => Date.parse(h.recordedAt) >= sevenDaysAgo);
  const sessionsInWindow = windowOthers.length + 1; // include current

  let vsLast7Days: Comparison["vsLast7Days"] = null;
  if (windowOthers.length > 0) {
    const windowTokens = windowOthers.map((h) => h.totalTokens);
    const allTokens = [...windowTokens, currentTotalTokens].sort((a, b) => b - a);
    const rank = allTokens.indexOf(currentTotalTokens) + 1;

    const allDurations = [...windowOthers.map((h) => h.durationMs), receipt.time.durationMs];
    const longestDur = Math.max(...allDurations);
    const longestSessionInWindow = receipt.time.durationMs >= longestDur;

    const allCosts = windowOthers.map((h) => h.totalUsd);
    vsLast7Days = {
      sessionsInWindow,
      tokensRankInWindow: rank,
      longestSessionInWindow,
      medianTokens: median([...windowTokens, currentTotalTokens]),
      medianCostUsd: median([...allCosts, receipt.cost.totalUsd]),
    };
  }

  if (!vsLastSession && !vsLast7Days) return null;
  return { vsLastSession, vsLast7Days };
}
