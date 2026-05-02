import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearHistory,
  readHistory,
  writeHistoryEntry,
} from "../../src/history/store.js";
import {
  HISTORY_SCHEMA_VERSION,
  type SessionHistoryEntry,
} from "../../src/history/types.js";

function entry(over: Partial<SessionHistoryEntry> = {}): SessionHistoryEntry {
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    recordedAt: "2026-01-01T00:00:00Z",
    sessionId: "sess-1",
    source: "claude",
    project: "demo",
    branch: null,
    startUtc: "2026-01-01T00:00:00Z",
    endUtc: "2026-01-01T01:00:00Z",
    durationMs: 3600_000,
    activeMs: 1800_000,
    totalUsd: 1.23,
    inputTokens: 100,
    outputTokens: 200,
    cacheCreateTokens: 50,
    cacheReadTokens: 1000,
    totalTokens: 350,
    filesTouched: 3,
    linesAdded: 100,
    linesRemoved: 5,
    toolCount: 12,
    promptCount: 4,
    archetype: null,
    models: ["claude-opus-4-7"],
    ...over,
  };
}

async function tempPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vrh-"));
  return join(dir, "history.jsonl");
}

describe("history store", () => {
  it("readHistory returns [] for missing file", async () => {
    const p = await tempPath();
    expect(readHistory(p)).toEqual([]);
  });

  it("appends a new entry", async () => {
    const p = await tempPath();
    writeHistoryEntry(entry({ sessionId: "a" }), p);
    writeHistoryEntry(entry({ sessionId: "b" }), p);
    const all = readHistory(p);
    expect(all.map((e) => e.sessionId)).toEqual(["a", "b"]);
  });

  it("idempotently replaces an existing entry by (sessionId, source)", async () => {
    const p = await tempPath();
    writeHistoryEntry(entry({ sessionId: "a", totalUsd: 1.0 }), p);
    writeHistoryEntry(entry({ sessionId: "a", totalUsd: 2.5 }), p); // overwrite
    const all = readHistory(p);
    expect(all.length).toBe(1);
    expect(all[0]!.totalUsd).toBe(2.5);
  });

  it("treats different source as a different key", async () => {
    const p = await tempPath();
    writeHistoryEntry(entry({ sessionId: "x", source: "claude" }), p);
    writeHistoryEntry(entry({ sessionId: "x", source: "codex" }), p);
    const all = readHistory(p);
    expect(all.length).toBe(2);
  });

  it("skips corrupt lines silently", async () => {
    const p = await tempPath();
    writeHistoryEntry(entry({ sessionId: "good" }), p);
    // append corrupt line
    writeFileSync(p, readFileSync(p, "utf8") + "{ this is not json\n");
    const all = readHistory(p);
    expect(all.length).toBe(1);
    expect(all[0]!.sessionId).toBe("good");
  });

  it("clearHistory removes the file", async () => {
    const p = await tempPath();
    writeHistoryEntry(entry(), p);
    expect(existsSync(p)).toBe(true);
    clearHistory(p);
    expect(existsSync(p)).toBe(false);
  });
});
