import chalk from "chalk";
import type { Receipt } from "../data/receipt-schema.js";
import type { Strings } from "../i18n/index.js";
import { compactNumber, formatPercent, formatUsd } from "../util/compact-number.js";
import { formatDurationMs } from "../util/duration.js";

const W = 64;
const accentRgb: [number, number, number] = [255, 61, 127];
const accent2Rgb: [number, number, number] = [255, 183, 74];

function gradientText(t: string): string {
  const len = t.length || 1;
  let out = "";
  for (let i = 0; i < t.length; i++) {
    const f = i / Math.max(1, len - 1);
    const r = Math.round(accentRgb[0] * (1 - f) + accent2Rgb[0] * f);
    const g = Math.round(accentRgb[1] * (1 - f) + accent2Rgb[1] * f);
    const b = Math.round(accentRgb[2] * (1 - f) + accent2Rgb[2] * f);
    out += chalk.rgb(r, g, b)(t[i]);
  }
  return out;
}

function divider(): string {
  return gradientText("·".repeat(W));
}

function sectionHeader(title: string): string {
  return chalk.bold(title);
}

function row(label: string, value: string): string {
  const padded = label.padEnd(22, " ");
  const valStr = value.toString();
  const filler = Math.max(1, W - padded.length - valStr.length);
  return chalk.dim(padded) + " ".repeat(filler) + chalk.bold(valStr);
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}
function timeOnly(iso: string): string {
  return iso.slice(11, 19);
}

