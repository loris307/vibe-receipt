#!/usr/bin/env node
// Silence ccusage's consola-style logger before any data-loader import — its info/warn lines
// would otherwise pollute --json output to stdout.
try {
  const ccusageLogger: any = await import("ccusage/logger");
  if (ccusageLogger?.logger && typeof ccusageLogger.logger.level !== "undefined") {
    ccusageLogger.logger.level = process.env.VIBE_DEBUG ? 3 : -1;
  }
} catch {
  // ccusage not installed in some test envs — fine
}

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import ms from "ms";
import { loadClaudeSessions } from "./extract/claude.js";
import { loadCodexSessions } from "./extract/codex.js";
import { buildSingleReceipt } from "./aggregate/single.js";
import { buildCombinedReceipt } from "./aggregate/combine.js";
import { buildTodayReceipt, buildWeekReceipt, buildYearReceipt } from "./aggregate/window.js";
import { pickMostRecent } from "./aggregate/pick-most-recent.js";
import { applyRedaction, parseRevealFlag, withRawPrompt } from "./redact/smart-redact.js";
import { NO_REVEAL } from "./data/types.js";
import { recordSession } from "./history/record.js";
import { readHistory } from "./history/store.js";
import { deriveComparison } from "./aggregate/comparisons.js";
import { renderPng } from "./render/png.js";
import { renderAnsi } from "./render/ansi.js";
import { parseSizeFlag, type SizePreset } from "./render/sizes.js";
import { pickLang, strings } from "./i18n/index.js";
import type { NormalizedSession, Source } from "./data/types.js";
import { installHook, uninstallHook, hookStatus } from "./hook/install.js";
import { handleHookReceive } from "./hook/on-session-end.js";
import { listSourcesSummary } from "./hook/sources-summary.js";
import type { Receipt } from "./data/receipt-schema.js";

const VERSION = "0.1.0";

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgv(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let i = 0;
  while (i < args.length) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[a.slice(2)] = next;
          i += 1;
        } else {
          flags[a.slice(2)] = true;
        }
      }
    } else {
      positional.push(a);
    }
    i += 1;
  }
  const command = positional.shift() ?? "show";
  return { command, positional, flags };
}

function help(): string {
  return `vibe-receipt v${VERSION}
  Per-session paper-receipt cards for Claude Code & Codex CLI sessions.

USAGE
  vibe-receipt [command] [flags]

COMMANDS
  show                       Render the most recent session (default)
  combine                    Merge multiple sessions
  today                      All sessions started today
  week                       Last 7 days
  year                       Calendar year
  install-hook               Add SessionEnd hook to ~/.claude/settings.json
  uninstall-hook             Remove the SessionEnd hook
  hook-status                Show whether the hook is installed
  sources                    List detected JSONL files per source
  doctor                     Health check (fonts, paths, deps)
  help                       Print this help

FLAGS
  --session <uuid>           Render a specific session
  --source claude|codex      Restrict source for default-mode picker
  --since <duration>         e.g. 1h, 30m, 2d         (combine only)
  --branch <name>            e.g. feature/oss-saint   (combine only)
  --cwd <path>               absolute or relative      (combine only)
  --out <path>               PNG output path (default: ./vibe-receipts/<id>.png)
  --size portrait|story|og|all   default: portrait (1080x1350)
  --no-preview               skip the ANSI terminal preview
  --reveal paths|prompt|bash|all   opt out of smart-redact
  --review                   show preview, prompt y/N before writing PNG
  --json                     emit raw Receipt JSON to stdout instead of PNG
  --lang en|de               label language (default: auto from $LANG)

EXAMPLES
  npx vibe-receipt
  vibe-receipt combine --since 2h --reveal=paths
  vibe-receipt year --size=story
  vibe-receipt install-hook
`;
}

function ensureDir(p: string) {
  mkdirSync(dirname(p), { recursive: true });
}

function defaultOut(idOrHash: string): string {
  return resolve(process.cwd(), "vibe-receipts", `${idOrHash}.png`);
}

async function loadAllSources(opts: {
  source?: Source;
  sinceMs?: number;
  branch?: string;
  cwd?: string;
  sessionId?: string;
}): Promise<NormalizedSession[]> {
  const want = opts.source;
  const tasks: Promise<NormalizedSession[]>[] = [];
  if (!want || want === "claude") tasks.push(loadClaudeSessions(opts).catch(() => []));
  if (!want || want === "codex") tasks.push(loadCodexSessions(opts).catch(() => []));
  const all = (await Promise.all(tasks)).flat();
  all.sort((a, b) => new Date(b.endUtc).getTime() - new Date(a.endUtc).getTime());
  return all;
}

