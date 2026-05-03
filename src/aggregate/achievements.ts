import type { Achievement, Receipt } from "../data/receipt-schema.js";

interface Rule {
  key: string;
  glyph: string;
  ascii: string;
  trigger: (r: Receipt) => boolean;
}

const TOTAL_TOKENS = (r: Receipt): number =>
  r.cost.inputTokens + r.cost.outputTokens + r.cost.cacheCreateTokens;

/**
 * Catalog ordered RAREST → most-common. The picker takes top 3 triggered, so
 * a session that hits 5 badges shows the 3 rarest. This privileges
 * status-conferring stats over plain ones.
 */
const CATALOG: Rule[] = [
  {
    key: "token-millionaire",
    glyph: "🏆",
    ascii: "$$$",
    trigger: (r) => TOTAL_TOKENS(r) >= 1_000_000,
  },
  {
    key: "big-spender",
    glyph: "💸",
    ascii: "$$",
    trigger: (r) => r.cost.totalUsd >= 5,
  },
  {
    key: "marathoner",
    glyph: "🏃",
    ascii: ">>>",
    trigger: (r) => r.time.durationMs >= 2 * 3600_000,
  },
  {
    key: "auto-pilot",
    glyph: "🤝",
    ascii: "[A]",
    trigger: (r) => r.time.longestSoloStretchMs >= 5 * 60_000,
  },
  {
    key: "deep-thinker",
    glyph: "🧠",
    ascii: "[?]",
    trigger: (r) => {
      const active = r.time.activeMs > 0 ? r.time.activeMs : r.time.durationMs;
      return active > 0 && r.personality.thinkingMs / active >= 0.5;
    },
  },
  {
    key: "no-error-streak",
    glyph: "🔥",
    ascii: "[!]",
    trigger: (r) =>
      r.cost.rateLimitHits === 0 &&
      r.personality.escInterrupts === 0 &&
      r.time.durationMs >= 30 * 60_000 &&
      r.tools.total > 0, // require actual engagement
  },
  {
    key: "sprinter",
    glyph: "⚡",
    ascii: ">>",
    trigger: (r) => r.time.durationMs < 15 * 60_000 && r.tools.total >= 30,
  },
  {
    key: "toolbox-master",
    glyph: "🛠",
    ascii: "[T]",
    trigger: (r) => r.tools.total >= 50,
  },
  {
    key: "night-owl",
    glyph: "🌙",
    ascii: "(C",
    trigger: (r) => {
      // UTC-based for determinism (matches archetype rule + header timestamp)
      const h = Number.parseInt(r.time.startUtc.slice(11, 13), 10);
      return Number.isFinite(h) && (h >= 22 || h < 6);
    },
  },
  {
    key: "researcher",
    glyph: "📚",
    ascii: "[R]",
    trigger: (r) => (r.archetype.scores.researcher ?? 0) >= 0.5,
  },
  {
    key: "bug-hunter",
    glyph: "🐛",
    ascii: "[B]",
    trigger: (r) => (r.archetype.scores.fixer ?? 0) >= 0.5,
  },
  {
    key: "polite",
    glyph: "🙏",
    ascii: "[P]",
    trigger: (r) => r.personality.politenessScore.total >= 5,
  },
];

const MAX_BADGES = 3;

export function deriveAchievements(receipt: Receipt): Achievement[] {
  const fired: Achievement[] = [];
  for (const rule of CATALOG) {
    let ok = false;
    try {
      ok = rule.trigger(receipt);
    } catch {
      ok = false;
    }
    if (!ok) continue;
    fired.push({
      key: rule.key,
      labelKey: `achievement.${rule.key}.label`,
      iconGlyph: rule.glyph,
      asciiGlyph: rule.ascii,
    });
    if (fired.length >= MAX_BADGES) break;
  }
  return fired;
}

export const ACHIEVEMENT_CATALOG = CATALOG;
