import { basename, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCombinedReceipt } from "../../src/aggregate/combine.js";
import { pickMostRecent } from "../../src/aggregate/pick-most-recent.js";
import { buildSingleReceipt } from "../../src/aggregate/single.js";
import { loadClaudeFromFile } from "../../src/extract/claude.js";
import { loadCodexFromFile } from "../../src/extract/codex.js";
import { applyRedaction } from "../../src/redact/smart-redact.js";

const SHORT = resolve(__dirname, "../fixtures/claude/short-session.jsonl");
const MULTI = resolve(__dirname, "../fixtures/claude/multi-model.jsonl");
const CODEX = resolve(__dirname, "../fixtures/codex/standard-session.jsonl");

describe("buildSingleReceipt", () => {
  it("produces a valid Receipt for a Claude session", async () => {
    const ns = await loadClaudeFromFile(SHORT);
    const r = buildSingleReceipt(ns);
    expect(r.scope.kind).toBe("single");
    expect(r.meta.sources).toEqual(["claude"]);
    expect(r.meta.sessionCount).toBe(1);
    // buildSingleReceipt holds the full cwd; smart-redact basenames it for default privacy.
    expect(basename(r.meta.project)).toBe("demo");
    expect(applyRedaction(r).meta.project).toBe("demo");
    expect(r.meta.branch).toBe("main");
    expect(r.tools.total).toBeGreaterThan(0);
    expect(r.firstPrompt.wordCount).toBeGreaterThan(5);
    expect(r.firstPrompt.fingerprintSha).toMatch(/^[0-9a-f]{6}$/);
  });

  it("produces a valid Receipt for a Codex session", async () => {
    const ns = await loadCodexFromFile(CODEX);
    const r = buildSingleReceipt(ns);
    expect(r.meta.sources).toEqual(["codex"]);
    expect(r.cost.totalUsd).toBeGreaterThan(0);
  });
});

describe("buildCombinedReceipt", () => {
  it("merges Claude + Codex into a multi-source receipt", async () => {
    const claude = await loadClaudeFromFile(SHORT);
    const codex = await loadCodexFromFile(CODEX);
    const r = buildCombinedReceipt([claude, codex], { kind: "combine-since", since: "PT1H" });
    expect(r.meta.sessionCount).toBe(2);
    expect(r.meta.sources.sort()).toEqual(["claude", "codex"]);
    // Wall-clock window > sum of any single
    expect(r.time.durationMs).toBeGreaterThan(0);
    // active is SUM (per spec): claude active + codex active
    expect(r.time.activeMs).toBeGreaterThanOrEqual(claude.activeMs + codex.activeMs);
  });

  it("preserves earliest firstPrompt across sessions", async () => {
    const claude = await loadClaudeFromFile(SHORT);
    const codex = await loadCodexFromFile(CODEX);
    // Codex starts at 18:00, Claude at 20:00 — codex first
    const r = buildCombinedReceipt([claude, codex], { kind: "combine-since", since: "PT4H" });
    expect(r.firstPrompt.charCount).toBeGreaterThan(0);
  });

  it("merges multiple Claude sessions and counts files once per path", async () => {
    const a = await loadClaudeFromFile(SHORT);
    const b = await loadClaudeFromFile(SHORT); // same file twice
    const r = buildCombinedReceipt([a, b], { kind: "combine-since", since: "PT1H" });
    // Same file path → single entry but double counts in lines added
    expect(r.work.filesTouched).toBe(1);
    expect(r.work.linesAdded).toBe(a.linesAdded + b.linesAdded);
  });
});

describe("pickMostRecent", () => {
  it("returns the session with the latest endUtc", async () => {
    const a = await loadClaudeFromFile(SHORT); // 20:01:35
    const b = await loadClaudeFromFile(MULTI); // 19:00:06
    const winner = pickMostRecent([a, b]);
    expect(winner?.sessionId).toBe(a.sessionId);
  });

  it("filters by source", async () => {
    const a = await loadClaudeFromFile(SHORT);
    const c = await loadCodexFromFile(CODEX);
    expect(pickMostRecent([a, c], "codex")?.source).toBe("codex");
    expect(pickMostRecent([a, c], "claude")?.source).toBe("claude");
  });
});
