import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { ParseError, applyEdits, modify, parse } from "jsonc-parser";

export const SETTINGS_PATH = resolve(homedir(), ".claude", "settings.json");
export const BACKUP_PATH = resolve(homedir(), ".claude", "settings.json.vibe-receipt.bak");

export function readSettings(): { raw: string; data: any } {
  if (!existsSync(SETTINGS_PATH)) {
    return { raw: "{}", data: {} };
  }
  const raw = readFileSync(SETTINGS_PATH, "utf8");
  const errs: ParseError[] = [];
  const data = parse(raw, errs, { allowTrailingComma: true });
  if (errs.length > 0) {
    throw new Error(`~/.claude/settings.json contains invalid JSONC at offset ${errs[0]!.offset}`);
  }
  return { raw, data: data ?? {} };
}

/**
 * Snapshot the user's current settings.json to BACKUP_PATH before we mutate it.
 * Only runs when no backup yet exists — re-running install/uninstall must not
 * overwrite the original (pre-vibe-receipt) state, which is the file's whole
 * reason for existing.
 */
export function backupSettings(_raw: string) {
  if (!existsSync(SETTINGS_PATH)) return;
  if (existsSync(BACKUP_PATH)) return;
  copyFileSync(SETTINGS_PATH, BACKUP_PATH);
}

export function writeSettings(raw: string) {
  writeFileSync(SETTINGS_PATH, raw, { encoding: "utf8" });
}

export function modifyJsonc(raw: string, path: (string | number)[], value: unknown): string {
  const edits = modify(raw, path, value, {
    formattingOptions: { tabSize: 2, insertSpaces: true },
  });
  return applyEdits(raw, edits);
}
