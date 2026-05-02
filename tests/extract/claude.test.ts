import { describe, expect, it } from "vitest";
import { extractClaudePersonality } from "../../src/extract/personality/claude-jsonl.js";
import { loadClaudeFromFile } from "../../src/extract/claude.js";
import { resolve } from "node:path";

const SHORT = resolve(__dirname, "../fixtures/claude/short-session.jsonl");
const MULTI = resolve(__dirname, "../fixtures/claude/multi-model.jsonl");
const EDITS = resolve(__dirname, "../fixtures/claude/file-edits.jsonl");

describe("extractClaudePersonality (short-session fixture)", () => {
  it("captures session metadata", async () => {
    const p = await extractClaudePersonality(SHORT);
    expect(p.sessionId).toBe("sess-aaaa");
    expect(p.cwd).toBe("/Users/test/Desktop/Projekte/demo");
    expect(p.branch).toBe("main");
    expect(p.claudeCodeVersion).toBe("2.1.118");
  });

  it("computes durations and AFK", async () => {
    const p = await extractClaudePersonality(SHORT);
    // 2026-05-01T20:00:00 → 20:01:35  = 95s = 95000ms
    expect(p.durationMs).toBe(95_000);
    // turn_durations: 3500 + 85000 = 88500
    expect(p.activeMs).toBe(88_500);
    expect(p.afkMs).toBe(95_000 - 88_500);
    expect(p.afkRecaps).toEqual(["Worked on CSV parser"]);
  });

  it("counts tool uses with dedup by tool_use.id", async () => {
    const p = await extractClaudePersonality(SHORT);
    expect(p.toolCounts.Write).toBe(1);
    expect(p.toolCounts.Bash).toBe(1);
    expect(p.toolCounts.Edit).toBe(1);
    expect(p.toolCounts.Skill).toBe(1);
    expect(p.toolCounts.Agent).toBe(1);
    expect(p.bashCommands).toBe(1);
  });

  it("captures structuredPatch line deltas", async () => {
    const p = await extractClaudePersonality(SHORT);
    // Write fixture: 1 added line. Edit fixture: 3 added, 1 removed.
    // Total: added = 4, removed = 1
    expect(p.linesAdded).toBe(4);
    expect(p.linesRemoved).toBe(1);
    expect(p.filesTouched).toEqual(["/Users/test/Desktop/Projekte/demo/src/csv.ts"]);
  });

  it("detects ESC interrupts and permission flips", async () => {
    const p = await extractClaudePersonality(SHORT);
    expect(p.escInterrupts).toBe(1);
    expect(p.permissionFlips).toBe(1);
    expect(p.yoloEvents).toBe(1);
  });

  it("captures subagents", async () => {
    const p = await extractClaudePersonality(SHORT);
    expect(p.subagents).toHaveLength(1);
    expect(p.subagents[0]?.type).toBe("Explore");
    expect(p.subagents[0]?.durationMs).toBe(38500);
    expect(p.subagents[0]?.totalTokens).toBe(4200);
    expect(p.subagents[0]?.toolUseCount).toBe(6);
  });

  it("captures skills and slash commands", async () => {
    const p = await extractClaudePersonality(SHORT);
    expect(p.skills).toContain("brainstorming");
    expect(p.slashCommands).toContain("/clear");
  });

  it("captures first prompt and longest user msg", async () => {
    const p = await extractClaudePersonality(SHORT);
    expect(p.firstPrompt).toContain("CSV files");
    expect(p.longestUserMsgChars).toBeGreaterThan(20);
  });

  it("computes thinking time (capped per turn)", async () => {
    const p = await extractClaudePersonality(SHORT);
    // The first assistant event has a thinking block; next event is +1s away.
    // Expected ~1000ms.
    expect(p.thinkingMs).toBeGreaterThanOrEqual(900);
    expect(p.thinkingMs).toBeLessThanOrEqual(1100);
  });
});

describe("loadClaudeFromFile", () => {
  it("normalizes a fixture into NormalizedSession with token fallback", async () => {
    const ns = await loadClaudeFromFile(SHORT);
    expect(ns.source).toBe("claude");
    expect(ns.sessionId).toBe("sess-aaaa");
    // Fallback or ccusage may give us tokens. Either way, expect non-zero input.
    expect(ns.inputTokens).toBeGreaterThan(0);
    expect(ns.outputTokens).toBeGreaterThan(0);
  });
});

describe("multi-model fixture", () => {
  it("collects multiple models in deterministic order", async () => {
    const p = await extractClaudePersonality(MULTI);
    expect(p.models).toContain("claude-haiku-4-5");
    expect(p.models).toContain("claude-sonnet-4-6");
    expect(p.branch).toBe("feature/multi-model");
  });
});

describe("file-edits fixture (Write + Edit, both shapes)", () => {
  it("counts Write/create lines from `content` when structuredPatch is empty", async () => {
    const p = await extractClaudePersonality(EDITS);
    // Write creates new.ts with 4 lines (line1\nline2\nline3\nline4 → 4 lines)
    // Edit then changes line2 → +2/-1
    // Total expected: +4 (write) + 2 (edit add) - 1 (edit remove) = +6/-1
    expect(p.linesAdded).toBe(6);
    expect(p.linesRemoved).toBe(1);
    expect(p.filesTouched).toEqual(["/x/new.ts"]);
  });

  it("recognizes Edit results that have no `type` field (only oldString/newString)", async () => {
    const p = await extractClaudePersonality(EDITS);
    // Both tool calls counted in toolCounts
    expect(p.toolCounts.Write).toBe(1);
    expect(p.toolCounts.Edit).toBe(1);
    // The single file appears in topFiles regardless of result shape
    expect(p.fileEntries).toHaveLength(1);
    expect(p.fileEntries[0]?.path).toBe("/x/new.ts");
    expect(p.fileEntries[0]?.added).toBe(6);
    expect(p.fileEntries[0]?.removed).toBe(1);
  });
});
