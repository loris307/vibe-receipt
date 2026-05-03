import { describe, expect, it } from "vitest";
import { deriveComparison } from "../../src/aggregate/comparisons.js";
import type { Receipt } from "../../src/data/receipt-schema.js";
import { HISTORY_SCHEMA_VERSION, type SessionHistoryEntry } from "../../src/history/types.js";

function receipt(over: Partial<Receipt> = {}): Receipt {
  const base: Receipt = {
    scope: { kind: "single", sessionId: "current" },
    generatedAt: "2026-05-02T12:00:00Z",
    meta: {
      project: "p",
      branch: null,
      sources: ["claude"],
      sessionCount: 1,
    },
    time: {
      startUtc: "2026-05-02T11:00:00Z",
      endUtc: "2026-05-02T12:00:00Z",
      durationMs: 3600_000,
      activeMs: 1800_000,
      afkMs: 1800_000,
      afkRecaps: [],
      longestSoloStretchMs: 0,
      longestSoloStretchStartUtc: null,
      longestSoloStretchEndUtc: null,
      compactionCount: 0,
      firstCompactPreTokens: null,
      firstCompactContextPct: null,
    },
    cost: {
      totalUsd: 5,
      inputTokens: 1000,
      outputTokens: 2000,
      cacheCreateTokens: 500,
      cacheReadTokens: 10000,
      cacheHitRatio: 0.5,
      models: ["claude-opus-4-7"],
      rateLimitHits: 0,
      rateLimitWaitMs: 0,
      burnRatePeakTokensPerMin: 0,
      burnRatePeakWindowUtc: null,
      costPerLineUsd: 0,
    },
    work: {
      filesTouched: 0,
      topFiles: [],
      linesAdded: 0,
      linesRemoved: 0,
      bashCommands: 0,
      webFetches: 0,
      userModified: 0,
      mostEditedFile: null,
    },
    tools: { total: 0, top: [], mcpServers: [], sidechainEvents: 0 },
    subagents: [],
    personality: {
      escInterrupts: 0,
      permissionFlips: 0,
      yoloEvents: 0,
      thinkingMs: 0,
      skills: [],
      slashCommands: [],
      truncatedOutputs: 0,
      hookErrors: 0,
      longestUserMsgChars: 0,
      promptCount: 0,
      longestPromptChars: 0,
      shortestPromptChars: 0,
      avgPromptChars: 0,
      shortestPromptText: null,
      waitThenGoCount: 0,
      politenessScore: { please: 0, thanks: 0, sorry: 0, total: 0 },
      correctionCount: 0,
      correctionRate: 0,
    },
    firstPrompt: {
      wordCount: 0,
      charCount: 0,
      moodEmoji: "",
      fingerprintSha: "",
      preview: null,
      revealed: null,
    },
    archetype: { key: "vibe-coder", taglineKey: "x", scores: {} },
    comparison: null,
    achievements: [],
    ...over,
  };
  return base;
}

function entry(over: Partial<SessionHistoryEntry> = {}): SessionHistoryEntry {
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    recordedAt: "2026-05-01T10:00:00Z",
    sessionId: "prior",
    source: "claude",
    project: "p",
    branch: null,
    startUtc: "2026-05-01T09:00:00Z",
    endUtc: "2026-05-01T10:00:00Z",
    durationMs: 1800_000,
    activeMs: 900_000,
    totalUsd: 2.5,
    inputTokens: 500,
    outputTokens: 1000,
    cacheCreateTokens: 200,
    cacheReadTokens: 5000,
    totalTokens: 1700,
    filesTouched: 3,
    linesAdded: 50,
    linesRemoved: 5,
    toolCount: 15,
    promptCount: 4,
    archetype: null,
    models: ["claude-opus-4-7"],
    ...over,
  };
}

const NOW_MAY_2 = Date.parse("2026-05-02T12:00:00Z");

describe("deriveComparison", () => {
  it("returns null for combine receipts", () => {
    const r = receipt({ scope: { kind: "combine-since", since: "1h" } });
    expect(deriveComparison(r, [entry()], NOW_MAY_2)).toBeNull();
  });

  it("returns null when history has no same-source entries", () => {
    expect(deriveComparison(receipt(), [], NOW_MAY_2)).toBeNull();
  });

  it("returns null when only entry is the current session itself", () => {
    expect(deriveComparison(receipt(), [entry({ sessionId: "current" })], NOW_MAY_2)).toBeNull();
  });

  it("computes vs-last-session percent deltas", () => {
    const r = receipt(); // current totalTokens = 1000+2000+500 = 3500
    const c = deriveComparison(r, [entry()], NOW_MAY_2)!;
    expect(c.vsLastSession).not.toBeNull();
    // 3500 vs 1700 → +1.058...
    expect(c.vsLastSession!.deltaTokensPct).toBeCloseTo(1.0588, 2);
    // cost 5 vs 2.5 → +1.0
    expect(c.vsLastSession!.deltaCostPct).toBeCloseTo(1, 4);
    // duration 3.6m vs 1.8m → +1.0
    expect(c.vsLastSession!.deltaDurationPct).toBeCloseTo(1, 4);
  });

  it("excludes self from vs-last-session when re-rendering", () => {
    const r = receipt();
    const c = deriveComparison(
      r,
      [entry({ sessionId: "current", totalTokens: 9999 }), entry()],
      NOW_MAY_2,
    )!;
    // first entry was current — must skip; second entry (prior) is what we compare to
    expect(c.vsLastSession!.sessionId).toBe("prior");
  });

  it("computes 7-day window stats", () => {
    const r = receipt();
    // 3 prior entries inside 7-day window
    const hist = [
      entry({ sessionId: "a", totalTokens: 1000, totalUsd: 1, durationMs: 100 }),
      entry({ sessionId: "b", totalTokens: 2000, totalUsd: 2, durationMs: 200 }),
      entry({ sessionId: "c", totalTokens: 4000, totalUsd: 4, durationMs: 400 }),
    ];
    const c = deriveComparison(r, hist, NOW_MAY_2)!;
    expect(c.vsLast7Days).not.toBeNull();
    expect(c.vsLast7Days!.sessionsInWindow).toBe(4); // 3 prior + current
    // current tokens = 3500 ranks behind c (4000), so rank=2 (sorted desc: 4000,3500,2000,1000)
    expect(c.vsLast7Days!.tokensRankInWindow).toBe(2);
    expect(c.vsLast7Days!.longestSessionInWindow).toBe(true); // current dur=3600000 >> 400
  });

  it("excludes entries older than 7 days from window", () => {
    const r = receipt();
    const oldEntry = entry({
      sessionId: "old",
      recordedAt: "2026-04-20T00:00:00Z", // ~12 days before
    });
    const c = deriveComparison(r, [oldEntry], NOW_MAY_2)!;
    expect(c.vsLastSession).not.toBeNull(); // still found via "vs last"
    expect(c.vsLast7Days).toBeNull(); // but not in 7-day window
  });

  it("filters by source", () => {
    const r = receipt();
    const otherSource = entry({ source: "codex" });
    expect(deriveComparison(r, [otherSource], NOW_MAY_2)).toBeNull();
  });
});
