import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadClaudeFromFile } from "../../src/extract/claude.js";
import { loadCodexFromFile } from "../../src/extract/codex.js";
import { buildSingleReceipt } from "../../src/aggregate/single.js";
import { buildCombinedReceipt } from "../../src/aggregate/combine.js";
import { applyRedaction } from "../../src/redact/smart-redact.js";
import { renderPng } from "../../src/render/png.js";
import { renderAnsi } from "../../src/render/ansi.js";
import { strings } from "../../src/i18n/index.js";

const SHORT = resolve(__dirname, "../fixtures/claude/short-session.jsonl");
const CODEX = resolve(__dirname, "../fixtures/codex/standard-session.jsonl");

const OUT_DIR = resolve(tmpdir(), "vibe-receipt-snapshot-tests");
mkdirSync(OUT_DIR, { recursive: true });

describe("renderPng (real Satori → resvg)", () => {
  it("renders a portrait PNG for a Claude session", async () => {
    const ns = await loadClaudeFromFile(SHORT);
    const r = applyRedaction(buildSingleReceipt(ns));
    const png = await renderPng({ receipt: r, s: strings("en"), size: "portrait" });
    expect(png.length).toBeGreaterThan(5_000);
    // Valid PNG signature
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    writeFileSync(resolve(OUT_DIR, "snap-claude-portrait.png"), png);
  });

  it("renders an OG (1200x630) PNG", async () => {
    const ns = await loadClaudeFromFile(SHORT);
    const r = applyRedaction(buildSingleReceipt(ns));
    const png = await renderPng({ receipt: r, s: strings("en"), size: "og" });
    expect(png.length).toBeGreaterThan(5_000);
    writeFileSync(resolve(OUT_DIR, "snap-claude-og.png"), png);
  });

  it("renders a story (1080x1920) PNG", async () => {
    const ns = await loadClaudeFromFile(SHORT);
    const r = applyRedaction(buildSingleReceipt(ns));
    const png = await renderPng({ receipt: r, s: strings("en"), size: "story" });
    expect(png.length).toBeGreaterThan(5_000);
    writeFileSync(resolve(OUT_DIR, "snap-claude-story.png"), png);
  });

  it("renders DE labels", async () => {
    const ns = await loadClaudeFromFile(SHORT);
    const r = applyRedaction(buildSingleReceipt(ns));
    const png = await renderPng({ receipt: r, s: strings("de"), size: "portrait" });
    expect(png.length).toBeGreaterThan(5_000);
    writeFileSync(resolve(OUT_DIR, "snap-claude-portrait-de.png"), png);
  });

  it("renders a combined Claude + Codex receipt", async () => {
    const c = await loadClaudeFromFile(SHORT);
    const x = await loadCodexFromFile(CODEX);
    const r = applyRedaction(
      buildCombinedReceipt([c, x], { kind: "combine-since", since: "PT1H" }),
    );
    const png = await renderPng({ receipt: r, s: strings("en"), size: "portrait" });
    expect(png.length).toBeGreaterThan(5_000);
    writeFileSync(resolve(OUT_DIR, "snap-combined-portrait.png"), png);
  });
});

describe("renderAnsi", () => {
  it("renders a non-empty ANSI preview", async () => {
    const ns = await loadClaudeFromFile(SHORT);
    const r = applyRedaction(buildSingleReceipt(ns));
    const ansi = renderAnsi(r, strings("en"));
    expect(ansi.length).toBeGreaterThan(200);
    expect(ansi).toContain("VIBE RECEIPT");
    expect(ansi).toContain("SESSION");
  });

  it("renders DE labels in ANSI", async () => {
    const ns = await loadClaudeFromFile(SHORT);
    const r = applyRedaction(buildSingleReceipt(ns));
    const ansi = renderAnsi(r, strings("de"));
    expect(ansi).toContain("VIBE BON");
    expect(ansi).toContain("ARBEIT");
  });
});
