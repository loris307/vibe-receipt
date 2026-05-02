import type { Receipt } from "../data/receipt-schema.js";

export type SizePreset = "portrait" | "story" | "og";

export interface SizeSpec {
  width: number;
  height: number;
  /** Padding overrides for very-narrow OG card. */
  paddingX?: number;
  paddingY?: number;
}

export const SIZES: Record<SizePreset, SizeSpec> = {
  // 1080×1500 — slightly taller than IG-feed 4:5 to fit the full PROMPTING section.
  portrait: { width: 1080, height: 1500 },
  story: { width: 1080, height: 1920 },
  og: { width: 1200, height: 630, paddingX: 48, paddingY: 36 },
};

/**
 * Estimate the rendered receipt height, in px, based on which sections will appear.
 * Used to auto-extend the canvas so we never clip content. Values calibrated against
 * actual rendered cards from real sessions; conservative (over-estimates slightly).
 */
export function estimateReceiptHeight(r: Receipt, base: SizePreset): number {
  if (base === "og") return SIZES.og.height; // OG is fixed/clipped by design
  let h = 270; // masthead + subtitle + date + project line + initial padding

  // SESSION
  h += 60; // section header
  const isMulti = r.meta.sessionCount > 1;
  h += isMulti ? 36 * 3 : 36; // sessions/wall/active OR duration
  h += 36 * 4; // model/tokens/cost/cache
  // v0.2 — conditional rows
  if (r.time.longestSoloStretchMs > 60_000) h += 36;
  if (r.cost.burnRatePeakTokensPerMin > 0) h += 36;
  if (r.cost.rateLimitHits > 0) h += 36;
  if (r.comparison?.vsLastSession) h += 30;
  if (r.comparison?.vsLast7Days) h += 30;
  h += 50; // divider

  // WORK
  h += 60;
  h += 36 * 4;
  if (r.work.webFetches > 0) h += 36;
  if (r.work.mostEditedFile) h += 36;
  if (r.cost.costPerLineUsd > 0) h += 36;
  h += 50;

  // TOP TOOLS
  if (r.tools.top.length > 0) {
    h += 60 + 30 * Math.min(5, r.tools.top.length);
    h += 50;
  }

  // SUBAGENTS (aggregate-stats block: 4 fixed rows)
  if (r.subagents.length > 0) {
    h += 60 + 36 * 4;
    h += 50;
  }

  // PERSONALITY
  let pRows = 0;
  if (r.time.afkMs > 1000) pRows++;
  if (r.personality.escInterrupts > 0) pRows++;
  if (r.personality.permissionFlips > 0) pRows++;
  if (r.personality.thinkingMs > 1000) pRows++;
  if (r.personality.skills.length > 0) pRows++;
  if (r.personality.slashCommands.length > 0) pRows++;
  if (r.personality.waitThenGoCount > 0) pRows++;
  if (r.personality.politenessScore.total > 0) pRows++;
  h += 60 + 36 * pRows;
  h += 50;

  // PROMPTING
  if (r.personality.promptCount > 0) {
    h += 60 + 36 * 3; // header + prompts/longest/avg
    if (r.firstPrompt.preview) {
      // approx 1 line ~36, but long previews wrap to 2 lines
      h += r.firstPrompt.preview.length > 50 ? 80 : 50;
    }
    if (r.personality.shortestPromptText) h += 36;
    h += 36; // mood/sha
    h += 50;
  }

  // BADGES
  if (r.achievements.length > 0) h += 60 + 50; // section + content
  // ARCHETYPE stamp
  h += 100;

  // FOOTER
  h += 100;

  return h;
}

/**
 * Pick a height for the requested preset.
 *  - `portrait` (the default) auto-extends past 1500 if content is heavy.
 *  - `story` extends past 1920 too (v0.2: with archetype + badges + comparisons
 *    the IG-story aspect can no longer always fit fixed 1920; we extend
 *    rather than clip — clipping is worse than aspect drift).
 *  - `og` is FIXED at 1200×630 (clipped — explicit teaser by design).
 */
export function resolveHeight(r: Receipt, base: SizePreset): number {
  if (base === "og") return SIZES.og.height;
  const baseH = SIZES[base].height;
  const estimated = estimateReceiptHeight(r, "portrait");
  return Math.max(baseH, estimated + 40);
}

export function parseSizeFlag(input: string | undefined): SizePreset[] {
  if (!input) return ["portrait"];
  const tokens = input
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.includes("all")) return ["portrait", "story", "og"];
  const out: SizePreset[] = [];
  for (const t of tokens) {
    if (t === "portrait" || t === "story" || t === "og") out.push(t as SizePreset);
  }
  return out.length > 0 ? out : ["portrait"];
}
