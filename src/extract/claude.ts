import { glob } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { readJsonlAll } from "../util/jsonl.js";
import { extractClaudePersonality } from "./personality/claude-jsonl.js";
import type { LoadOpts, NormalizedSession } from "../data/types.js";

/**
 * Resolves Claude project JSONL search roots, honoring CLAUDE_CONFIG_DIR + XDG dual-default.
 */
export function getClaudeJsonlRoots(): string[] {
  const env = process.env.CLAUDE_CONFIG_DIR;
  if (env) {
    return env
      .split(",")
      .map((p) => resolve(p.trim(), "projects"))
      .filter(Boolean);
  }
  return [
    resolve(homedir(), ".claude", "projects"),
    resolve(homedir(), ".config", "claude", "projects"),
  ];
}

async function listJsonlFiles(): Promise<string[]> {
  const roots = getClaudeJsonlRoots();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    try {
      // node 22+ glob
      // @ts-expect-error glob is generator
      for await (const file of glob("**/*.jsonl", { cwd: root, withFileTypes: false })) {
        const abs = resolve(root, String(file));
        if (!seen.has(abs)) {
          seen.add(abs);
          out.push(abs);
        }
      }
    } catch {
      // root missing, skip
    }
  }
  return out;
}

/**
 * Normalizes a Claude personality bundle into the cross-source NormalizedSession.
 * Token/cost fields are filled by mergeWithCcusage().
 */
function personalityToNormalized(p: Awaited<ReturnType<typeof extractClaudePersonality>>): NormalizedSession {
  const sessionId = p.sessionId ?? "unknown";
  return {
    source: "claude",
    sessionId,
    cwd: p.cwd ?? "unknown",
    branch: p.branch,
    models: p.models,
    startUtc: p.startUtc ?? new Date(0).toISOString(),
    endUtc: p.endUtc ?? new Date().toISOString(),
    durationMs: p.durationMs,

    inputTokens: 0,
    outputTokens: 0,
    cacheCreateTokens: 0,
    cacheReadTokens: 0,
    totalCostUsd: 0,

    activeMs: p.activeMs,
    afkMs: p.afkMs,
    afkRecaps: p.afkRecaps,

    filesTouched: p.filesTouched,
    topFiles: p.topFiles,
    linesAdded: p.linesAdded,
    linesRemoved: p.linesRemoved,
    bashCommands: p.bashCommands,
    webFetches: p.webFetches,
    userModified: p.userModified,

    toolCounts: p.toolCounts,
    subagents: p.subagents,

    escInterrupts: p.escInterrupts,
    permissionFlips: p.permissionFlips,
    yoloEvents: p.yoloEvents,
    thinkingMs: p.thinkingMs,
    skills: p.skills,
    slashCommands: p.slashCommands,
    truncatedOutputs: p.truncatedOutputs,
    hookErrors: p.hookErrors,
    longestUserMsgChars: p.longestUserMsgChars,

    firstPrompt: p.firstPrompt,
  };
}

/**
 * Pure-JSONL token/cost summation as a fallback when ccusage data isn't available.
 * Sums input/output/cache_creation/cache_read tokens across distinct (msg.id, requestId) pairs.
 * Cost = 0 in fallback (we'd need pricing table; ccusage handles it when used).
 */
async function fallbackTokenSum(filePath: string): Promise<{
  inputTokens: number;
  outputTokens: number;
  cacheCreateTokens: number;
  cacheReadTokens: number;
}> {
  const events = await readJsonlAll<any>(filePath);
  const seen = new Set<string>();
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreateTokens = 0;
  let cacheReadTokens = 0;
  for (const evt of events) {
    if (evt?.type !== "assistant") continue;
    const usage = evt?.message?.usage;
    if (!usage || typeof usage !== "object") continue;
    const id = `${evt.message?.id ?? ""}::${evt.requestId ?? ""}`;
    if (!id || id === "::") continue;
    if (seen.has(id)) continue;
    seen.add(id);
    inputTokens += Number(usage.input_tokens ?? 0);
    outputTokens += Number(usage.output_tokens ?? 0);
    cacheCreateTokens += Number(usage.cache_creation_input_tokens ?? 0);
    cacheReadTokens += Number(usage.cache_read_input_tokens ?? 0);
  }
  return { inputTokens, outputTokens, cacheCreateTokens, cacheReadTokens };
}

/** Use ccusage's loadSessionUsageById for token + cost merging where possible. */
async function mergeWithCcusage(
  ns: NormalizedSession,
  filePath: string,
): Promise<NormalizedSession> {
  // Try ccusage by sessionId; if it fails or returns nothing, fall back to JSONL summation.
  try {
    const mod: any = await import("ccusage/data-loader");
    const loadById = mod.loadSessionUsageById;
    if (typeof loadById === "function") {
      const data = await loadById(ns.sessionId, { mode: "auto" });
      if (data && typeof data === "object") {
        const inputTokens = Number(data.inputTokens ?? data.input_tokens ?? 0);
        const outputTokens = Number(data.outputTokens ?? data.output_tokens ?? 0);
        const cacheCreateTokens = Number(
          data.cacheCreationTokens ?? data.cache_creation_tokens ?? 0,
        );
        const cacheReadTokens = Number(data.cacheReadTokens ?? data.cache_read_tokens ?? 0);
        const totalCostUsd = Number(data.totalCost ?? data.totalCostUsd ?? data.cost ?? 0);
        if (inputTokens || outputTokens || cacheCreateTokens || cacheReadTokens) {
          return {
            ...ns,
            inputTokens,
            outputTokens,
            cacheCreateTokens,
            cacheReadTokens,
            totalCostUsd,
          };
        }
      }
    }
  } catch {
    // fall through to fallback
  }
  const fb = await fallbackTokenSum(filePath);
  return { ...ns, ...fb };
}

function passesFilters(ns: NormalizedSession, opts: LoadOpts): boolean {
  if (opts.sessionId && ns.sessionId !== opts.sessionId) return false;
  if (opts.cwd && ns.cwd !== opts.cwd) return false;
  if (opts.branch && ns.branch !== opts.branch) return false;
  if (typeof opts.sinceMs === "number") {
    const end = new Date(ns.endUtc).getTime();
    if (!Number.isFinite(end) || end < opts.sinceMs) return false;
  }
  return true;
}

export const loadClaudeSessions: import("../data/types.js").SourceLoader = async (opts) => {
  const files = await listJsonlFiles();
  const out: NormalizedSession[] = [];
  for (const file of files) {
    const personality = await extractClaudePersonality(file);
    if (!personality.sessionId) continue;
    const ns = personalityToNormalized(personality);
    if (!passesFilters(ns, opts)) continue;
    const merged = await mergeWithCcusage(ns, file);
    out.push(merged);
  }
  out.sort((a, b) => new Date(b.endUtc).getTime() - new Date(a.endUtc).getTime());
  if (typeof opts.limit === "number") return out.slice(0, opts.limit);
  return out;
};

/**
 * Direct loader for an explicit file path — skips glob. Used by tests + `--session <uuid>` against
 * fixtures.
 */
export async function loadClaudeFromFile(filePath: string): Promise<NormalizedSession> {
  const personality = await extractClaudePersonality(filePath);
  const ns = personalityToNormalized(personality);
  return mergeWithCcusage(ns, filePath);
}