export function renderAnsi(receipt: Receipt, s: Strings): string {
  const lines: string[] = [];
  const totalTokens =
    receipt.cost.inputTokens +
    receipt.cost.outputTokens +
    receipt.cost.cacheCreateTokens +
    receipt.cost.cacheReadTokens;

  // Masthead
  lines.push(gradientText("═".repeat(W)));
  const mast = `       ${s.masthead}  ◆`;
  lines.push(chalk.bold(mast));
  lines.push(chalk.dim(`       ${s.tagline}`));
  lines.push("");
  lines.push(`       ${dateOnly(receipt.time.startUtc)}`);
  lines.push(`       ${timeOnly(receipt.time.startUtc)}  →  ${timeOnly(receipt.time.endUtc)}`);
  let title = receipt.meta.project;
  if (receipt.meta.branch) title += `  @  ${receipt.meta.branch}`;
  if (receipt.meta.sources.length > 1) title += `  ·  ${receipt.meta.sources.join("+")}`;
  lines.push(`       ${title}`);
  lines.push(divider());

  // SESSION
  lines.push(sectionHeader(s.sectionSession));
  if (receipt.meta.sessionCount > 1) {
    lines.push(row(s.labelSessions, String(receipt.meta.sessionCount)));
    lines.push(row(s.labelWallWindow, formatDurationMs(receipt.time.durationMs)));
    lines.push(row(s.labelActiveTime, formatDurationMs(receipt.time.activeMs)));
  } else {
    lines.push(row(s.labelDuration, formatDurationMs(receipt.time.durationMs)));
  }
  lines.push(row(s.labelModel, receipt.cost.models[0] ?? "—"));
  lines.push(row(s.labelTokens, compactNumber(totalTokens)));
  lines.push(row(s.labelCost, formatUsd(receipt.cost.totalUsd)));
  lines.push(row(s.labelCacheHit, formatPercent(receipt.cost.cacheHitRatio)));
  lines.push(divider());

  // WORK
  lines.push(sectionHeader(s.sectionWork));
  lines.push(row(s.labelFiles, String(receipt.work.filesTouched)));
  lines.push(row(s.labelLinesAdded, `+${receipt.work.linesAdded}`));
  lines.push(row(s.labelLinesRemoved, `−${receipt.work.linesRemoved}`));
  lines.push(row(s.labelBash, String(receipt.work.bashCommands)));
  if (receipt.work.webFetches > 0) {
    lines.push(row(s.labelWeb, String(receipt.work.webFetches)));
  }
  if (receipt.work.topFiles.length > 0) {
    lines.push("");
    for (const f of receipt.work.topFiles.slice(0, 3)) {
      const path = f.path.length > 38 ? `…${f.path.slice(-37)}` : f.path;
      lines.push(`  ${chalk.dim(path.padEnd(40, " "))}  +${f.added}/-${f.removed}`);
    }
  }
  lines.push(divider());

  // TOP TOOLS
  if (receipt.tools.top.length > 0) {
    lines.push(sectionHeader(s.sectionTools));
    const max = receipt.tools.top.reduce((m, t) => Math.max(m, t.count), 0);
    for (const t of receipt.tools.top.slice(0, 5)) {
      const barLen = Math.round((t.count / max) * 24);
      const bar = gradientText("█".repeat(Math.max(1, barLen)));
      lines.push(`  ${chalk.bold(t.name.padEnd(8, " "))} ${bar}  ${chalk.bold(t.count + "×")}`);
    }
    lines.push(divider());
  }

  // SUBAGENTS
  if (receipt.subagents.length > 0) {
    lines.push(sectionHeader(`${s.sectionSubagents}  (${receipt.subagents.length})`));
    for (const a of receipt.subagents.slice(0, 4)) {
      lines.push(
        `  ${chalk.dim("↳")} ${a.type.padEnd(20, " ")}  ${formatDurationMs(a.durationMs)} · ${compactNumber(a.totalTokens)} tok`,
      );
    }
    if (receipt.subagents.length > 4) {
      lines.push(chalk.dim(`     +${receipt.subagents.length - 4} more`));
    }
    lines.push(divider());
  }

  // PERSONALITY
  lines.push(sectionHeader(s.sectionPersonality));
  if (receipt.time.afkMs > 1000) lines.push(row(s.labelAfk, formatDurationMs(receipt.time.afkMs)));
  if (receipt.personality.escInterrupts > 0)
    lines.push(row(s.labelEsc, String(receipt.personality.escInterrupts)));
  if (receipt.personality.permissionFlips > 0)
    lines.push(row(s.labelPerm, String(receipt.personality.permissionFlips)));
  if (receipt.personality.yoloEvents > 0)
    lines.push(row(s.labelYolo, `× ${receipt.personality.yoloEvents}`));
  if (receipt.personality.thinkingMs > 1000)
    lines.push(row(s.labelDeep, formatDurationMs(receipt.personality.thinkingMs)));
  if (receipt.personality.skills.length > 0)
    lines.push(row(s.labelSkills, receipt.personality.skills.join(", ")));
  if (receipt.personality.slashCommands.length > 0)
    lines.push(row(s.labelSlash, receipt.personality.slashCommands.join(", ")));
  lines.push(divider());

  // FIRST PROMPT
  lines.push(sectionHeader(s.sectionFirstPrompt));
  if (receipt.firstPrompt.revealed) {
    lines.push(`  "${receipt.firstPrompt.revealed}"`);
  } else {
    lines.push(
      `  ${receipt.firstPrompt.wordCount} ${s.fpUnit}  ·  ${receipt.firstPrompt.moodEmoji}  ·  ${s.fpFooterShaPrefix}${receipt.firstPrompt.fingerprintSha}`,
    );
  }
  if (receipt.personality.promptCount > 0) {
    lines.push("");
    lines.push(row(s.labelPrompts, String(receipt.personality.promptCount)));
    lines.push(row(s.labelLongestPrompt, `${receipt.personality.longestPromptChars} chars`));
    lines.push(row(s.labelShortestPrompt, `${receipt.personality.shortestPromptChars} chars`));
    lines.push(row(s.labelAvgPrompt, `${receipt.personality.avgPromptChars} chars`));
  }
  lines.push("");
  lines.push(chalk.dim(`        ${s.footerGen}`));
  lines.push(chalk.dim(`        ${s.footerRepo}`));
  lines.push(gradientText("═".repeat(W)));
  return lines.join("\n");
}
