import { basename } from "node:path";
import type { Receipt, ReceiptScope } from "../data/receipt-schema.js";
import type { NormalizedSession } from "../data/types.js";
import { topToolStats } from "../data/types.js";
import { computeFirstPromptFingerprint } from "../redact/fingerprint.js";
import { promptStatsOf } from "./prompt-stats.js";

export function buildSingleReceipt(ns: NormalizedSession): Receipt {
  const scope: ReceiptScope = { kind: "single", sessionId: ns.sessionId };
  const totalIn = ns.inputTokens + ns.cacheCreateTokens + ns.cacheReadTokens;
  const cacheHitRatio = totalIn > 0 ? ns.cacheReadTokens / totalIn : 0;

  const fp = computeFirstPromptFingerprint(ns.firstPrompt);

  return {
    scope,
    generatedAt: new Date().toISOString(),

    meta: {
      project: basename(ns.cwd) || "unknown",
      branch: ns.branch,
      sources: [ns.source],
      sessionCount: 1,
      ...(ns.inFlight ? { inFlight: true } : {}),
    },

    time: {
      startUtc: ns.startUtc,
      endUtc: ns.endUtc,
      durationMs: ns.durationMs,
      activeMs: ns.activeMs,
      afkMs: ns.afkMs,
      afkRecaps: ns.afkRecaps,
      longestSoloStretchMs: ns.longestSoloStretchMs,
      longestSoloStretchStartUtc: ns.longestSoloStretchStartUtc,
      longestSoloStretchEndUtc: ns.longestSoloStretchEndUtc,
    },

    cost: {
      totalUsd: ns.totalCostUsd,
      inputTokens: ns.inputTokens,
      outputTokens: ns.outputTokens,
      cacheCreateTokens: ns.cacheCreateTokens,
      cacheReadTokens: ns.cacheReadTokens,
      cacheHitRatio,
      models: ns.models,
      rateLimitHits: ns.rateLimitHits,
      rateLimitWaitMs: ns.rateLimitWaitMs,
      burnRatePeakTokensPerMin: 0,
      burnRatePeakWindowUtc: null,
      costPerLineUsd: 0,
    },

    work: {
      filesTouched: ns.fileEntries.length,
      topFiles: ns.fileEntries.slice(0, 5),
      linesAdded: ns.linesAdded,
      linesRemoved: ns.linesRemoved,
      bashCommands: ns.bashCommands,
      webFetches: ns.webFetches,
      userModified: ns.userModified,
      mostEditedFile: null,
    },

    tools: {
      total: Object.values(ns.toolCounts).reduce((s, n) => s + n, 0),
      top: topToolStats(ns.toolCounts, 5),
    },

    subagents: ns.subagents,

    personality: {
      escInterrupts: ns.escInterrupts,
      permissionFlips: ns.permissionFlips,
      yoloEvents: ns.yoloEvents,
      thinkingMs: ns.thinkingMs,
      skills: ns.skills,
      slashCommands: ns.slashCommands,
      truncatedOutputs: ns.truncatedOutputs,
      hookErrors: ns.hookErrors,
      longestUserMsgChars: ns.longestUserMsgChars,
      ...promptStatsOf(ns.promptLengths),
      shortestPromptText: ns.shortestPromptText,
      waitThenGoCount: ns.waitThenGoCount,
      politenessScore: {
        please: ns.politenessPlease,
        thanks: ns.politenessThanks,
        sorry: ns.politenessSorry,
        total: ns.politenessPlease + ns.politenessThanks + ns.politenessSorry,
      },
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
}
