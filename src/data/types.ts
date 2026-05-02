import type {
  McpServerStat,
  Source,
  Subagent,
  ToolStat,
  TopFile,
} from "./receipt-schema.js";

export type { Source } from "./receipt-schema.js";

/**
 * Internal cross-source representation. One per JSONL session.
 * Adapters (extract/claude.ts, extract/codex.ts) emit this shape.
 */
export interface NormalizedSession {
  source: Source;
  sessionId: string;
  cwd: string;
  branch: string | null;
  models: string[];
  startUtc: string;
  endUtc: string;
  durationMs: number;

  // Token + cost (from ccusage where available)
  inputTokens: number;
  outputTokens: number;
  cacheCreateTokens: number;
  cacheReadTokens: number;
  totalCostUsd: number;

  // Personality + work
  activeMs: number;
  afkMs: number;
  afkRecaps: string[];

  filesTouched: string[];
  /** ALL files edited in this session, with per-file +/- counts. Aggregator slices to top N
   *  for the receipt; combiner unions across sessions. */
  fileEntries: TopFile[];
  linesAdded: number;
  linesRemoved: number;
  bashCommands: number;
  webFetches: number;
  userModified: number;

  toolCounts: Record<string, number>;
  subagents: Subagent[];

  escInterrupts: number;
  permissionFlips: number;
  yoloEvents: number;
  thinkingMs: number;
  skills: string[];
  slashCommands: string[];
  truncatedOutputs: number;
  hookErrors: number;
  longestUserMsgChars: number;

  /** All real user prompt lengths in chars, in chronological order. Empty for sources that
   *  cannot enumerate user inputs (e.g. minimal Codex extracts). */
  promptLengths: number[];

  /** Full text of every real user prompt in chronological order. Used for politeness scoring,
   *  fixer-keyword detection, etc. Empty for sources that cannot enumerate prompts. */
  promptTexts: string[];
  /** ISO8601 timestamp per real user prompt, same length as promptTexts. */
  promptTimestamps: string[];

  firstPrompt: string | null;
  /** Shortest real user prompt (full text). Null if no real prompts. */
  shortestPromptText: string | null;

  // v0.2 fields — defaulted by extractors that don't compute them
  longestSoloStretchMs: number;
  longestSoloStretchStartUtc: string | null;
  longestSoloStretchEndUtc: string | null;
  waitThenGoCount: number;
  politenessPlease: number;
  politenessThanks: number;
  politenessSorry: number;
  rateLimitHits: number;
  rateLimitWaitMs: number;
  /** Stream of (timestamp_ms, tokens) pairs for burn-rate peak computation.
   *  tokens = input + output + cacheCreate per assistant message. */
  tokenEvents: { ts: number; tokens: number }[];

  // v0.3 fields — defaulted by extractors that don't compute them
  /** Count of system.compact_boundary events (dedup by uuid when present). */
  compactionCount: number;
  /** preTokens of the chronologically-first compaction; null if no compaction. */
  firstCompactPreTokens: number | null;
  /** preTokens / contextWindow(model), clamped 0..1; null if no compaction or no model. */
  firstCompactContextPct: number | null;
  /** MCP servers used in this session, sorted desc by callCount, capped at 5. */
  mcpServers: McpServerStat[];
  /** Count of JSONL events with isSidechain:true (dedup by uuid when present). */
  sidechainEvents: number;
  /** Count of user prompts matching correction patterns ("nein/no/actually/i meant"). */
  correctionCount: number;

  inFlight?: boolean;
  warnings?: string[];
}

export interface LoadOpts {
  sinceMs?: number; // unix ms, lower bound
  sessionId?: string;
  cwd?: string;
  branch?: string;
  /** Limit results to the most recent N per source (perf escape valve). */
  limit?: number;
}

export type SourceLoader = (opts: LoadOpts) => Promise<NormalizedSession[]>;

export interface RevealOpts {
  paths: boolean;
  prompt: boolean;
  bash: boolean;
}
export const NO_REVEAL: RevealOpts = { paths: false, prompt: false, bash: false };

export function topToolStats(
  toolCounts: Record<string, number>,
  limit = 5,
): ToolStat[] {
  return Object.entries(toolCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
