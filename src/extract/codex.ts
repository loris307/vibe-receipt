import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { LoadOpts, NormalizedSession, SourceLoader } from "../data/types.js";
import { extractCodexPersonality } from "./personality/codex-jsonl.js";

/**
 * Hardcoded fallback prices per million tokens (USD). Targets common Codex / GPT-5 models.
 * Refreshed as needed. (TODO v1.1: share LiteLLM pricing fetch with ccusage.)
 */
const CODEX_PRICES_PER_MTOK: Record<string, { input: number; cached: number; output: number }> = {
  "gpt-5.5": { input: 1.25, cached: 0.125, output: 10.0 },
  "gpt-5.5-codex": { input: 1.25, cached: 0.125, output: 10.0 },
  "gpt-5.3-codex": { input: 1.25, cached: 0.125, output: 10.0 },
  "gpt-5.2-codex": { input: 1.0, cached: 0.1, output: 8.0 },
  "gpt-5.1-codex": { input: 1.0, cached: 0.1, output: 8.0 },
  "gpt-5-codex": { input: 1.0, cached: 0.1, output: 8.0 },
  "gpt-5": { input: 1.25, cached: 0.125, output: 10.0 },
  "o4-mini": { input: 1.1, cached: 0.275, output: 4.4 },
  o4: { input: 5.0, cached: 1.25, output: 20.0 },
  "o3-mini": { input: 1.1, cached: 0.55, output: 4.4 },
  default: { input: 1.0, cached: 0.1, output: 8.0 },
};

function priceFor(model: string) {
  if (CODEX_PRICES_PER_MTOK[model]) return CODEX_PRICES_PER_MTOK[model]!;
  // Prefix fallback for gpt-5.X minor revisions LiteLLM hasn't picked up yet.
  if (/^gpt-5(\.\d+)?(-codex)?$/.test(model)) {
    return CODEX_PRICES_PER_MTOK["gpt-5"]!;
  }
  return CODEX_PRICES_PER_MTOK.default!;
}

/**
 * `input` here is the NET (non-cached) new-input tokens — i.e. already aligned
 * with Claude semantics. `cached` is the separately-billed cache-read tokens.
 * Codex JSONL emits gross input_tokens (which includes cached_input_tokens);
 * the loader subtracts cached before calling this so display totals don't
 * double-count and so the cost arithmetic is straightforward.
 */
function computeCostUsd(opts: {
  model: string;
  input: number;
  cached: number;
  output: number;
}): number {
  const p = priceFor(opts.model);
  const cost =
    opts.input * (p.input / 1_000_000) +
    opts.cached * (p.cached / 1_000_000) +
    opts.output * (p.output / 1_000_000);
  return Math.max(0, cost);
}

export function getCodexJsonlRoot(): string {
  return process.env.CODEX_HOME
    ? resolve(process.env.CODEX_HOME, "sessions")
    : resolve(homedir(), ".codex", "sessions");
}

