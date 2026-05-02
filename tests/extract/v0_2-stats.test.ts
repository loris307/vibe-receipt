import { describe, expect, it } from "vitest";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractClaudePersonality } from "../../src/extract/personality/claude-jsonl.js";
import { scorePoliteness } from "../../src/extract/politeness.js";
import {
  computeBurnRatePeak,
  computeCostPerLine,
  computeMostEditedFile,
} from "../../src/aggregate/derive-stats.js";
import {
  pickArchetype,
  scoreAllArchetypes,
  type ArchetypeFeatures,
} from "../../src/aggregate/archetype.js";
import { deriveAchievements } from "../../src/aggregate/achievements.js";
import type { Receipt } from "../../src/data/receipt-schema.js";

async function makeFixture(events: unknown[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vibe-receipt-test-"));
  const path = join(dir, "session.jsonl");
  await writeFile(path, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return path;
}

function userEvent(ts: string, text: string) {
  return {
    type: "user",
    sessionId: "sess-test",
    timestamp: ts,
    cwd: "/tmp/proj",
    message: { role: "user", content: text },
  };
}

describe("phantom prompt filtering", () => {
  it("does not count [Request interrupted by user for tool use] as a real prompt", async () => {
    const path = await makeFixture([
      userEvent("2026-01-01T00:00:00Z", "real prompt"),
      userEvent("2026-01-01T00:01:00Z", "[Request interrupted by user for tool use]"),
      userEvent("2026-01-01T00:02:00Z", "another real prompt"),
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.promptLengths.length).toBe(2); // not 3
    expect(p.promptTexts).toEqual(["real prompt", "another real prompt"]);
  });

  it("does not count [Request interrupted by user] (short variant)", async () => {
    const path = await makeFixture([
      userEvent("2026-01-01T00:00:00Z", "real"),
      userEvent("2026-01-01T00:01:00Z", "[Request interrupted by user]"),
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.promptLengths.length).toBe(1);
  });
});

describe("longest solo-stretch", () => {
  it("0 ms with no prompts", async () => {
    const path = await makeFixture([
      { type: "system", subtype: "init", sessionId: "x", timestamp: "2026-01-01T00:00:00Z" },
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.longestSoloStretchMs).toBe(0);
    expect(p.longestSoloStretchStartUtc).toBeNull();
  });

  it("0 ms with single prompt", async () => {
    const path = await makeFixture([userEvent("2026-01-01T00:00:00Z", "hello")]);
    const p = await extractClaudePersonality(path);
    expect(p.longestSoloStretchMs).toBe(0);
  });

  it("computes max gap across multiple prompts", async () => {
    const path = await makeFixture([
      userEvent("2026-01-01T00:00:00Z", "first"),
      userEvent("2026-01-01T00:01:00Z", "second"), // 1 min gap
      userEvent("2026-01-01T00:06:00Z", "third"),  // 5 min gap (peak)
      userEvent("2026-01-01T00:08:00Z", "fourth"), // 2 min gap
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.longestSoloStretchMs).toBe(5 * 60_000);
    expect(p.longestSoloStretchStartUtc).toBe("2026-01-01T00:01:00.000Z");
    expect(p.longestSoloStretchEndUtc).toBe("2026-01-01T00:06:00.000Z");
  });

  it("ignores tool_result wrappers (only counts real prompts)", async () => {
    const path = await makeFixture([
      userEvent("2026-01-01T00:00:00Z", "first"),
      // a tool_result wrapper between real prompts — should NOT split the gap
      {
        type: "user",
        sessionId: "sess-test",
        timestamp: "2026-01-01T00:02:00Z",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }],
        },
      },
      userEvent("2026-01-01T00:10:00Z", "second"),
    ]);
    const p = await extractClaudePersonality(path);
    // gap = 10 minutes, NOT 8 (tool_result is not a real prompt)
    expect(p.longestSoloStretchMs).toBe(10 * 60_000);
  });

  it("handles unsorted timestamps gracefully", async () => {
    const path = await makeFixture([
      userEvent("2026-01-01T00:05:00Z", "B"),
      userEvent("2026-01-01T00:00:00Z", "A"),
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.longestSoloStretchMs).toBe(5 * 60_000);
  });
});

describe("politeness scoring", () => {
  it("counts please/thanks/sorry across multiple prompts", () => {
    expect(scorePoliteness(["please fix it", "thanks!", "sorry"])).toEqual({
      please: 1,
      thanks: 1,
      sorry: 1,
    });
  });

  it("counts repeats", () => {
    expect(scorePoliteness(["please please thanks please"])).toEqual({
      please: 3,
      thanks: 1,
      sorry: 0,
    });
  });

  it("matches DE", () => {
    expect(scorePoliteness(["bitte mach das", "danke!", "Entschuldigung"])).toEqual({
      please: 1,
      thanks: 1,
      sorry: 1,
    });
  });

  it("respects word boundaries (no false positives in identifiers)", () => {
    expect(scorePoliteness(["thanks-test.ts uses handleSorry()"])).toEqual({
      please: 0,
      thanks: 1, // thanks-test still matches "thanks" — that's actually OK by spec, word-boundary on hyphen
      sorry: 0,  // handleSorry has no boundary before "Sorry"
    });
  });

  it("ignores empty/null inputs", () => {
    expect(scorePoliteness([])).toEqual({ please: 0, thanks: 0, sorry: 0 });
    expect(scorePoliteness(["", ""])).toEqual({ please: 0, thanks: 0, sorry: 0 });
  });

  it("end-to-end via extractClaudePersonality", async () => {
    const path = await makeFixture([
      userEvent("2026-01-01T00:00:00Z", "please add a feature"),
      userEvent("2026-01-01T00:01:00Z", "thanks!"),
      userEvent("2026-01-01T00:02:00Z", "sorry, one more thing"),
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.politenessPlease).toBe(1);
    expect(p.politenessThanks).toBe(1);
    expect(p.politenessSorry).toBe(1);
  });
});

describe("cost per line", () => {
  it("returns 0 when net lines <= 0", () => {
    expect(computeCostPerLine(10, 0, 0)).toBe(0);
    expect(computeCostPerLine(10, 5, 5)).toBe(0);
    expect(computeCostPerLine(10, 1, 5)).toBe(0);
  });

  it("computes USD per net line", () => {
    expect(computeCostPerLine(10, 100, 0)).toBe(0.1);
    expect(computeCostPerLine(20, 200, 100)).toBe(0.2);
  });

  it("returns 0 with zero cost", () => {
    expect(computeCostPerLine(0, 100, 0)).toBe(0);
  });
});

function assistantEvent(ts: string, stopReason: string) {
  return {
    type: "assistant",
    timestamp: ts,
    message: {
      id: `msg_${ts}`,
      model: "claude-opus-4-7",
      content: [{ type: "text", text: "ok" }],
      stop_reason: stopReason,
      usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0 },
    },
    requestId: `req_${ts}`,
  };
}

describe("wait-then-go count", () => {
  it("does not count when assistant ended cleanly", async () => {
    const path = await makeFixture([
      userEvent("2026-01-01T00:00:00Z", "first"),
      assistantEvent("2026-01-01T00:00:05Z", "end_turn"),
      userEvent("2026-01-01T00:01:00Z", "second"),
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.waitThenGoCount).toBe(0);
  });

  it("counts when user prompts arrive while assistant is in tool_use mode", async () => {
    const path = await makeFixture([
      userEvent("2026-01-01T00:00:00Z", "first"),
      assistantEvent("2026-01-01T00:00:05Z", "tool_use"),
      // user fires a new prompt while assistant is still working
      userEvent("2026-01-01T00:00:10Z", "stop, do this instead"),
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.waitThenGoCount).toBe(1);
  });

  it("does not count after an ESC interrupt", async () => {
    const path = await makeFixture([
      userEvent("2026-01-01T00:00:00Z", "first"),
      assistantEvent("2026-01-01T00:00:05Z", "tool_use"),
      // tool_result wrapper with interrupted=true
      {
        type: "user",
        timestamp: "2026-01-01T00:00:08Z",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "x", content: "" }],
        },
        toolUseResult: { interrupted: true },
      },
      userEvent("2026-01-01T00:00:10Z", "different request"),
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.waitThenGoCount).toBe(0);
    expect(p.escInterrupts).toBe(1);
  });

  it("compact_boundary clears in-flight state", async () => {
    const path = await makeFixture([
      userEvent("2026-01-01T00:00:00Z", "first"),
      assistantEvent("2026-01-01T00:00:05Z", "tool_use"),
      { type: "system", subtype: "compact_boundary", timestamp: "2026-01-01T00:00:08Z" },
      userEvent("2026-01-01T00:00:10Z", "after compact"),
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.waitThenGoCount).toBe(0);
  });
});

describe("rate-limit hits", () => {
  it("counts api_error events with HTTP status 429", async () => {
    const path = await makeFixture([
      {
        type: "system",
        subtype: "api_error",
        timestamp: "2026-01-01T00:00:00Z",
        error: { status: 429 },
        retryInMs: 5000,
      },
      {
        type: "system",
        subtype: "api_error",
        timestamp: "2026-01-01T00:01:00Z",
        error: { status: 429 },
        retryInMs: 3000,
      },
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.rateLimitHits).toBe(2);
    expect(p.rateLimitWaitMs).toBe(8000);
  });

  it("counts deeply-nested rate_limit_error type as fallback", async () => {
    const path = await makeFixture([
      {
        type: "system",
        subtype: "api_error",
        timestamp: "2026-01-01T00:00:00Z",
        error: { error: { error: { type: "rate_limit_error" } } },
        retryInMs: 1000,
      },
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.rateLimitHits).toBe(1);
    expect(p.rateLimitWaitMs).toBe(1000);
  });

  it("ignores non-429 api_error events", async () => {
    const path = await makeFixture([
      {
        type: "system",
        subtype: "api_error",
        timestamp: "2026-01-01T00:00:00Z",
        error: { status: 500 },
      },
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.rateLimitHits).toBe(0);
  });

  it("handles missing retryInMs gracefully", async () => {
    const path = await makeFixture([
      {
        type: "system",
        subtype: "api_error",
        timestamp: "2026-01-01T00:00:00Z",
        error: { status: 429 },
        // no retryInMs
      },
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.rateLimitHits).toBe(1);
    expect(p.rateLimitWaitMs).toBe(0);
  });
});

describe("burn rate peak", () => {
  it("returns 0 with no events", () => {
    expect(computeBurnRatePeak([])).toEqual({ tpm: 0, windowStartUtc: null });
  });

  it("returns the single event's tokens for one event", () => {
    const t = Date.parse("2026-01-01T00:00:00Z");
    const r = computeBurnRatePeak([{ ts: t, tokens: 500 }]);
    expect(r.tpm).toBe(500);
    expect(r.windowStartUtc).toBe("2026-01-01T00:00:00.000Z");
  });

  it("sums events that fit within a 60s window", () => {
    const t0 = Date.parse("2026-01-01T00:00:00Z");
    const r = computeBurnRatePeak([
      { ts: t0, tokens: 100 },
      { ts: t0 + 30_000, tokens: 200 },
      { ts: t0 + 50_000, tokens: 300 },
    ]);
    expect(r.tpm).toBe(600);
  });

  it("excludes events outside the window", () => {
    const t0 = Date.parse("2026-01-01T00:00:00Z");
    const r = computeBurnRatePeak([
      { ts: t0, tokens: 100 },
      { ts: t0 + 60_001, tokens: 999 },
    ]);
    expect(r.tpm).toBe(999); // peak shifted to second event alone
  });

  it("identifies the highest peak across multiple windows", () => {
    const t0 = Date.parse("2026-01-01T00:00:00Z");
    const r = computeBurnRatePeak([
      { ts: t0, tokens: 100 },
      { ts: t0 + 10_000, tokens: 100 },
      // gap
      { ts: t0 + 200_000, tokens: 1000 }, // big single event
      { ts: t0 + 210_000, tokens: 500 },
    ]);
    expect(r.tpm).toBe(1500);
  });

  it("handles unsorted input", () => {
    const t0 = Date.parse("2026-01-01T00:00:00Z");
    const r = computeBurnRatePeak([
      { ts: t0 + 50_000, tokens: 200 },
      { ts: t0, tokens: 100 },
    ]);
    expect(r.tpm).toBe(300);
  });
});

function feat(over: Partial<ArchetypeFeatures> = {}): ArchetypeFeatures {
  return {
    promptCount: 10,
    avgPromptChars: 100,
    promptsWithPath: 0,
    promptsWithCodeBlock: 0,
    promptsWithBugKeyword: 0,
    toolTotal: 50,
    readishTools: 10,
    editTools: 10,
    bashTools: 5,
    longestSoloMs: 0,
    durationMs: 600_000,
    escInterrupts: 0,
    rateLimitHits: 0,
    startHourLocal: 14, // afternoon — neutral
    ...over,
  };
}

describe("archetype scoring", () => {
  it("picks vibe-coder for empty/tiny session", () => {
    const f = feat({ promptCount: 0, toolTotal: 0 });
    const scores = scoreAllArchetypes(f);
    expect(pickArchetype(scores)).toBe("vibe-coder");
  });

  it("identifies the Specifier (long prompts, paths)", () => {
    const f = feat({ avgPromptChars: 500, promptsWithPath: 8 });
    const scores = scoreAllArchetypes(f);
    expect(scores.specifier).toBeGreaterThan(0.5);
    expect(pickArchetype(scores)).toBe("specifier");
  });

  it("identifies the Vibe-Coder (very short prompts, no code)", () => {
    const f = feat({ avgPromptChars: 25, promptsWithCodeBlock: 0 });
    const scores = scoreAllArchetypes(f);
    expect(scores["vibe-coder"]).toBeGreaterThan(0.5);
  });

  it("identifies the Fixer (bug keywords in prompts)", () => {
    const f = feat({ promptsWithBugKeyword: 7, promptCount: 10 });
    const scores = scoreAllArchetypes(f);
    expect(scores.fixer).toBeGreaterThan(0.5);
  });

  it("identifies the Researcher (read-heavy, edit-light)", () => {
    const f = feat({ readishTools: 40, editTools: 2, toolTotal: 50 });
    const scores = scoreAllArchetypes(f);
    expect(scores.researcher).toBeGreaterThan(0.4);
  });

  it("identifies the Firefighter (rate limits + escs)", () => {
    const f = feat({ rateLimitHits: 5, escInterrupts: 10 });
    const scores = scoreAllArchetypes(f);
    expect(scores.firefighter).toBeGreaterThan(0.5);
  });

  it("identifies the Trustfall Pilot (long solo + low intervention)", () => {
    const f = feat({ longestSoloMs: 10 * 60_000, promptCount: 3, durationMs: 1800_000 });
    const scores = scoreAllArchetypes(f);
    expect(scores["trustfall-pilot"]).toBeGreaterThan(0.5);
  });

  it("identifies the ESC-Rager", () => {
    const f = feat({ escInterrupts: 6, promptCount: 10 });
    const scores = scoreAllArchetypes(f);
    expect(scores["esc-rager"]).toBeGreaterThan(0.5);
  });

  it("identifies the Night Owl (start hour 02:00)", () => {
    const f = feat({ startHourLocal: 2 });
    const scores = scoreAllArchetypes(f);
    expect(scores["night-owl"]).toBe(1);
  });

  it("does NOT classify as Night Owl at 14:00", () => {
    const f = feat({ startHourLocal: 14 });
    const scores = scoreAllArchetypes(f);
    expect(scores["night-owl"]).toBe(0);
  });

  it("PRIORITY tie-break — fixer > researcher when both perfect", () => {
    // construct artificial tie at score=1 for fixer + researcher
    const scores = {
      specifier: 0,
      "vibe-coder": 0,
      fixer: 1,
      researcher: 1,
      firefighter: 0,
      "trustfall-pilot": 0,
      "esc-rager": 0,
      "night-owl": 0,
    } as const;
    expect(pickArchetype(scores)).toBe("fixer");
  });
});

function makeReceipt(over: Partial<Receipt> = {}): Receipt {
  const base: Receipt = {
    scope: { kind: "single", sessionId: "x" },
    generatedAt: "2026-05-02T12:00:00Z",
    meta: { project: "p", branch: null, sources: ["claude"], sessionCount: 1 },
    time: {
      startUtc: "2026-05-02T12:00:00Z",
      endUtc: "2026-05-02T13:00:00Z",
      durationMs: 3600_000,
      activeMs: 1800_000,
      afkMs: 1800_000,
      afkRecaps: [],
      longestSoloStretchMs: 0,
      longestSoloStretchStartUtc: null,
      longestSoloStretchEndUtc: null,
    },
    cost: {
      totalUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
      cacheHitRatio: 0,
      models: [],
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
    tools: { total: 0, top: [] },
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

describe("achievement badges", () => {
  it("returns [] for an empty session", () => {
    const r = makeReceipt({
      time: {
        ...makeReceipt().time,
        startUtc: "2026-05-02T14:00:00Z", // afternoon
      },
    });
    expect(deriveAchievements(r)).toEqual([]);
  });

  it("triggers token-millionaire at >= 1M tokens", () => {
    const r = makeReceipt({
      cost: { ...makeReceipt().cost, inputTokens: 600_000, outputTokens: 500_000 },
      time: { ...makeReceipt().time, startUtc: "2026-05-02T14:00:00Z" },
    });
    const a = deriveAchievements(r);
    expect(a[0]?.key).toBe("token-millionaire");
  });

  it("caps at 3 badges (rarest first)", () => {
    const r = makeReceipt({
      cost: {
        ...makeReceipt().cost,
        inputTokens: 600_000,
        outputTokens: 500_000,
        totalUsd: 50, // big-spender
      },
      time: {
        ...makeReceipt().time,
        durationMs: 4 * 3600_000, // marathoner
        startUtc: "2026-05-02T22:00:00Z", // night-owl too
      },
      personality: {
        ...makeReceipt().personality,
        politenessScore: { please: 5, thanks: 5, sorry: 0, total: 10 }, // polite
      },
    });
    const a = deriveAchievements(r);
    expect(a.length).toBe(3);
    // rarest first — token-millionaire ahead of marathoner ahead of night-owl
    expect(a[0]?.key).toBe("token-millionaire");
    expect(a.map((x) => x.key)).toContain("big-spender");
    expect(a.map((x) => x.key)).toContain("marathoner");
    // polite shouldn't make the cut at 3
    expect(a.map((x) => x.key)).not.toContain("polite");
  });

  it("triggers night-owl for 02:00 start", () => {
    const r = makeReceipt({
      time: { ...makeReceipt().time, startUtc: "2026-05-02T02:30:00Z" },
    });
    const a = deriveAchievements(r);
    expect(a.map((x) => x.key)).toContain("night-owl");
  });

  it("triggers no-error-streak ONLY when zero rate-limits, zero ESCs, >30min, and engagement", () => {
    const r = makeReceipt({
      time: { ...makeReceipt().time, durationMs: 45 * 60_000, startUtc: "2026-05-02T14:00:00Z" },
      tools: { total: 5, top: [] },
    });
    const a = deriveAchievements(r);
    expect(a.map((x) => x.key)).toContain("no-error-streak");

    const r2 = makeReceipt({
      time: { ...makeReceipt().time, durationMs: 45 * 60_000, startUtc: "2026-05-02T14:00:00Z" },
      tools: { total: 5, top: [] },
      cost: { ...makeReceipt().cost, rateLimitHits: 1 },
    });
    expect(deriveAchievements(r2).map((x) => x.key)).not.toContain("no-error-streak");
  });
});

describe("most-edited file", () => {
  it("returns null on empty list", () => {
    expect(computeMostEditedFile([])).toBeNull();
  });

  it("returns null when all files have <=1 edit", () => {
    expect(
      computeMostEditedFile([
        { path: "a.ts", added: 5, removed: 0, editCount: 1 },
        { path: "b.ts", added: 3, removed: 0, editCount: 1 },
      ]),
    ).toBeNull();
  });

  it("returns null when max is 2 (threshold is >=3)", () => {
    expect(
      computeMostEditedFile([
        { path: "a.ts", added: 50, removed: 0, editCount: 2 },
        { path: "b.ts", added: 5, removed: 0, editCount: 1 },
      ]),
    ).toBeNull();
  });

  it("picks the file with the highest editCount", () => {
    const out = computeMostEditedFile([
      { path: "a.ts", added: 100, removed: 5, editCount: 2 },
      { path: "b.ts", added: 10, removed: 0, editCount: 9 },
      { path: "c.ts", added: 3, removed: 0, editCount: 1 },
    ]);
    expect(out).not.toBeNull();
    expect(out!.path).toBe("b.ts");
    expect(out!.editCount).toBe(9);
    expect(out!.added).toBe(10);
  });

  it("treats missing editCount as 1 (legacy)", () => {
    expect(
      computeMostEditedFile([
        { path: "a.ts", added: 5, removed: 0 },
        { path: "b.ts", added: 5, removed: 0 },
      ]),
    ).toBeNull();
  });
});
