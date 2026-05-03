import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type ParseError, parse } from "jsonc-parser";
import {
  BACKUP_PATH,
  SETTINGS_PATH,
  backupSettings,
  modifyJsonc,
  readSettings,
  writeSettings,
} from "./settings-io.js";

const HOOK_COMMAND = "vibe-receipt --hook-receive";

interface HookEntry {
  matcher?: string;
  hooks?: Array<{ type: string; command: string }>;
}

function entryReferencesUs(entry: HookEntry): boolean {
  return (entry.hooks ?? []).some((h) => h.command?.includes("vibe-receipt"));
}

function ensureFileExists() {
  if (!existsSync(SETTINGS_PATH)) {
    mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
    writeFileSync(SETTINGS_PATH, "{}\n", "utf8");
  }
}

export async function installHook(): Promise<number> {
  ensureFileExists();
  let parsed: { raw: string; data: any };
  try {
    parsed = readSettings();
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`);
    return 1;
  }

  const sessionEnd: HookEntry[] = parsed.data?.hooks?.SessionEnd ?? [];
  if (sessionEnd.some(entryReferencesUs)) {
    process.stdout.write("vibe-receipt SessionEnd hook is already installed.\n");
    return 0;
  }

  backupSettings(parsed.raw);

  const newEntry = {
    matcher: "*",
    hooks: [{ type: "command", command: HOOK_COMMAND }],
  };
  const newSessionEnd = [...sessionEnd, newEntry];

  let edited = parsed.raw.trim() === "" ? "{}" : parsed.raw;
  edited = modifyJsonc(edited, ["hooks", "SessionEnd"], newSessionEnd);

  // Validate before writing
  try {
    const validation = readSettingsString(edited);
    if (!validation.ok) throw new Error(validation.error);
  } catch (_e) {
    process.stderr.write("abort: settings.json patch did not reparse cleanly\n");
    return 1;
  }

  writeSettings(edited);
  process.stdout.write(`installed SessionEnd hook in ${SETTINGS_PATH}\nbackup at ${BACKUP_PATH}\n`);
  return 0;
}

function hookIsOurs(h: { type?: string; command?: string }): boolean {
  return typeof h?.command === "string" && h.command.includes("vibe-receipt");
}

/**
 * Filter only the OUR child hooks out of an entry. If the entry has no remaining
 * non-vibe-receipt children, return null to drop it; otherwise return the
 * pruned entry so user-installed sibling hooks survive uninstall.
 */
function pruneEntry(entry: HookEntry): HookEntry | null {
  const remaining = (entry.hooks ?? []).filter((h) => !hookIsOurs(h));
  if (remaining.length === 0) return null;
  return { ...entry, hooks: remaining };
}

export async function uninstallHook(): Promise<number> {
  if (!existsSync(SETTINGS_PATH)) {
    process.stdout.write("settings.json does not exist; nothing to uninstall.\n");
    return 0;
  }
  let parsed: { raw: string; data: any };
  try {
    parsed = readSettings();
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`);
    return 1;
  }
  const sessionEnd: HookEntry[] = parsed.data?.hooks?.SessionEnd ?? [];
  // Prune our children per-entry, then drop entries that became empty.
  const updated = sessionEnd
    .map((e) => (entryReferencesUs(e) ? pruneEntry(e) : e))
    .filter((e): e is HookEntry => e !== null);

  // Detect if any change actually happened (children removed or empty entries dropped).
  const beforeChildren = sessionEnd.flatMap((e) => e.hooks ?? []).filter(hookIsOurs).length;
  if (beforeChildren === 0) {
    process.stdout.write("no vibe-receipt SessionEnd hook found.\n");
    return 0;
  }

  backupSettings(parsed.raw);
  const edited = modifyJsonc(parsed.raw, ["hooks", "SessionEnd"], updated);
  writeSettings(edited);
  process.stdout.write("uninstalled vibe-receipt SessionEnd hook.\n");
  return 0;
}

export async function hookStatus(): Promise<number> {
  if (!existsSync(SETTINGS_PATH)) {
    process.stdout.write("settings.json does not exist (no hooks installed).\n");
    return 0;
  }
  try {
    const { data } = readSettings();
    const sessionEnd: HookEntry[] = data?.hooks?.SessionEnd ?? [];
    const installed = sessionEnd.some(entryReferencesUs);
    process.stdout.write(
      installed
        ? `installed at ${SETTINGS_PATH}\n`
        : "not installed (settings.json exists but has no vibe-receipt SessionEnd entry)\n",
    );
    return 0;
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`);
    return 1;
  }
}

function readSettingsString(s: string): { ok: true } | { ok: false; error: string } {
  try {
    const errs: ParseError[] = [];
    parse(s, errs, { allowTrailingComma: true });
    if (errs.length > 0) return { ok: false, error: `parse error at offset ${errs[0]!.offset}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
