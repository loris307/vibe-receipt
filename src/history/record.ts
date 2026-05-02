import type { Receipt } from "../data/receipt-schema.js";
import {
  HISTORY_SCHEMA_VERSION,
  type SessionHistoryEntry,
} from "./types.js";
import { isHistoryDisabled, writeHistoryEntry } from "./store.js";

/**
 * Build a SessionHistoryEntry from a receipt. The receipt is already-redacted
 * for paths/branch (smart-redact runs before render); we mirror that here.
 *
 * Combine modes don't have a single sessionId — we synthesize one from the
 * scope and skip recording (combine receipts aren't comparable to single
 * sessions anyway).
 */
export function buildHistoryEntry(receipt: Receipt): SessionHistoryEntry | null {
  if (receipt.scope.kind !== "single") return null;

  const totalTokens =
    receipt.cost.inputTokens + receipt.cost.outputTokens + receipt.cost.cacheCreateTokens;

  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    recordedAt: new Date().toISOString(),
    sessionId: receipt.scope.sessionId,
    source: receipt.meta.sources[0] ?? "claude",
    project: receipt.meta.project,
    branch: receipt.meta.branch,
    startUtc: receipt.time.startUtc,
    endUtc: receipt.time.endUtc,
    durationMs: receipt.time.durationMs,
    activeMs: receipt.time.activeMs,
    totalUsd: receipt.cost.totalUsd,
    inputTokens: receipt.cost.inputTokens,
    outputTokens: receipt.cost.outputTokens,
    cacheCreateTokens: receipt.cost.cacheCreateTokens,
    cacheReadTokens: receipt.cost.cacheReadTokens,
    totalTokens,
    filesTouched: receipt.work.filesTouched,
    linesAdded: receipt.work.linesAdded,
    linesRemoved: receipt.work.linesRemoved,
    toolCount: receipt.tools.total,
    promptCount: receipt.personality.promptCount,
    archetype: receipt.archetype.key,
    models: receipt.cost.models,
  };
}

/**
 * Convenience: build + write. No-op when:
 *  - VIBE_RECEIPT_NO_HISTORY is set, OR
 *  - the scope is not a single session (combine modes etc.)
 */
export function recordSession(receipt: Receipt): void {
  if (isHistoryDisabled()) return;
  const entry = buildHistoryEntry(receipt);
  if (!entry) return;
  writeHistoryEntry(entry);
}
