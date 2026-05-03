import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSingleReceipt } from "../../src/aggregate/single.js";
import { loadClaudeFromFile } from "../../src/extract/claude.js";
import { applyRedaction, parseRevealFlag, withRawPrompt } from "../../src/redact/smart-redact.js";

const SHORT = resolve(__dirname, "../fixtures/claude/short-session.jsonl");

describe("parseRevealFlag", () => {
  it("returns NO_REVEAL on empty/undefined input", () => {
    expect(parseRevealFlag(undefined)).toEqual({ paths: false, prompt: false, bash: false });
    expect(parseRevealFlag("")).toEqual({ paths: false, prompt: false, bash: false });
  });
  it("parses comma-separated tokens", () => {
    expect(parseRevealFlag("paths,prompt")).toEqual({
      paths: true,
      prompt: true,
      bash: false,
    });
  });
  it("parses 'all' as all-true", () => {
    expect(parseRevealFlag("all")).toEqual({ paths: true, prompt: true, bash: true });
  });
});

describe("applyRedaction (default = redact everything)", () => {
  it("redacts file paths to basename", async () => {
    const ns = await loadClaudeFromFile(SHORT);
    const r = applyRedaction(buildSingleReceipt(ns));
    for (const f of r.work.topFiles) {
      expect(f.path.includes("/")).toBe(false);
    }
  });

  it("redacts branch to prefix", async () => {
    const ns = { ...(await loadClaudeFromFile(SHORT)), branch: "feature/foo-bar" };
    const r = applyRedaction(buildSingleReceipt(ns));
    expect(r.meta.branch).toBe("feature/…");
  });

  it("hides afk recaps text", async () => {
    const ns = await loadClaudeFromFile(SHORT);
    const r = applyRedaction(buildSingleReceipt(ns));
    if (r.time.afkRecaps.length > 0) {
      for (const recap of r.time.afkRecaps) {
        expect(recap).toBe("<recap hidden>");
      }
    }
  });

  it("does not reveal first prompt text", async () => {
    const ns = await loadClaudeFromFile(SHORT);
    const r0 = withRawPrompt(buildSingleReceipt(ns), ns.firstPrompt);
    const r = applyRedaction(r0);
    expect(r.firstPrompt.revealed).toBe(null);
    expect(r.firstPrompt.fingerprintSha).toMatch(/^[0-9a-f]{6}$/);
    expect(r.firstPrompt.wordCount).toBeGreaterThan(0);
  });

  it("hides firstPrompt.preview by default", async () => {
    const ns = await loadClaudeFromFile(SHORT);
    const r = applyRedaction(buildSingleReceipt(ns));
    expect(r.firstPrompt.preview).toBe(null);
    expect(r.firstPrompt.fingerprintSha).toMatch(/^[0-9a-f]{6}$/);
  });

  it("hides personality.shortestPromptText by default", async () => {
    const ns = await loadClaudeFromFile(SHORT);
    const r = applyRedaction(buildSingleReceipt(ns));
    expect(r.personality.shortestPromptText).toBe(null);
  });

  it("reveal=prompt surfaces firstPrompt.preview", async () => {
    const ns = await loadClaudeFromFile(SHORT);
    const r = applyRedaction(buildSingleReceipt(ns), parseRevealFlag("prompt"));
    expect(r.firstPrompt.preview).toBeTruthy();
  });

  it("reveal=prompt surfaces shortestPromptText", async () => {
    const ns = await loadClaudeFromFile(SHORT);
    const r = applyRedaction(buildSingleReceipt(ns), parseRevealFlag("prompt"));
    if (ns.shortestPromptText !== null) {
      expect(r.personality.shortestPromptText).toBe(ns.shortestPromptText);
    }
  });
});

describe("applyRedaction with reveal opts", () => {
  it("reveal=paths preserves full path", async () => {
    const ns = await loadClaudeFromFile(SHORT);
    const r = applyRedaction(buildSingleReceipt(ns), parseRevealFlag("paths"));
    const hasFullPath = r.work.topFiles.some((f) => f.path.includes("/"));
    expect(hasFullPath).toBe(true);
  });

  it("reveal=prompt surfaces revealed text (truncated)", async () => {
    const ns = await loadClaudeFromFile(SHORT);
    const r0 = withRawPrompt(buildSingleReceipt(ns), ns.firstPrompt);
    const r = applyRedaction(r0, parseRevealFlag("prompt"));
    expect(r.firstPrompt.revealed).toBeTruthy();
    expect(r.firstPrompt.revealed!.length).toBeLessThanOrEqual(201);
  });
});
