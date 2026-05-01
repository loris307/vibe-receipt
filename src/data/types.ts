import type { Source, Subagent, ToolStat, TopFile } from "./receipt-schema.js";

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
  topFiles: TopFile[];
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

  firstPrompt: string | null;

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
