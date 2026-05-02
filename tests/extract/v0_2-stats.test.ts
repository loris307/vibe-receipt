import { describe, expect, it } from "vitest";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractClaudePersonality } from "../../src/extract/personality/claude-jsonl.js";
import { scorePoliteness } from "../../src/extract/politeness.js";
import { computeCostPerLine, computeMostEditedFile } from "../../src/aggregate/derive-stats.js";

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
