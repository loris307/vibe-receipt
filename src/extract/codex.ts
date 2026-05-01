import { glob } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { extractCodexPersonality } from "./personality/codex-jsonl.js";
import type { LoadOpts, NormalizedSession, SourceLoader } from "../data/types.js";

/**
 * Hardcoded fallback prices per million tokens (USD). Targets common Codex / GPT-5 models.
 * Refreshed as needed. (TODO v1.1: share LiteLLM pricing fetch with ccusage.)
 */
const CODEX_PRICES_PER_MTOK: Record<string, { input: number; cached: number; output: number }> = {
  "gpt-5.3-codex": { input: 1.25, cached: 0.125, output: 10.0 },
  "gpt-5.2-codex": { input: 1.0, cached: 0.1, output: 8.0 },
  "gpt-5.1-codex": { input: 1.0, cached: 0.1, output: 8.0 },
  "gpt-5-codex": { input: 1.0, cached: 0.1, output: 8.0 },
  "o4-mini": { input: 1.1, cached: 0.275, output: 4.4 },
  "o4": { input: 5.0, cached: 1.25, output: 20.0 },
  "o3-mini": { input: 1.1, cached: 0.55, output: 4.4 },
  default: { input: 1.0, cached: 0.1, output: 8.0 },
};

function priceFor(model: string) {
  return CODEX_PRICES_PER_MTOK[model] ?? CODEX_PRICES_PER_MTOK.default!;
}

function computeCostUsd(opts: {
  model: string;
  input: number;
  cached: number;
  output: number;
}): number {
  const p = priceFor(opts.model);
  const cost =
    (opts.input - opts.cached) * (p.input / 1_000_000) +
    opts.cached * (p.cached / 1_000_000) +
    opts.output * (p.output / 1_000_000);
  return Math.max(0, cost);
}

export function getCodexJsonlRoot(): string {
  return process.env.CODEX_HOME
    ? resolve(process.env.CODEX_HOME, "sessions")
    : resolve(homedir(), ".codex", "sessions");
}

async function listJsonlFiles(): Promise<string[]> {
  const root = getCodexJsonlRoot();
  const out: string[] = [];
  try {
    // @ts-expect-error glob is generator
    for await (const file of glob("**/*.jsonl", { cwd: root, withFileTypes: false })) {
      out.push(resolve(root, String(file)));
    }
  } catch {
    // root missing
  }
  return out;
}

function passesFilters(ns: NormalizedSession, opts: LoadOpts): boolean {
  if (opts.sessionId && ns.sessionId !== opts.sessionId) return false;
  if (opts.cwd && ns.cwd !== opts.cwd) return false;
  if (typeof opts.sinceMs === "number") {
    const end = new Date(ns.endUtc).getTime();
    if (!Number.isFinite(end) || end < opts.sinceMs) return false;
  }
  return true;
}

export const loadCodexSessions: SourceLoader = async (opts) => {
  const files = await listJsonlFiles();
  const out: NormalizedSession[] = [];
  for (const file of files) {
    const p = await extractCodexPersonality(file);
    if (!p.sessionId) continue;
    const model = p.models[0] ?? "default";
    const totalCostUsd = computeCostUsd({
      model,
      input: p.inputTokens,
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

      inputTokens: p.inputTokens,
      outputTokens: p.outputTokens + p.reasoningOutputTokens,
      cacheCreateTokens: 0,
      cacheReadTokens: p.cachedInputTokens,
      totalCostUsd,

      activeMs: p.durationMs,
      afkMs: 0,
      afkRecaps: [],

      filesTouched: p.filesTouched,
      topFiles: p.topFiles,
      linesAdded: p.linesAdded,
      linesRemoved: p.linesRemoved,
      bashCommands: p.bashCommands,
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

      firstPrompt: p.firstPrompt,
    };
    if (!passesFilters(ns, opts)) continue;
    out.push(ns);
  }
  out.sort((a, b) => new Date(b.endUtc).getTime() - new Date(a.endUtc).getTime());
  if (typeof opts.limit === "number") return out.slice(0, opts.limit);
  return out;
};

export async function loadCodexFromFile(filePath: string): Promise<NormalizedSession> {
  const p = await extractCodexPersonality(filePath);
  const model = p.models[0] ?? "default";
  const totalCostUsd = computeCostUsd({
    model,
    input: p.inputTokens,
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

    inputTokens: p.inputTokens,
    outputTokens: p.outputTokens + p.reasoningOutputTokens,
    cacheCreateTokens: 0,
    cacheReadTokens: p.cachedInputTokens,
    totalCostUsd,

    activeMs: p.durationMs,
    afkMs: 0,
    afkRecaps: [],

    filesTouched: p.filesTouched,
    topFiles: p.topFiles,
    linesAdded: p.linesAdded,
    linesRemoved: p.linesRemoved,
    bashCommands: p.bashCommands,
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

    firstPrompt: p.firstPrompt,
  };
}
