import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getContextWindow } from "../../src/extract/claude-context-windows.js";
import { extractClaudePersonality } from "../../src/extract/personality/claude-jsonl.js";

async function makeFixture(events: unknown[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vibe-receipt-test-"));
  const path = join(dir, "session.jsonl");
  await writeFile(path, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
  return path;
}

function assistantEvent(ts: string, model: string, opts: { stopReason?: string } = {}) {
  return {
    type: "assistant",
    sessionId: "sess-test",
    timestamp: ts,
    cwd: "/tmp/proj",
    requestId: `req-${ts}`,
    message: {
      id: `msg-${ts}`,
      role: "assistant",
      model,
      stop_reason: opts.stopReason ?? "end_turn",
      content: [{ type: "text", text: "ok" }],
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  };
}

function compactBoundary(
  ts: string,
  uuid: string | null,
  preTokens: number | null,
  trigger = "manual",
) {
  const evt: any = {
    type: "system",
    subtype: "compact_boundary",
    timestamp: ts,
    isSidechain: false,
  };
  if (uuid !== null) evt.uuid = uuid;
  if (preTokens !== null) {
    evt.compactMetadata = { trigger, preTokens, postTokens: 1000, durationMs: 100 };
  } else {
    // event without compactMetadata at all
    evt.compactMetadata = undefined;
  }
  return evt;
}

describe("v0.3 — context window lookup", () => {
  it("returns 200k for opus-4-7", () => {
    expect(getContextWindow("claude-opus-4-7")).toBe(200_000);
  });
  it("returns 1M for [1m] suffix variant", () => {
    expect(getContextWindow("claude-opus-4-7[1m]")).toBe(1_000_000);
    expect(getContextWindow("claude-sonnet-4-6[1m]")).toBe(1_000_000);
  });
  it("falls back via family prefix", () => {
    expect(getContextWindow("claude-opus-future-model")).toBe(200_000);
    expect(getContextWindow("claude-sonnet-x")).toBe(200_000);
  });
  it("conservative 200k fallback for unknown", () => {
    expect(getContextWindow("gpt-5")).toBe(200_000);
    expect(getContextWindow("")).toBe(200_000);
  });
});

describe("v0.3 — compaction extraction", () => {
  it("session without compactions → all defaults", async () => {
    const path = await makeFixture([assistantEvent("2026-01-01T00:00:00Z", "claude-opus-4-7")]);
    const p = await extractClaudePersonality(path);
    expect(p.compactionCount).toBe(0);
    expect(p.firstCompactPreTokens).toBe(null);
    expect(p.firstCompactContextPct).toBe(null);
  });

  it("1 compaction with preTokens=100k and opus-4-7 → count=1, pct≈0.5", async () => {
    const path = await makeFixture([
      assistantEvent("2026-01-01T00:00:00Z", "claude-opus-4-7"),
      compactBoundary("2026-01-01T00:01:00Z", "uuid-1", 100_000),
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.compactionCount).toBe(1);
    expect(p.firstCompactPreTokens).toBe(100_000);
    expect(p.firstCompactContextPct).toBe(0.5);
  });

  it("2 compactions → count=2, first one wins (preTokens captured from earliest)", async () => {
    const path = await makeFixture([
      assistantEvent("2026-01-01T00:00:00Z", "claude-opus-4-7"),
      compactBoundary("2026-01-01T00:01:00Z", "uuid-1", 50_000),
      assistantEvent("2026-01-01T00:02:00Z", "claude-opus-4-7"),
      compactBoundary("2026-01-01T00:03:00Z", "uuid-2", 150_000),
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.compactionCount).toBe(2);
    expect(p.firstCompactPreTokens).toBe(50_000);
    expect(p.firstCompactContextPct).toBe(0.25);
  });

  it("compaction event without compactMetadata → count=1, pct=null", async () => {
    const path = await makeFixture([
      assistantEvent("2026-01-01T00:00:00Z", "claude-opus-4-7"),
      compactBoundary("2026-01-01T00:01:00Z", "uuid-1", null),
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.compactionCount).toBe(1);
    expect(p.firstCompactPreTokens).toBe(null);
    expect(p.firstCompactContextPct).toBe(null);
  });

  it("compaction without uuid still counts (no silent undercount)", async () => {
    const path = await makeFixture([
      assistantEvent("2026-01-01T00:00:00Z", "claude-opus-4-7"),
      compactBoundary("2026-01-01T00:01:00Z", null, 80_000),
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.compactionCount).toBe(1);
    expect(p.firstCompactPreTokens).toBe(80_000);
  });

  it("duplicate uuid → counted only once (stream-replay defense)", async () => {
    const path = await makeFixture([
      assistantEvent("2026-01-01T00:00:00Z", "claude-opus-4-7"),
      compactBoundary("2026-01-01T00:01:00Z", "uuid-dup", 100_000),
      compactBoundary("2026-01-01T00:02:00Z", "uuid-dup", 200_000),
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.compactionCount).toBe(1);
    expect(p.firstCompactPreTokens).toBe(100_000);
  });

  it("preTokens > context window → pct clamped to 1.0", async () => {
    const path = await makeFixture([
      assistantEvent("2026-01-01T00:00:00Z", "claude-opus-4-7"),
      compactBoundary("2026-01-01T00:01:00Z", "uuid-1", 659_432),
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.compactionCount).toBe(1);
    expect(p.firstCompactPreTokens).toBe(659_432);
    expect(p.firstCompactContextPct).toBe(1);
  });

  it("uses last-seen assistant model at time of first compact", async () => {
    // Mid-session model switch: opus → opus-4-7[1m]; compaction lands while 1M model active
    const path = await makeFixture([
      assistantEvent("2026-01-01T00:00:00Z", "claude-opus-4-7"),
      assistantEvent("2026-01-01T00:01:00Z", "claude-opus-4-7[1m]"),
      compactBoundary("2026-01-01T00:02:00Z", "uuid-1", 500_000),
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.compactionCount).toBe(1);
    expect(p.firstCompactPreTokens).toBe(500_000);
    // 500k / 1M = 0.5
    expect(p.firstCompactContextPct).toBe(0.5);
  });
});
