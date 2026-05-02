import { basename } from "node:path";
import type { Receipt, ReceiptScope, Subagent, TopFile } from "../data/receipt-schema.js";
import type { NormalizedSession, Source } from "../data/types.js";
import { topToolStats } from "../data/types.js";
import { computeFirstPromptFingerprint } from "../redact/fingerprint.js";
import { promptStatsOf } from "./prompt-stats.js";

const TOP_FILES_LIMIT = 5;
const SUBAGENT_LIMIT = 8;
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

    for (const f of s.topFiles) {
      const cur = fileMap.get(f.path);
      if (cur) {
        cur.added += f.added;
        cur.removed += f.removed;
      } else {
        fileMap.set(f.path, { path: f.path, added: f.added, removed: f.removed });
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
    if (s.longestUserMsgChars > longestUserMsgChars)
      longestUserMsgChars = s.longestUserMsgChars;
    for (const len of s.promptLengths) promptLengths.push(len);

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

  return {
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
    },
    cost: {
      totalUsd,
      inputTokens,
      outputTokens,
      cacheCreateTokens,
      cacheReadTokens,
      cacheHitRatio,
      models: Array.from(modelSet),
    },
    work: {
      filesTouched: fileMap.size,
      topFiles: fileEntries.slice(0, TOP_FILES_LIMIT),
      linesAdded: fileEntries.reduce((s, f) => s + f.added, 0),
      linesRemoved: fileEntries.reduce((s, f) => s + f.removed, 0),
      bashCommands,
      webFetches,
      userModified,
    },
    tools: {
      total: Object.values(toolCounts).reduce((s, n) => s + n, 0),
      top: topToolStats(toolCounts, TOOL_LIMIT),
    },
    subagents: subagents.slice(0, SUBAGENT_LIMIT),
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
    },
    firstPrompt: fp,
  };
}
