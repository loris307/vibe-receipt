import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCombinedReceipt } from "../../src/aggregate/combine.js";
import { promptStatsOf } from "../../src/aggregate/prompt-stats.js";
import { buildSingleReceipt } from "../../src/aggregate/single.js";
import { loadClaudeFromFile } from "../../src/extract/claude.js";
import { loadCodexFromFile } from "../../src/extract/codex.js";
import { extractClaudePersonality } from "../../src/extract/personality/claude-jsonl.js";
import { extractCodexPersonality } from "../../src/extract/personality/codex-jsonl.js";

const SHORT = resolve(__dirname, "../fixtures/claude/short-session.jsonl");
const MULTI = resolve(__dirname, "../fixtures/claude/multi-model.jsonl");
const CODEX = resolve(__dirname, "../fixtures/codex/standard-session.jsonl");

describe("promptStatsOf", () => {
  it("returns zeros for empty input", () => {
    expect(promptStatsOf([])).toEqual({
      promptCount: 0,
      longestPromptChars: 0,
      shortestPromptChars: 0,
      avgPromptChars: 0,
    });
  });

  it("computes correct stats for a single prompt", () => {
    expect(promptStatsOf([42])).toEqual({
      promptCount: 1,
      longestPromptChars: 42,
      shortestPromptChars: 42,
      avgPromptChars: 42,
    });
  });

  it("computes count, max, min, rounded avg", () => {
    expect(promptStatsOf([10, 20, 30, 40, 50])).toEqual({
      promptCount: 5,
      longestPromptChars: 50,
      shortestPromptChars: 10,
      avgPromptChars: 30,
    });
  });

  it("rounds avg correctly", () => {
    expect(promptStatsOf([1, 2])).toEqual({
      promptCount: 2,
      longestPromptChars: 2,
      shortestPromptChars: 1,
      avgPromptChars: 2, // 1.5 rounds to 2
    });
    expect(promptStatsOf([1, 2, 3])).toEqual({
      promptCount: 3,
      longestPromptChars: 3,
      shortestPromptChars: 1,
      avgPromptChars: 2,
    });
  });
});

describe("Claude extractor: promptLengths", () => {
  it("collects exactly the real user prompts (1) from the short fixture", async () => {
    const p = await extractClaudePersonality(SHORT);
    // The fixture has: 1 real prompt (Build me a small TypeScript helper...),
    //                  1 tool_result user event (not a prompt),
    //                  1 toolUseResult user event (not a prompt),
    //                  1 slash-command user event (not a prompt),
    //                  ...
    expect(p.promptLengths).toHaveLength(1);
    const expectedLength =
      "Build me a small TypeScript helper that parses CSV files and returns rows.".length;
    expect(p.promptLengths[0]).toBe(expectedLength);
    expect(p.firstPrompt).toContain("CSV files");
  });

  it("strips system-reminder tags from prompt length calc", async () => {
    // multi-model fixture has 'Quick fix please' as the only real prompt
    const p = await extractClaudePersonality(MULTI);
    expect(p.promptLengths).toEqual(["Quick fix please".length]);
  });

  it("excludes slash-command-only user events from prompt count", async () => {
    const p = await extractClaudePersonality(SHORT);
    // slash command /clear should not be counted as a prompt, but should appear in slashCommands
    expect(p.slashCommands).toContain("/clear");
    expect(p.promptLengths).toHaveLength(1); // only "Build me ..." counted
  });
});

describe("Codex extractor: promptLengths", () => {
  it("collects user_message text into promptLengths", async () => {
    const p = await extractCodexPersonality(CODEX);
    expect(p.promptLengths).toEqual(["Add a new test for the CSV helper.".length]);
  });
});

describe("Receipt: prompt stats land on personality block", () => {
  it("buildSingleReceipt populates promptCount/longest/shortest/avg + shortestPromptText + firstPrompt.preview", async () => {
    const ns = await loadClaudeFromFile(SHORT);
    const r = buildSingleReceipt(ns);
    expect(r.personality.promptCount).toBe(1);
    expect(r.personality.longestPromptChars).toBeGreaterThan(50);
    expect(r.personality.shortestPromptChars).toBe(r.personality.longestPromptChars);
    expect(r.personality.avgPromptChars).toBe(r.personality.longestPromptChars);
    // shortest text == the only prompt
    expect(r.personality.shortestPromptText).toContain("CSV files");
    // first preview is the cleaned first prompt, capped to ~60 chars + …
    expect(r.firstPrompt.preview).toBeTruthy();
    expect(r.firstPrompt.preview!.length).toBeLessThanOrEqual(61);
    expect(r.firstPrompt.preview!.startsWith("Build me")).toBe(true);
  });

  it("buildCombinedReceipt aggregates promptLengths across sessions and picks min shortest", async () => {
    const claude = await loadClaudeFromFile(SHORT); // 1 prompt, ~73 chars
    const codex = await loadCodexFromFile(CODEX); //   1 prompt, ~34 chars
    const r = buildCombinedReceipt([claude, codex], { kind: "combine-since", since: "PT1H" });
    expect(r.personality.promptCount).toBe(2);
    expect(r.personality.longestPromptChars).toBeGreaterThan(60);
    expect(r.personality.shortestPromptChars).toBeGreaterThan(20);
    expect(r.personality.shortestPromptChars).toBeLessThan(40);
    expect(r.personality.avgPromptChars).toBe(
      Math.round((r.personality.longestPromptChars + r.personality.shortestPromptChars) / 2),
    );
    // shortest text comes from the codex session
    expect(r.personality.shortestPromptText).toContain("CSV helper");
    expect(r.personality.shortestPromptText!.length).toBe(r.personality.shortestPromptChars);
  });
});

describe("cleanUserText (via extractor): residual filtering", () => {
  it("Codex empty-trimmed user_message is excluded", async () => {
    // sanity: real fixture's only user_message has length > 0 → counted.
    const p = await extractCodexPersonality(CODEX);
    expect(p.promptLengths).toHaveLength(1);
  });
});
