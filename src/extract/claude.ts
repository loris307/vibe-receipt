import { glob, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { LoadOpts, NormalizedSession } from "../data/types.js";
import { readJsonlAll } from "../util/jsonl.js";
import { computeClaudeCostUsd } from "./claude-pricing.js";
import { extractClaudePersonality } from "./personality/claude-jsonl.js";

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

/**
 * Returns true for paths Claude Code treats as a sub-transcript (subagent dispatches),
 * which we MUST exclude — they are not independent sessions; their data is already
 * counted in the parent session's `Agent` tool_use blocks.
 *
 * Layout we observe in the wild:
 *   ~/.claude/projects/<slug>/<session-uuid>.jsonl                ← real session ✓
 *   ~/.claude/projects/<slug>/<session-uuid>/subagents/agent-*.jsonl  ← subagent ✗
 */
function isSubagentJsonl(path: string): boolean {
  return path.includes("/subagents/") || /\/agent-[a-z0-9]+\.jsonl$/i.test(path);
}

async function listJsonlFilesWithMtime(): Promise<{ path: string; mtimeMs: number }[]> {
  const roots = getClaudeJsonlRoots();
  const out: { path: string; mtimeMs: number }[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    try {
      for await (const file of glob("**/*.jsonl", { cwd: root, withFileTypes: false })) {
        const abs = resolve(root, String(file));
        if (seen.has(abs)) continue;
        seen.add(abs);
        if (isSubagentJsonl(abs)) continue;
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
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

/**
 * Normalizes a Claude personality bundle into the cross-source NormalizedSession.
 * Token/cost fields are filled by mergeWithCcusage().
 */
function personalityToNormalized(
  p: Awaited<ReturnType<typeof extractClaudePersonality>>,
): NormalizedSession {
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
    fileEntries: p.fileEntries,
    linesAdded: p.linesAdded,
    linesRemoved: p.linesRemoved,
    bashCommands: p.bashCommands,
    bashCommandsList: p.bashCommandsList,
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

    // v0.3
    compactionCount: p.compactionCount,
    firstCompactPreTokens: p.firstCompactPreTokens,
    firstCompactContextPct: p.firstCompactContextPct,
    mcpServers: p.mcpServers,
    sidechainEvents: p.sidechainEvents,
    correctionCount: p.correctionCount,
  };
}

/**
 * Pure-JSONL token/cost summation as a fallback when ccusage data isn't available.
 * Sums input/output/cache_creation/cache_read tokens across distinct (msg.id, requestId) pairs.
 * Cost = 0 in fallback (we'd need pricing table; ccusage handles it when used).
 */
interface TokenSum {
  inputTokens: number;
  outputTokens: number;
  cacheCreateTokens: number;
  /** Subset of cacheCreateTokens that used the 1h cache (priced at 2× input vs 5m's 1.25×). */
  cacheCreate1hTokens: number;
  cacheReadTokens: number;
}

async function sumTokensInFile(filePath: string, sinceMs?: number): Promise<TokenSum> {
  const events = await readJsonlAll<any>(filePath);
  const seen = new Set<string>();
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreateTokens = 0;
  let cacheCreate1hTokens = 0;
  let cacheReadTokens = 0;
  for (const evt of events) {
    if (evt?.type !== "assistant") continue;
    if (typeof sinceMs === "number") {
      const ts = evt?.timestamp;
      if (typeof ts !== "string") continue;
      const t = new Date(ts).getTime();
      if (!Number.isFinite(t) || t < sinceMs) continue;
    }
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
    // 5m vs 1h split lives under usage.cache_creation when the API serves it.
    const cc = usage.cache_creation;
    if (cc && typeof cc === "object") {
      cacheCreate1hTokens += Number(cc.ephemeral_1h_input_tokens ?? 0);
    }
  }
  return { inputTokens, outputTokens, cacheCreateTokens, cacheCreate1hTokens, cacheReadTokens };
}

/**
 * Sum tokens for a main session's JSONL PLUS its subagent transcripts.
 *
 * Layout:
 *   ~/.claude/projects/<slug>/<sessId>.jsonl                ← parent
 *   ~/.claude/projects/<slug>/<sessId>/subagents/agent-*.jsonl  ← subagent transcripts
 *
 * Each subagent makes its own API calls — Anthropic bills them separately, so they
 * MUST be added to the parent's cost. We don't promote subagents to standalone
 * sessions (their work is already summarized via Agent tool_use in the parent).
 *
 * Returns parent and subagent sums separately so the cost merge can apply ccusage
 * (parent-only) + our pricing table (subagent) without double-counting.
 */
async function fallbackTokenSum(
  filePath: string,
  sinceMs?: number,
): Promise<{ parent: TokenSum; subagent: TokenSum; combined: TokenSum }> {
  const parent = await sumTokensInFile(filePath, sinceMs);
  const parentBase = filePath.replace(/\.jsonl$/, "");
  const subagentDir = resolve(parentBase, "subagents");
  const subagent: TokenSum = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreateTokens: 0,
    cacheCreate1hTokens: 0,
    cacheReadTokens: 0,
  };
  try {
    for await (const file of glob("*.jsonl", { cwd: subagentDir, withFileTypes: false })) {
      const subPath = resolve(subagentDir, String(file));
      const sub = await sumTokensInFile(subPath, sinceMs);
      subagent.inputTokens += sub.inputTokens;
      subagent.outputTokens += sub.outputTokens;
      subagent.cacheCreateTokens += sub.cacheCreateTokens;
      subagent.cacheCreate1hTokens += sub.cacheCreate1hTokens;
      subagent.cacheReadTokens += sub.cacheReadTokens;
    }
  } catch {
    // no subagents dir — fine
  }
  const combined: TokenSum = {
    inputTokens: parent.inputTokens + subagent.inputTokens,
    outputTokens: parent.outputTokens + subagent.outputTokens,
    cacheCreateTokens: parent.cacheCreateTokens + subagent.cacheCreateTokens,
    cacheCreate1hTokens: parent.cacheCreate1hTokens + subagent.cacheCreate1hTokens,
    cacheReadTokens: parent.cacheReadTokens + subagent.cacheReadTokens,
  };
  return { parent, subagent, combined };
}

function tokenSumIsZero(t: TokenSum): boolean {
  return (
    t.inputTokens === 0 &&
    t.outputTokens === 0 &&
    t.cacheCreateTokens === 0 &&
    t.cacheReadTokens === 0
  );
}

/**
 * Token + cost merge strategy:
 * 1. Always run our own JSONL token-sum (dedup'd by message.id+requestId).
 * 2. Try ccusage's loadSessionUsageById for an authoritative number; if it returns more,
 *    use ccusage's tokens. (ccusage may have stricter dedup.)
 * 3. Compute cost from our hardcoded model→price table (covers Anthropic models that
 *    LiteLLM hasn't added yet).
 * 4. If ccusage returned a non-zero cost, prefer that.
 */
async function mergeTokensAndCost(
  ns: NormalizedSession,
  filePath: string,
  sinceMs?: number,
): Promise<NormalizedSession> {
  const fb = await fallbackTokenSum(filePath, sinceMs);
  // Working values default to PARENT (we may upgrade to ccusage's parent-only numbers below);
  // subagent values are always tracked separately so cost stays correct.
  let parentInput = fb.parent.inputTokens;
  let parentOutput = fb.parent.outputTokens;
  let parentCreate = fb.parent.cacheCreateTokens;
  const parentCreate1h = fb.parent.cacheCreate1hTokens;
  let parentRead = fb.parent.cacheReadTokens;
  let ccusageCost = 0;

  // ccusage's loadSessionUsageById has no time-window awareness — only call it for
  // un-clipped (whole-session) extractions; otherwise our in-window fallback is the truth.
  // ccusage only sees the parent transcript by sessionId; subagent transcripts are
  // separate files Anthropic bills independently.
  if (typeof sinceMs !== "number")
    try {
      const mod: any = await import("ccusage/data-loader");
      const loadById = mod.loadSessionUsageById;
      if (typeof loadById === "function") {
        const data = await loadById(ns.sessionId, { mode: "auto" });
        if (data && typeof data === "object") {
          const ci = Number(data.inputTokens ?? data.input_tokens ?? 0);
          const co = Number(data.outputTokens ?? data.output_tokens ?? 0);
          const cc = Number(data.cacheCreationTokens ?? data.cache_creation_tokens ?? 0);
          const cr = Number(data.cacheReadTokens ?? data.cache_read_tokens ?? 0);
          const cu = Number(data.totalCost ?? data.totalCostUsd ?? data.cost ?? 0);
          // ccusage doesn't expose 5m vs 1h split, so we keep our 1h count from the JSONL.
          if (ci + co + cc + cr > 0) {
            parentInput = ci;
            parentOutput = co;
            parentCreate = cc;
            parentRead = cr;
          }
          if (cu > 0) ccusageCost = cu;
        }
      }
    } catch {
      // ignore — use fallback values
    }

  // Cost split: parent uses ccusage (authoritative) when available; else our table.
  // Subagents ALWAYS use our table — ccusage's per-session API never sees them, and
  // omitting their cost was the v0.3 undercounting bug (#5 in fixes.md).
  const parentCostFromTable = computeClaudeCostUsd({
    models: ns.models,
    inputTokens: parentInput,
    outputTokens: parentOutput,
    cacheCreateTokens: parentCreate,
    cacheCreate1hTokens: parentCreate1h,
    cacheReadTokens: parentRead,
  });
  const parentCost = ccusageCost > 0 ? ccusageCost : parentCostFromTable;
  const subagentCost = tokenSumIsZero(fb.subagent)
    ? 0
    : computeClaudeCostUsd({
        models: ns.models,
        inputTokens: fb.subagent.inputTokens,
        outputTokens: fb.subagent.outputTokens,
        cacheCreateTokens: fb.subagent.cacheCreateTokens,
        cacheCreate1hTokens: fb.subagent.cacheCreate1hTokens,
        cacheReadTokens: fb.subagent.cacheReadTokens,
      });
  const totalCostUsd = parentCost + subagentCost;

  return {
    ...ns,
    inputTokens: parentInput + fb.subagent.inputTokens,
    outputTokens: parentOutput + fb.subagent.outputTokens,
    cacheCreateTokens: parentCreate + fb.subagent.cacheCreateTokens,
    cacheReadTokens: parentRead + fb.subagent.cacheReadTokens,
    totalCostUsd,
  };
}

function passesFilters(ns: NormalizedSession, opts: LoadOpts): boolean {
  // Allow short --session prefixes (README documents `vibe-receipt --session 297c7fe2`,
  // and `history list` only shows the first 8 chars). Exact match still works because
  // a string is a prefix of itself.
  if (opts.sessionId && !ns.sessionId.startsWith(opts.sessionId)) return false;
  if (opts.cwd && ns.cwd !== opts.cwd) return false;
  if (opts.branch && ns.branch !== opts.branch) return false;
  if (typeof opts.sinceMs === "number") {
    const end = new Date(ns.endUtc).getTime();
    if (!Number.isFinite(end) || end < opts.sinceMs) return false;
  }
  return true;
}

export const loadClaudeSessions: import("../data/types.js").SourceLoader = async (opts) => {
  const files = await listJsonlFilesWithMtime();
  const out: NormalizedSession[] = [];
  const sinceMs = typeof opts.sinceMs === "number" ? opts.sinceMs : null;
  const wantSession = opts.sessionId;
  const wantBranch = opts.branch;
  const wantCwd = opts.cwd;
  const limit =
    typeof opts.limit === "number"
      ? opts.limit
      : wantSession
        ? 50 // small cap when filtering by session id
        : sinceMs === null && !wantBranch && !wantCwd
          ? 1 // default-mode picker only needs the most recent
          : Number.POSITIVE_INFINITY;

  for (const { path, mtimeMs } of files) {
    // Early exit by sinceMs (files are sorted by mtime desc).
    if (sinceMs !== null && mtimeMs < sinceMs) break;
    const personality =
      sinceMs !== null
        ? await extractClaudePersonality(path, { sinceMs })
        : await extractClaudePersonality(path);
    if (!personality.sessionId) continue;
    // After event-level filtering, a "session" can be empty if no events fell in window.
    if (sinceMs !== null && personality.promptLengths.length === 0 && personality.durationMs === 0)
      continue;
    const ns = personalityToNormalized(personality);
    if (!passesFilters(ns, opts)) continue;
    const merged = await mergeTokensAndCost(ns, path, sinceMs !== null ? sinceMs : undefined);
    out.push(merged);
    if (out.length >= limit) break;
  }
  out.sort((a, b) => new Date(b.endUtc).getTime() - new Date(a.endUtc).getTime());
  return out;
};

/**
 * Direct loader for an explicit file path — skips glob. Used by tests + `--session <uuid>` against
 * fixtures.
 */
export async function loadClaudeFromFile(filePath: string): Promise<NormalizedSession> {
  const personality = await extractClaudePersonality(filePath);
  const ns = personalityToNormalized(personality);
  return mergeTokensAndCost(ns, filePath);
}
