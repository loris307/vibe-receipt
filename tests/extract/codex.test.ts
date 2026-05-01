import { describe, expect, it } from "vitest";
import { extractCodexPersonality } from "../../src/extract/personality/codex-jsonl.js";
import { loadCodexFromFile } from "../../src/extract/codex.js";
import { resolve } from "node:path";

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