async function listJsonlFilesWithMtime(): Promise<{ path: string; mtimeMs: number }[]> {
  const root = getCodexJsonlRoot();
  const out: { path: string; mtimeMs: number }[] = [];
  try {
    const entries = await readdir(root, { recursive: true });
    for (const file of entries) {
      if (!file.endsWith(".jsonl")) continue;
      const abs = resolve(root, file);
      try {
        const s = await stat(abs);
        out.push({ path: abs, mtimeMs: s.mtimeMs });
      } catch {
        // skip
      }
    }
  } catch {
    // root missing
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

function passesFilters(ns: NormalizedSession, opts: LoadOpts): boolean {
  // Allow short --session prefixes (see Claude loader for rationale).
  if (opts.sessionId && !ns.sessionId.startsWith(opts.sessionId)) return false;
  if (opts.cwd && ns.cwd !== opts.cwd) return false;
  // Codex sessions don't carry a git branch (ns.branch is always null), so any
  // explicit --branch filter must reject them rather than silently passing.
  if (opts.branch && ns.branch !== opts.branch) return false;
  if (typeof opts.sinceMs === "number") {
    const end = new Date(ns.endUtc).getTime();
    if (!Number.isFinite(end) || end < opts.sinceMs) return false;
  }
  return true;
}

export const loadCodexSessions: SourceLoader = async (opts) => {
  const files = await listJsonlFilesWithMtime();
  const out: NormalizedSession[] = [];
  const sinceMs = typeof opts.sinceMs === "number" ? opts.sinceMs : null;
  const wantSession = opts.sessionId;
  const wantCwd = opts.cwd;
  const limit =
    typeof opts.limit === "number"
      ? opts.limit
      : wantSession
        ? 50
        : sinceMs === null && !wantCwd
          ? 1
          : Number.POSITIVE_INFINITY;

  for (const { path: file, mtimeMs } of files) {
    if (sinceMs !== null && mtimeMs < sinceMs) break;
    const p =
      sinceMs !== null
        ? await extractCodexPersonality(file, { sinceMs })
        : await extractCodexPersonality(file);
    if (!p.sessionId) continue;
    if (sinceMs !== null && p.durationMs === 0) continue;
    const model = p.models[0] ?? "default";
    // Codex JSONL emits input_tokens GROSS (already includes cached_input_tokens).
    // Convert to Claude-style net semantics so renderers and aggregators that
    // sum input + cacheRead don't double-count the cached portion.
    const netInput = Math.max(0, p.inputTokens - p.cachedInputTokens);
    const totalCostUsd = computeCostUsd({
      model,
      input: netInput,
      cached: p.cachedInputTokens,
      output: p.outputTokens + p.reasoningOutputTokens,
    });
    const ns: NormalizedSession = {
      source: "codex",
      sessionId: p.sessionId,
      cwd: p.cwd ?? "unknown",
      branch: null,
      models: p.models,
      startUtc: p.startUtc ?? new Date(0).toISOString(),
      endUtc: p.endUtc ?? new Date().toISOString(),
      durationMs: p.durationMs,

      inputTokens: netInput,
      outputTokens: p.outputTokens + p.reasoningOutputTokens,
      cacheCreateTokens: 0,
      cacheReadTokens: p.cachedInputTokens,
      totalCostUsd,

      activeMs: p.durationMs,
      afkMs: 0,
      afkRecaps: [],

      filesTouched: p.filesTouched,
      fileEntries: p.fileEntries,
      linesAdded: p.linesAdded,
      linesRemoved: p.linesRemoved,
      bashCommands: p.bashCommands,
      bashCommandsList: p.bashCommandsList,
      webFetches: 0,
      userModified: 0,

      toolCounts: p.toolCounts,
      subagents: p.subagents,

      escInterrupts: 0,
      permissionFlips: 0,
      yoloEvents: 0,
      thinkingMs: p.thinkingMs,
      skills: [],
      slashCommands: [],
      truncatedOutputs: 0,
      hookErrors: 0,
      longestUserMsgChars: p.longestUserMsgChars,
      promptLengths: p.promptLengths,
      promptTexts: p.promptTexts,
      promptTimestamps: p.promptTimestamps,

      firstPrompt: p.firstPrompt,
      shortestPromptText: p.shortestPromptText,

      longestSoloStretchMs: p.longestSoloStretchMs,
      longestSoloStretchStartUtc: p.longestSoloStretchStartUtc,
      longestSoloStretchEndUtc: p.longestSoloStretchEndUtc,
      waitThenGoCount: p.waitThenGoCount,
      politenessPlease: p.politenessPlease,
      politenessThanks: p.politenessThanks,
      politenessSorry: p.politenessSorry,
      rateLimitHits: p.rateLimitHits,
      rateLimitWaitMs: p.rateLimitWaitMs,
      tokenEvents: p.tokenEvents,

      compactionCount: p.compactionCount,
      firstCompactPreTokens: p.firstCompactPreTokens,
      firstCompactContextPct: p.firstCompactContextPct,
      mcpServers: p.mcpServers,
      sidechainEvents: p.sidechainEvents,
      correctionCount: p.correctionCount,
    };
    if (!passesFilters(ns, opts)) continue;
    out.push(ns);
    if (out.length >= limit) break;
  }
  out.sort((a, b) => new Date(b.endUtc).getTime() - new Date(a.endUtc).getTime());
  return out;
};

export async function loadCodexFromFile(filePath: string): Promise<NormalizedSession> {
  const p = await extractCodexPersonality(filePath);
  const model = p.models[0] ?? "default";
  // See loadCodexSessions for why we subtract: Codex emits gross input_tokens.
  const netInput = Math.max(0, p.inputTokens - p.cachedInputTokens);
  const totalCostUsd = computeCostUsd({
    model,
    input: netInput,
    cached: p.cachedInputTokens,
    output: p.outputTokens + p.reasoningOutputTokens,
  });
  return {
    source: "codex",
    sessionId: p.sessionId ?? "unknown",
    cwd: p.cwd ?? "unknown",
    branch: null,
    models: p.models,
    startUtc: p.startUtc ?? new Date(0).toISOString(),
    endUtc: p.endUtc ?? new Date().toISOString(),
    durationMs: p.durationMs,

    inputTokens: netInput,
    outputTokens: p.outputTokens + p.reasoningOutputTokens,
    cacheCreateTokens: 0,
    cacheReadTokens: p.cachedInputTokens,
    totalCostUsd,

    activeMs: p.durationMs,
    afkMs: 0,
    afkRecaps: [],

    filesTouched: p.filesTouched,
    fileEntries: p.fileEntries,
    linesAdded: p.linesAdded,
    linesRemoved: p.linesRemoved,
    bashCommands: p.bashCommands,
    bashCommandsList: p.bashCommandsList,
    webFetches: 0,
    userModified: 0,

    toolCounts: p.toolCounts,
    subagents: p.subagents,

    escInterrupts: 0,
    permissionFlips: 0,
    yoloEvents: 0,
    thinkingMs: p.thinkingMs,
    skills: [],
    slashCommands: [],
    truncatedOutputs: 0,
    hookErrors: 0,
    longestUserMsgChars: p.longestUserMsgChars,
    promptLengths: p.promptLengths,
    promptTexts: p.promptTexts,
    promptTimestamps: p.promptTimestamps,

    firstPrompt: p.firstPrompt,
    shortestPromptText: p.shortestPromptText,

    longestSoloStretchMs: p.longestSoloStretchMs,
    longestSoloStretchStartUtc: p.longestSoloStretchStartUtc,
    longestSoloStretchEndUtc: p.longestSoloStretchEndUtc,
    waitThenGoCount: p.waitThenGoCount,
    politenessPlease: p.politenessPlease,
    politenessThanks: p.politenessThanks,
    politenessSorry: p.politenessSorry,
    rateLimitHits: p.rateLimitHits,
    rateLimitWaitMs: p.rateLimitWaitMs,
    tokenEvents: p.tokenEvents,

    compactionCount: p.compactionCount,
    firstCompactPreTokens: p.firstCompactPreTokens,
    firstCompactContextPct: p.firstCompactContextPct,
    mcpServers: p.mcpServers,
    sidechainEvents: p.sidechainEvents,
    correctionCount: p.correctionCount,
  };
}