async function emit(opts: {
  sessions: NormalizedSession[];
  rawFirstPrompt: string | null;
  receipt: Receipt;
  flags: Record<string, string | boolean>;
}): Promise<void> {
  const { flags, rawFirstPrompt } = opts;
  const reveal = parseRevealFlag(typeof flags.reveal === "string" ? flags.reveal : undefined);
  const lang = pickLang(typeof flags.lang === "string" ? flags.lang : null);
  const sStrings = strings(lang);
  const sizes: SizePreset[] = parseSizeFlag(
    typeof flags.size === "string" ? flags.size : undefined,
  );
  const noPreview = flags["no-preview"] === true;
  const wantJson = flags.json === true;
  const wantReview = flags.review === true;

  let receipt = opts.receipt;
  if (rawFirstPrompt) receipt = withRawPrompt(receipt, rawFirstPrompt);

  // v0.2 — derive comparisons against persistent history BEFORE recording the
  // current session (self-exclusion handles the case where the current session
  // is already in history from a prior render).
  try {
    const history = readHistory();
    const comparison = deriveComparison(receipt, history);
    if (comparison) receipt = { ...receipt, comparison };
  } catch {
    // ignore — comparisons are best-effort
  }

  // Record session history in ALWAYS-redacted form (privacy-safe regardless
  // of user's --reveal choices). Best-effort, never blocks render.
  try {
    recordSession(applyRedaction(receipt, NO_REVEAL));
  } catch {
    // ignore
  }

  receipt = applyRedaction(receipt, reveal);

  if (wantJson) {
    process.stdout.write(JSON.stringify(receipt, null, 2) + "\n");
    return;
  }

  if (!noPreview) {
    const preview = renderAnsi(receipt, sStrings);
    process.stderr.write(preview + "\n");
  }

  if (wantReview) {
    const ok = await readYesNo("write PNG? [y/N] ");
    if (!ok) {
      process.stderr.write("aborted.\n");
      return;
    }
  }

  const baseId =
    receipt.scope.kind === "single"
      ? receipt.scope.sessionId.slice(0, 8)
      : `combined-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;

  const outFlag = typeof flags.out === "string" ? flags.out : null;
  for (const size of sizes) {
    // Always suffix size in the default filename so different --size flags
    // don't overwrite each other on subsequent runs.
    const outPath =
      outFlag && sizes.length === 1
        ? resolve(outFlag)
        : defaultOut(`${baseId}-${size}`);
    ensureDir(outPath);
    const png = await renderPng({ receipt, s: sStrings, size });
    writeFileSync(outPath, png);
    process.stderr.write(`✓ saved → ${outPath}  (${(png.length / 1024).toFixed(0)} KB)\n`);
  }
}

async function readYesNo(prompt: string): Promise<boolean> {
  return new Promise((res) => {
    process.stderr.write(prompt);
    process.stdin.once("data", (buf) => {
      const ans = buf.toString().trim().toLowerCase();
      res(ans === "y" || ans === "yes");
    });
  });
}

async function cmdShow(parsed: ParsedArgs): Promise<number> {
  const sessionFlag =
    typeof parsed.flags.session === "string" ? parsed.flags.session : undefined;
  const source =
    typeof parsed.flags.source === "string" ? (parsed.flags.source as Source) : undefined;
  const sessions = await loadAllSources({ source, sessionId: sessionFlag });
  if (sessions.length === 0) {
    process.stderr.write(
      "no sessions found · install-hook to start logging or run a Claude Code session first\n",
    );
    return 1;
  }
  const target = sessionFlag
    ? sessions.find((s) => s.sessionId === sessionFlag) ?? null
    : pickMostRecent(sessions, source);
  if (!target) {
    process.stderr.write(`session not found\n`);
    return 1;
  }
  await emit({
    sessions: [target],
    rawFirstPrompt: target.firstPrompt,
    receipt: buildSingleReceipt(target),
    flags: parsed.flags,
  });
  return 0;
}

async function cmdCombine(parsed: ParsedArgs): Promise<number> {
  const sinceFlag = typeof parsed.flags.since === "string" ? parsed.flags.since : undefined;
  const branch = typeof parsed.flags.branch === "string" ? parsed.flags.branch : undefined;
  const cwd = typeof parsed.flags.cwd === "string" ? resolve(parsed.flags.cwd) : undefined;

  const opts: Parameters<typeof loadAllSources>[0] = {};
  if (sinceFlag) {
    const sinceDeltaMs = ms(sinceFlag as ms.StringValue);
    if (typeof sinceDeltaMs !== "number") {
      process.stderr.write(`invalid --since: ${sinceFlag}\n`);
      return 1;
    }
    opts.sinceMs = Date.now() - sinceDeltaMs;
  }
  if (branch) opts.branch = branch;
  if (cwd) opts.cwd = cwd;

  const sessions = await loadAllSources(opts);
  if (sessions.length === 0) {
    process.stderr.write(
      `no sessions match filter (since=${sinceFlag ?? "—"}, branch=${branch ?? "—"}, cwd=${cwd ?? "—"})\n`,
    );
    return 1;
  }
  const scope = branch
    ? ({ kind: "combine-branch", branch } as const)
    : cwd
      ? ({ kind: "combine-cwd", cwd } as const)
      : ({ kind: "combine-since", since: sinceFlag ?? "PT1H" } as const);

  await emit({
    sessions,
    rawFirstPrompt: sessions[0]?.firstPrompt ?? null,
    receipt: buildCombinedReceipt(sessions, scope),
    flags: parsed.flags,
  });
  return 0;
}

async function cmdWindow(
  kind: "today" | "week" | "year",
  parsed: ParsedArgs,
): Promise<number> {
  const sessions = await loadAllSources({});
  if (sessions.length === 0) {
    process.stderr.write("no sessions found\n");
    return 1;
  }
  let receipt: Receipt;
  try {
    receipt =
      kind === "today"
        ? buildTodayReceipt(sessions)
        : kind === "week"
          ? buildWeekReceipt(sessions)
          : buildYearReceipt(sessions);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 1;
  }
  await emit({
    sessions,
    rawFirstPrompt: sessions[0]?.firstPrompt ?? null,
    receipt,
    flags: parsed.flags,
  });
  return 0;
}

async function cmdSources(): Promise<number> {
  const summary = await listSourcesSummary();
  process.stdout.write(summary + "\n");
  return 0;
}

async function cmdDoctor(): Promise<number> {
  const lines: string[] = [];
  lines.push(`vibe-receipt v${VERSION}`);
  lines.push(`node:    ${process.version}`);
  lines.push(`platform: ${process.platform} ${process.arch}`);
  try {
    const { loadFonts } = await import("./render/theme.js");
    const fonts = loadFonts();
    lines.push(`fonts:   OK (${fonts.length} loaded)`);
  } catch (e) {
    lines.push(`fonts:   FAIL — ${(e as Error).message}`);
  }
  try {
    const { Resvg } = await import("@resvg/resvg-js");
    const r = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>');
    void r.render();
    lines.push(`resvg:   OK`);
  } catch (e) {
    lines.push(`resvg:   FAIL — ${(e as Error).message}`);
  }
  try {
    await import("ccusage/data-loader");
    lines.push(`ccusage: OK`);
  } catch (e) {
    lines.push(`ccusage: FAIL — ${(e as Error).message}`);
  }
  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}

async function cmdHistory(parsed: ParsedArgs): Promise<number> {
  const { readHistory, clearHistory, HISTORY_PATH } = await import("./history/store.js");
  const sub = parsed.positional[0] ?? "list";
  if (sub === "list") {
    const limit = typeof parsed.flags.limit === "string" ? Math.max(1, parseInt(parsed.flags.limit, 10)) : 20;
    const all = readHistory().sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
    if (all.length === 0) {
      process.stderr.write("no history yet — render a receipt first\n");
      return 0;
    }
    process.stdout.write(`history: ${all.length} entries · ${HISTORY_PATH}\n\n`);
    process.stdout.write(
      ["recorded", "session", "src", "dur", "tokens", "cost", "project"].join("\t") + "\n",
    );
    for (const e of all.slice(0, limit)) {
      const dur = (e.durationMs / 60_000).toFixed(0) + "m";
      const tok = (e.totalTokens / 1000).toFixed(0) + "k";
      const cost = "$" + e.totalUsd.toFixed(2);
      process.stdout.write(
        [e.recordedAt.slice(0, 16), e.sessionId.slice(0, 8), e.source, dur, tok, cost, e.project].join("\t") + "\n",
      );
    }
    return 0;
  }
  if (sub === "clear") {
    clearHistory();
    process.stderr.write(`history cleared (${HISTORY_PATH})\n`);
    return 0;
  }
  if (sub === "export") {
    const all = readHistory();
    process.stdout.write(JSON.stringify(all, null, 2) + "\n");
    return 0;
  }
  process.stderr.write(`unknown history subcommand: ${sub} (try list/clear/export)\n`);
  return 2;
}

async function main(): Promise<number> {
  const parsed = parseArgv(process.argv);
  if (parsed.flags.version === true || parsed.flags.v === true) {
    process.stdout.write(`vibe-receipt ${VERSION}\n`);
    return 0;
  }
  if (parsed.flags.help === true || parsed.flags.h === true || parsed.command === "help") {
    process.stdout.write(help());
    return 0;
  }
  if (parsed.flags["hook-receive"] === true) {
    await handleHookReceive();
    return 0;
  }

  switch (parsed.command) {
    case "show":
      return cmdShow(parsed);
    case "combine":
      return cmdCombine(parsed);
    case "today":
      return cmdWindow("today", parsed);
    case "week":
      return cmdWindow("week", parsed);
    case "year":
      return cmdWindow("year", parsed);
    case "install-hook":
      return installHook();
    case "uninstall-hook":
      return uninstallHook();
    case "hook-status":
      return hookStatus();
    case "sources":
      return cmdSources();
    case "doctor":
      return cmdDoctor();
    case "history":
      return cmdHistory(parsed);
    default:
      process.stderr.write(`unknown command: ${parsed.command}\n${help()}`);
      return 2;
  }
}

main()
  .then((code) => {
    process.exit(code ?? 0);
  })
  .catch((err) => {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    if (process.env.VIBE_DEBUG) process.stderr.write(`${(err as Error).stack}\n`);
    process.exit(1);
  });
