import { createHash } from "node:crypto";

export interface FirstPromptFingerprint {
  wordCount: number;
  charCount: number;
  moodEmoji: string;
  fingerprintSha: string;
  revealed: string | null;
}

/**
 * Mood is encoded twice: an ASCII glyph that renders cleanly in Satori (the PNG card),
 * plus a richer emoji set for terminal previews where emoji rendering is cheap.
 * The Receipt schema only ships the ASCII version (PNG-safe); the ANSI renderer
 * upgrades to the emoji equivalent at render time.
 */
const ASCII_NEUTRAL = "//";
const ASCII_FIRE = "!!";
const ASCII_BUILD = "++";
const ASCII_THINK = "??";

export type MoodKind = "neutral" | "fire" | "build" | "think";

export function moodKindOf(prompt: string): MoodKind {
  if (!prompt) return "neutral";
  const lower = prompt.toLowerCase();
  const exclamations = (prompt.match(/!/g) ?? []).length;
  const upperRatio =
    prompt.length > 0 ? (prompt.match(/[A-Z]/g) ?? []).length / prompt.length : 0;

  if (
    exclamations >= 2 ||
    upperRatio > 0.4 ||
    /\b(fix|bug|broken|fail|wrong|error|crash|why)\b/.test(lower)
  ) {
    return "fire";
  }
  if (/\b(build|create|make|new|generate|implement|ship|design)\b/.test(lower)) {
    return "build";
  }
  if (/\b(explain|how|what|why|teach|learn|show)\b/.test(lower)) {
    return "think";
  }
  return "neutral";
}

export function moodAscii(kind: MoodKind): string {
  switch (kind) {
    case "fire":
      return ASCII_FIRE;
    case "build":
      return ASCII_BUILD;
    case "think":
      return ASCII_THINK;
    default:
      return ASCII_NEUTRAL;
  }
}

export function moodEmoji(kind: MoodKind): string {
  switch (kind) {
    case "fire":
      return "🔥🤖";
    case "build":
      return "✨🤖";
    case "think":
      return "🤔🤖";
    default:
      return "🤖";
  }
}

export function moodEmojiOf(prompt: string): string {
  return moodAscii(moodKindOf(prompt));
}

export function computeFirstPromptFingerprint(prompt: string | null): FirstPromptFingerprint {
  if (!prompt) {
    return {
      wordCount: 0,
      charCount: 0,
      moodEmoji: NEUTRAL_BOT,
      fingerprintSha: "—",
      revealed: null,
    };
  }
  const trimmed = prompt.trim();
  const wordCount = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
  const fingerprintSha = createHash("sha256")
    .update(trimmed.toLowerCase())
    .digest("hex")
    .slice(0, 6);
  return {
    wordCount,
    charCount: trimmed.length,
    moodEmoji: moodEmojiOf(trimmed),
    fingerprintSha,
    revealed: null,
  };
}
