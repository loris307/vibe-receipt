import { createHash } from "node:crypto";

export interface FirstPromptFingerprint {
  wordCount: number;
  charCount: number;
  moodEmoji: string;
  fingerprintSha: string;
  revealed: string | null;
}

const NEUTRAL_BOT = "🤖";

export function moodEmojiOf(prompt: string): string {
  if (!prompt) return NEUTRAL_BOT;
  const lower = prompt.toLowerCase();
  const exclamations = (prompt.match(/!/g) ?? []).length;
  const upperRatio =
    prompt.length > 0 ? (prompt.match(/[A-Z]/g) ?? []).length / prompt.length : 0;

  // Frustration / urgency
  if (
    exclamations >= 2 ||
    upperRatio > 0.4 ||
    /\b(fix|bug|broken|fail|wrong|error|crash|why)\b/.test(lower)
  ) {
    return `🔥${NEUTRAL_BOT}`;
  }
  // Build / create
  if (/\b(build|create|make|new|generate|implement|ship|design)\b/.test(lower)) {
    return `✨${NEUTRAL_BOT}`;
  }
  // Inquiry
  if (/\b(explain|how|what|why|teach|learn|show)\b/.test(lower)) {
    return `🤔${NEUTRAL_BOT}`;
  }
  return NEUTRAL_BOT;
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
