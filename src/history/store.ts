import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { HISTORY_SCHEMA_VERSION, type SessionHistoryEntry } from "./types.js";

export const HISTORY_DIR = resolve(homedir(), ".vibe-receipt");
export const HISTORY_PATH = resolve(HISTORY_DIR, "history.jsonl");

export function isHistoryDisabled(): boolean {
  const v = process.env.VIBE_RECEIPT_NO_HISTORY ?? "";
  return v === "1" || v.toLowerCase() === "true";
}

export function ensureHistoryDir(): void {
  if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });
}

/**
 * Read all valid entries. Bad lines are skipped silently; corrupt file
 * never crashes vibe-receipt.
 */
export function readHistory(path: string = HISTORY_PATH): SessionHistoryEntry[] {
  if (!existsSync(path)) return [];
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: SessionHistoryEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (
        parsed &&
        typeof parsed === "object" &&
        parsed.schemaVersion === HISTORY_SCHEMA_VERSION &&
        typeof parsed.sessionId === "string"
      ) {
        out.push(parsed as SessionHistoryEntry);
      }
    } catch {
      // skip corrupt line
    }
  }
  return out;
}

/**
 * Idempotent write: if (sessionId, source) already exists, replace that line
 * (most recent recordedAt wins). Otherwise append.
 *
 * Uses a tmpfile + rename strategy when rewriting; plain append otherwise.
 */
export function writeHistoryEntry(entry: SessionHistoryEntry, path: string = HISTORY_PATH): void {
  ensureHistoryDir();
  const existing = readHistory(path);
  const matchIdx = existing.findIndex(
    (e) => e.sessionId === entry.sessionId && e.source === entry.source,
  );

  if (matchIdx === -1) {
    // append
    try {
      appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
    } catch {
      // never throw
    }
    return;
  }

  // rewrite atomically
  existing[matchIdx] = entry;
  const tmp = `${path}.tmp`;
  try {
    writeFileSync(tmp, `${existing.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf8");
    renameSync(tmp, path);
  } catch {
    // best-effort cleanup
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

export function clearHistory(path: string = HISTORY_PATH): void {
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // ignore
    }
  }
}
