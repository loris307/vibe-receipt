import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCodexFromFile } from "../../src/extract/codex.js";
import { extractCodexPersonality } from "../../src/extract/personality/codex-jsonl.js";

const STD = resolve(__dirname, "../fixtures/codex/standard-session.jsonl");

describe("extractCodexPersonality (standard fixture)", () => {
  it("captures session_meta", async () => {
    const p = await extractCodexPersonality(STD);
    expect(p.sessionId).toBe("019dde3b-743b-7da1-9311-e5394d006449");
    expect(p.cwd).toBe("/Users/test/Desktop/Projekte/codex-demo");
    expect(p.cliVersion).toBe("1.0.0");
  });

  it("captures model from turn_context", async () => {
    const p = await extractCodexPersonality(STD);
    expect(p.models).toContain("gpt-5.3-codex");
  });

  it("computes durations from event timestamps", async () => {
    const p = await extractCodexPersonality(STD);
    // 18:00:00 → 18:00:15 = 15s
    expect(p.durationMs).toBe(15_000);
  });

  it("counts function_call tools and bash", async () => {
    const p = await extractCodexPersonality(STD);
    expect(p.toolCounts.shell).toBe(1);
    expect(p.toolCounts.apply_patch).toBe(1);
    expect(p.bashCommands).toBe(1);
  });

  it("parses apply_patch additions", async () => {
    const p = await extractCodexPersonality(STD);
    expect(p.filesTouched).toContain("src/csv.test.ts");
    expect(p.linesAdded).toBeGreaterThanOrEqual(2);
  });

  it("uses last cumulative token_count", async () => {
    const p = await extractCodexPersonality(STD);
    expect(p.inputTokens).toBe(2000);
    expect(p.cachedInputTokens).toBe(1500);
    expect(p.outputTokens).toBe(300);
    expect(p.reasoningOutputTokens).toBe(80);
  });

  it("captures first user prompt", async () => {
    const p = await extractCodexPersonality(STD);
    expect(p.firstPrompt).toBe("Add a new test for the CSV helper.");
  });
});

describe("loadCodexFromFile", () => {
  it("computes a non-zero cost for the standard model", async () => {
    const ns = await loadCodexFromFile(STD);
    expect(ns.source).toBe("codex");
    expect(ns.totalCostUsd).toBeGreaterThan(0);
    // sanity: cost should be quite small for ~2k input + 380 output
    expect(ns.totalCostUsd).toBeLessThan(0.05);
  });
});

const NEWFMT = resolve(__dirname, "../fixtures/codex/new-format-session.jsonl");

describe("extractCodexPersonality (new Codex shape, v0.128+)", () => {
  it("reads tokens from payload.info.total_token_usage", async () => {
    const p = await extractCodexPersonality(NEWFMT);
    expect(p.inputTokens).toBe(2000);
    expect(p.cachedInputTokens).toBe(1500);
    expect(p.outputTokens).toBe(300);
    expect(p.reasoningOutputTokens).toBe(80);
  });

  it("reads user prompt from event_msg/user_message.message", async () => {
    const p = await extractCodexPersonality(NEWFMT);
    expect(p.firstPrompt).toBe("Add a CSV helper test");
    expect(p.promptLengths.length).toBe(1);
  });

  it("counts exec_command as bash", async () => {
    const p = await extractCodexPersonality(NEWFMT);
    expect(p.toolCounts.exec_command).toBe(1);
    expect(p.bashCommands).toBe(1);
  });

  it("loadCodexFromFile produces non-zero cost for new format", async () => {
    const ns = await loadCodexFromFile(NEWFMT);
    expect(ns.totalCostUsd).toBeGreaterThan(0);
    // Codex JSONL: input_tokens=2000 (gross including cached), cached=1500.
    // Loader normalizes to Claude-style net semantics: inputTokens = 500.
    expect(ns.inputTokens).toBe(500);
    expect(ns.cacheReadTokens).toBe(1500);
    // Sanity: the rendered "tokens" stat (input + output + cacheCreate + cacheRead)
    // must equal the gross 2000 + 380 = 2380 and NOT 3880 (no double-count).
    const displayTotal =
      ns.inputTokens + ns.outputTokens + ns.cacheCreateTokens + ns.cacheReadTokens;
    expect(displayTotal).toBe(2380);
  });
});

const LONG_PRE = resolve(__dirname, "../fixtures/codex/long-session-with-meta-before-window.jsonl");

describe("extractCodexPersonality (window with session_meta predating cutoff)", () => {
  // sinceMs at 14:00 UTC: session_meta is at 10:00 (BEFORE cutoff),
  // but the session continues working into the window with prompts and tools at 19:00.
  const sinceMs = Date.parse("2026-05-01T14:00:00Z");

  it("captures session_meta even when it predates the window", async () => {
    const p = await extractCodexPersonality(LONG_PRE, { sinceMs });
    expect(p.sessionId).toBe("019fffff-aaaa-7bbb-cccc-ddddddddeeee");
    expect(p.cwd).toBe("/Users/test/Projekte/long");
    expect(p.cliVersion).toBe("1.2.3");
    expect(p.models).toContain("gpt-5.5");
  });

  it("attributes only in-window deltas to cumulative token totals", async () => {
    const p = await extractCodexPersonality(LONG_PRE, { sinceMs });
    // Pre-window cumulative: input=100, cached=40, out=50, reason=10
    // End-of-session cumulative: input=300, cached=120, out=150, reason=30
    // Window delta: input=200, cached=80, out=100, reason=20
    expect(p.inputTokens).toBe(200);
    expect(p.cachedInputTokens).toBe(80);
    expect(p.outputTokens).toBe(100);
    expect(p.reasoningOutputTokens).toBe(20);
  });

  it("only counts in-window prompts and bash commands", async () => {
    const p = await extractCodexPersonality(LONG_PRE, { sinceMs });
    expect(p.promptTexts).toEqual(["in-window prompt"]);
    expect(p.bashCommands).toBe(1);
    expect(p.bashCommandsList).toEqual(["ls in-window"]);
  });
});

const APPLY_PATCH_CUSTOM = resolve(__dirname, "../fixtures/codex/apply-patch-custom-tool.jsonl");

describe("extractCodexPersonality (apply_patch as custom_tool_call)", () => {
  it("parses apply_patch from response_item/custom_tool_call.input", async () => {
    const p = await extractCodexPersonality(APPLY_PATCH_CUSTOM);
    expect(p.toolCounts.apply_patch).toBe(1);
    expect(p.filesTouched).toContain("hello.txt");
    expect(p.linesAdded).toBe(2);
    expect(p.linesRemoved).toBe(0);
  });

  it("still counts function_call exec_command alongside custom_tool_call apply_patch", async () => {
    const p = await extractCodexPersonality(APPLY_PATCH_CUSTOM);
    expect(p.toolCounts.exec_command).toBe(1);
    expect(p.bashCommands).toBe(1);
    expect(p.bashCommandsList).toEqual(["wc -l hello.txt"]);
  });
});
