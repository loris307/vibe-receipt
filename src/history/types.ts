import type { Source } from "../data/types.js";

export const HISTORY_SCHEMA_VERSION = 1 as const;

/**
 * One row in ~/.vibe-receipt/history.jsonl. Compact session snapshot
 * suitable for downstream comparison stats. Always written in *redacted* form
 * (basenamed paths, first-segment branch) — comparison features must not be
 * a backdoor for path leaks.
 */
export interface SessionHistoryEntry {
  schemaVersion: typeof HISTORY_SCHEMA_VERSION;
  recordedAt: string; // ISO8601 — when this entry was written
  sessionId: string;
  source: Source;
  project: string;
  branch: string | null;
  startUtc: string;
  endUtc: string;
  durationMs: number;
  activeMs: number;
  totalUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreateTokens: number;
  cacheReadTokens: number;
  /** input + output + cacheCreate (matches burn-rate definition). */
  totalTokens: number;
  filesTouched: number;
  linesAdded: number;
  linesRemoved: number;
  toolCount: number;
  promptCount: number;
  /** Populated once Phase 6 archetype lands. Null until then. */
  archetype: string | null;
  models: string[];
}
