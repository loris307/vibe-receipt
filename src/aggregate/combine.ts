import { basename } from "node:path";
import type {
  McpServerStat,
  Receipt,
  ReceiptScope,
  Subagent,
  TopFile,
} from "../data/receipt-schema.js";
import type { NormalizedSession, Source } from "../data/types.js";
import { topToolStats } from "../data/types.js";
import { computeFirstPromptFingerprint } from "../redact/fingerprint.js";
import { promptStatsOf } from "./prompt-stats.js";
import {
  computeBurnRatePeak,
  computeCostPerLine,
  computeMostEditedFile,
  type TokenEvent,
} from "./derive-stats.js";
import { deriveAchievements } from "./achievements.js";

const TOP_FILES_LIMIT = 5;
const TOOL_LIMIT = 5;

export function buildCombinedReceipt(
  sessions: NormalizedSession[],
  scope: ReceiptScope,
): Receipt {
  if (sessions.length === 0) {
    throw new Error("buildCombinedReceipt: no sessions in scope");
  }

  // Time: wall-clock window = max(end) - min(start); active = SUM
  let minStart = Number.POSITIVE_INFINITY;
  let maxEnd = 0;
  let activeMs = 0;
  let afkMs = 0;
  const afkRecaps: string[] = [];

  // Cost / tokens: SUM
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreateTokens = 0;
  let cacheReadTokens = 0;
  let totalUsd = 0;

  // Work: SUM with file aggregation
  const fileMap = new Map<string, TopFile>();
  let bashCommands = 0;
  let webFetches = 0;
  let userModified = 0;

  // Tools: re-aggregate
  const toolCounts: Record<string, number> = {};

  // Subagents: concat then sort by duration desc, take top N
  const subagents: Subagent[] = [];

  // Personality: SUM
  let escInterrupts = 0;
  let permissionFlips = 0;
  let yoloEvents = 0;
  let thinkingMs = 0;
  let truncatedOutputs = 0;
  let hookErrors = 0;
  let longestUserMsgChars = 0;
  const promptLengths: number[] = [];
  let shortestPromptText: string | null = null;

  // v0.2 — time
  let longestSoloStretchMs = 0;
  let longestSoloStretchStartUtc: string | null = null;
  let longestSoloStretchEndUtc: string | null = null;
  // v0.2 — personality
  let waitThenGoCount = 0;
  let politenessPlease = 0;
  let politenessThanks = 0;
  let politenessSorry = 0;
  // v0.2 — cost
  let rateLimitHits = 0;
  let rateLimitWaitMs = 0;
  const allTokenEvents: TokenEvent[] = [];
  // v0.3
  let compactionCount = 0;
  /** Earliest session that contributed a compaction (by session.startUtc).
   *  We copy its already-clamped pct rather than recomputing — model context is per-session. */
  let firstCompactCarrier: { startUtcMs: number; ns: NormalizedSession } | null = null;
  let sidechainEvents = 0;
  let correctionCount = 0;
  const mcpAccumulator = new Map<
    string,
    { callCount: number; tools: Set<string> }
  >();
  const skillSet = new Set<string>();
  const slashSet = new Set<string>();
  const modelSet = new Set<string>();
  const sourceSet = new Set<Source>();

  // Earliest first prompt wins
  let firstPromptCandidate: { ts: number; text: string } | null = null;

  // Branch: pick the most-frequent across sessions
  const branchCounts = new Map<string, number>();

  // cwd: pick majority for project label
  const cwdCounts = new Map<string, number>();

  for (const s of sessions) {
    const start = new Date(s.startUtc).getTime();
    const end = new Date(s.endUtc).getTime();
    if (Number.isFinite(start)) minStart = Math.min(minStart, start);
    if (Number.isFinite(end)) maxEnd = Math.max(maxEnd, end);

    activeMs += s.activeMs;
    afkMs += s.afkMs;
    for (const r of s.afkRecaps) {
      if (afkRecaps.length < 3) afkRecaps.push(r);
    }

    inputTokens += s.inputTokens;
    outputTokens += s.outputTokens;
    cacheCreateTokens += s.cacheCreateTokens;
    cacheReadTokens += s.cacheReadTokens;
    totalUsd += s.totalCostUsd;

    for (const f of s.fileEntries) {
      const cur = fileMap.get(f.path);
      if (cur) {
        cur.added += f.added;
        cur.removed += f.removed;
        cur.editCount = (cur.editCount ?? 0) + (f.editCount ?? 1);
      } else {
        fileMap.set(f.path, {
          path: f.path,
          added: f.added,
          removed: f.removed,
          editCount: f.editCount ?? 1,
        });
      }
    }
    bashCommands += s.bashCommands;
    webFetches += s.webFetches;
    userModified += s.userModified;

    for (const [name, count] of Object.entries(s.toolCounts)) {
      toolCounts[name] = (toolCounts[name] ?? 0) + count;
    }

    for (const sub of s.subagents) subagents.push(sub);

    escInterrupts += s.escInterrupts;
    permissionFlips += s.permissionFlips;
    yoloEvents += s.yoloEvents;
    thinkingMs += s.thinkingMs;
    truncatedOutputs += s.truncatedOutputs;
    hookErrors += s.hookErrors;

    waitThenGoCount += s.waitThenGoCount;
    politenessPlease += s.politenessPlease;
    politenessThanks += s.politenessThanks;
    politenessSorry += s.politenessSorry;
    rateLimitHits += s.rateLimitHits;
    rateLimitWaitMs += s.rateLimitWaitMs;
    for (const ev of s.tokenEvents) allTokenEvents.push(ev);

    // v0.3 merges
    compactionCount += s.compactionCount;
    sidechainEvents += s.sidechainEvents;
    correctionCount += s.correctionCount;
    if (s.firstCompactPreTokens !== null) {
      const ts = Number.isFinite(start) ? start : 0;
      if (firstCompactCarrier === null || ts < firstCompactCarrier.startUtcMs) {
        firstCompactCarrier = { startUtcMs: ts, ns: s };
      }
    }
    for (const m of s.mcpServers) {
      const cur = mcpAccumulator.get(m.name);
      if (cur) {
        cur.callCount += m.callCount;
        // toolCount sum is a weak approximation across sessions (tool sets may overlap).
        // Best-effort: keep a synthetic union by repeating server name with N tool slots —
        // we can't recover tool names here, so we sum and accept overcounting risk.
        // For a tight count, the extractor would need to expose tool names per server.
        // Acceptable for v0.3; revisit if combine-mode MCP becomes prominent.
        for (let i = 0; i < m.toolCount; i++) {
          cur.tools.add(`${m.name}#${cur.tools.size}`);
        }
      } else {
        const tools = new Set<string>();
        for (let i = 0; i < m.toolCount; i++) tools.add(`${m.name}#${i}`);
        mcpAccumulator.set(m.name, { callCount: m.callCount, tools });
      }
    }

    if (s.longestSoloStretchMs > longestSoloStretchMs) {
      longestSoloStretchMs = s.longestSoloStretchMs;
      longestSoloStretchStartUtc = s.longestSoloStretchStartUtc;
      longestSoloStretchEndUtc = s.longestSoloStretchEndUtc;
    }
    if (s.longestUserMsgChars > longestUserMsgChars)
      longestUserMsgChars = s.longestUserMsgChars;
    for (const len of s.promptLengths) promptLengths.push(len);
    if (
      s.shortestPromptText !== null &&
      (shortestPromptText === null ||
        s.shortestPromptText.length < shortestPromptText.length)
    ) {
      shortestPromptText = s.shortestPromptText;
    }

    for (const sk of s.skills) skillSet.add(sk);
    for (const sl of s.slashCommands) slashSet.add(sl);
    for (const m of s.models) modelSet.add(m);
    sourceSet.add(s.source);

    if (s.firstPrompt) {
      const ts = Number.isFinite(start) ? start : 0;
      if (!firstPromptCandidate || ts < firstPromptCandidate.ts) {
        firstPromptCandidate = { ts, text: s.firstPrompt };
      }
    }

    if (s.branch) {
      branchCounts.set(s.branch, (branchCounts.get(s.branch) ?? 0) + 1);
    }
    cwdCounts.set(s.cwd, (cwdCounts.get(s.cwd) ?? 0) + 1);
  }

  if (!Number.isFinite(minStart)) minStart = 0;

  const wallDurationMs = Math.max(0, maxEnd - minStart);

  // v0.3 — MCP servers: re-sort + cap 5
  const mergedMcpServers: McpServerStat[] = Array.from(mcpAccumulator.entries())
    .map(([name, e]) => ({ name, callCount: e.callCount, toolCount: e.tools.size }))
    .sort((a, b) => b.callCount - a.callCount)
    .slice(0, 5);

  const branchTop =
    branchCounts.size > 0
      ? Array.from(branchCounts.entries()).sort((a, b) => b[1] - a[1])[0]![0]!
      : null;
  const cwdTop =
    cwdCounts.size > 0
      ? Array.from(cwdCounts.entries()).sort((a, b) => b[1] - a[1])[0]![0]!
      : "unknown";

  const fileEntries = Array.from(fileMap.values()).sort(
    (a, b) => b.added + b.removed - (a.added + a.removed),
  );

  const totalIn = inputTokens + cacheCreateTokens + cacheReadTokens;
  const cacheHitRatio = totalIn > 0 ? cacheReadTokens / totalIn : 0;

  subagents.sort((a, b) => b.durationMs - a.durationMs);

  const fp = computeFirstPromptFingerprint(firstPromptCandidate?.text ?? null);
  const burn = computeBurnRatePeak(allTokenEvents);

  const result: Receipt = {
    scope,
    generatedAt: new Date().toISOString(),
    meta: {
      project: basename(cwdTop) || "unknown",
      branch: branchTop,
      sources: Array.from(sourceSet),
      sessionCount: sessions.length,
    },
    time: {
      startUtc: new Date(minStart).toISOString(),
      endUtc: new Date(maxEnd).toISOString(),
      durationMs: wallDurationMs,
      activeMs,
      afkMs,
      afkRecaps,
      longestSoloStretchMs,
      longestSoloStretchStartUtc,
      longestSoloStretchEndUtc,
      compactionCount,
      firstCompactPreTokens: firstCompactCarrier?.ns.firstCompactPreTokens ?? null,
      firstCompactContextPct: firstCompactCarrier?.ns.firstCompactContextPct ?? null,
    },
    cost: {
      totalUsd,
      inputTokens,
      outputTokens,
      cacheCreateTokens,
      cacheReadTokens,
      cacheHitRatio,
      models: Array.from(modelSet),
      rateLimitHits,
      rateLimitWaitMs,
      burnRatePeakTokensPerMin: burn.tpm,
      burnRatePeakWindowUtc: burn.windowStartUtc,
      costPerLineUsd: computeCostPerLine(
        totalUsd,
        fileEntries.reduce((s, f) => s + f.added, 0),
        fileEntries.reduce((s, f) => s + f.removed, 0),
      ),
    },
    work: {
      filesTouched: fileMap.size,
      topFiles: fileEntries.slice(0, TOP_FILES_LIMIT),
      linesAdded: fileEntries.reduce((s, f) => s + f.added, 0),
      linesRemoved: fileEntries.reduce((s, f) => s + f.removed, 0),
      bashCommands,
      webFetches,
      userModified,
      mostEditedFile: computeMostEditedFile(fileEntries),
    },
    tools: {
      total: Object.values(toolCounts).reduce((s, n) => s + n, 0),
      top: topToolStats(toolCounts, TOOL_LIMIT),
      mcpServers: mergedMcpServers,
      sidechainEvents,
    },
    subagents,
    personality: {
      escInterrupts,
      permissionFlips,
      yoloEvents,
      thinkingMs,
      skills: Array.from(skillSet).slice(0, 3),
      slashCommands: Array.from(slashSet).slice(0, 3),
      truncatedOutputs,
      hookErrors,
      longestUserMsgChars,
      ...promptStatsOf(promptLengths),
      shortestPromptText,
      waitThenGoCount,
      politenessScore: {
        please: politenessPlease,
        thanks: politenessThanks,
        sorry: politenessSorry,
        total: politenessPlease + politenessThanks + politenessSorry,
      },
      correctionCount,
      // re-derive from summed counts — never average per-session rates
      correctionRate:
        promptLengths.length > 0 ? correctionCount / promptLengths.length : 0,
    },
    firstPrompt: fp,
    archetype: {
      key: "vibe-coder",
      taglineKey: "archetype.vibe-coder.tagline",
      scores: {},
    },
    comparison: null,
    achievements: [],
  };
  // Achievements work on aggregate receipt — same rules apply.
  result.achievements = deriveAchievements(result);
  return result;
}
