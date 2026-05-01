import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parse, type ParseError } from "jsonc-parser";
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
  } catch (e) {
    process.stderr.write(`abort: settings.json patch did not reparse cleanly\n`);
    return 1;
  }

  writeSettings(edited);
  process.stdout.write(
    `installed SessionEnd hook in ${SETTINGS_PATH}\nbackup at ${BACKUP_PATH}\n`,
  );
  return 0;
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
  const filtered = sessionEnd.filter((e) => !entryReferencesUs(e));
  if (filtered.length === sessionEnd.length) {
    process.stdout.write("no vibe-receipt SessionEnd hook found.\n");
    return 0;
  }
  backupSettings(parsed.raw);
  const edited = modifyJsonc(parsed.raw, ["hooks", "SessionEnd"], filtered);
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
        : `not installed (settings.json exists but has no vibe-receipt SessionEnd entry)\n`,
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
