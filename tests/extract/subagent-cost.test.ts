import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadClaudeFromFile } from "../../src/extract/claude.js";

const PARENT = resolve(__dirname, "../fixtures/claude/parent-with-subagent.jsonl");

describe("Claude subagent cost (fix #5)", () => {
  it("sums subagent transcript tokens AND cost (not parent-only)", async () => {
    const ns = await loadClaudeFromFile(PARENT);
    // Parent: 1M Sonnet input. Subagent: 1M Sonnet input. Both at $3/MTok.
    expect(ns.inputTokens).toBe(2_000_000);
    // ccusage may or may not return data for synthetic IDs. Either way,
    // subagent cost (~$3) must be added on top of parent cost.
    expect(ns.totalCostUsd).toBeGreaterThan(5.5);
    expect(ns.totalCostUsd).toBeLessThan(6.5);
  });
});
