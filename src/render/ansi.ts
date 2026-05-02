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
  if (receipt.time.longestSoloStretchMs > 60_000)
    lines.push(row(s.labelLongestSolo, formatDurationMs(receipt.time.longestSoloStretchMs)));
  if (receipt.cost.burnRatePeakTokensPerMin > 0)
    lines.push(
      row(s.labelPeakBurn, `${compactNumber(receipt.cost.burnRatePeakTokensPerMin)}/min`),
    );
  if (receipt.cost.rateLimitHits > 0)
    lines.push(
      row(
        s.labelRateLimits,
        `× ${receipt.cost.rateLimitHits} · ${formatDurationMs(receipt.cost.rateLimitWaitMs)}`,
      ),
    );
  if (receipt.time.compactionCount > 0) {
    const v =
      receipt.time.firstCompactContextPct !== null
        ? `× ${receipt.time.compactionCount} · ${s.labelFirstCompactCtx.replace(
            "{pct}",
            String(Math.round(receipt.time.firstCompactContextPct * 100)),
          )}`
        : `× ${receipt.time.compactionCount}`;
    lines.push(row(s.labelCompactions, v));
  }
  if (receipt.comparison?.vsLastSession) {
    const c = receipt.comparison.vsLastSession;
    const tokenSign = c.deltaTokensPct >= 0 ? "+" : "";
    const costSign = c.deltaCostPct >= 0 ? "+" : "";
    lines.push(
      chalk.italic(
        chalk.dim(
          `  ${s.labelVsLast}: ${tokenSign}${(c.deltaTokensPct * 100).toFixed(0)}% tok · ${costSign}${(c.deltaCostPct * 100).toFixed(0)}% $`,
        ),
      ),
    );
  }
  if (receipt.comparison?.vsLast7Days) {
    const w = receipt.comparison.vsLast7Days;
    const lq = w.longestSessionInWindow ? "  " + s.labelLongestThisWeek : "";
    lines.push(
      chalk.italic(
        chalk.dim(`  ${s.labelRankWeek}: ${w.tokensRankInWindow}/${w.sessionsInWindow}${lq}`),
      ),
    );
  }
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
  if (receipt.work.mostEditedFile) {
    const f = receipt.work.mostEditedFile;
    lines.push(row(s.labelMostEdited, `${f.path} · ${f.editCount}× · +${f.added}/−${f.removed}`));
  }
  if (receipt.cost.costPerLineUsd > 0)
    lines.push(row(s.labelCostPerLine, `$${receipt.cost.costPerLineUsd.toFixed(4)}`));
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
    if (receipt.tools.sidechainEvents > 0) {
      lines.push(
        chalk.italic(chalk.dim(`  ${s.labelSideBranches}: ${receipt.tools.sidechainEvents}×`)),
      );
    }
    lines.push(divider());
  }

  // MCP — only show if any servers used
  if (receipt.tools.mcpServers.length >= 2) {
    lines.push(sectionHeader(s.sectionMcp));
    lines.push(row(s.labelMcpServers, String(receipt.tools.mcpServers.length)));
    for (const m of receipt.tools.mcpServers.slice(0, 5)) {
      lines.push(
        row(m.name, `${m.callCount}× · ${m.toolCount} tool${m.toolCount === 1 ? "" : "s"}`),
      );
    }
    lines.push(divider());
  } else if (receipt.tools.mcpServers.length === 1) {
    const top = receipt.tools.mcpServers[0]!;
    lines.push(
      row(
        s.labelMcpServers,
        s.labelMcpTopServer.replace("{name}", top.name).replace("{count}", String(top.callCount)),
      ),
    );
  }

  // SUBAGENTS — aggregate stats only
  if (receipt.subagents.length > 0) {
    const totalDurationMs = receipt.subagents.reduce((s, a) => s + a.durationMs, 0);
    const totalTokens = receipt.subagents.reduce((s, a) => s + a.totalTokens, 0);
    const totalTools = receipt.subagents.reduce((s, a) => s + a.toolUseCount, 0);
    lines.push(sectionHeader(s.sectionSubagents));
    lines.push(row(s.labelSubagentCount, String(receipt.subagents.length)));
    lines.push(row(s.labelSubagentTotalTime, formatDurationMs(totalDurationMs)));
    lines.push(row(s.labelSubagentTotalTokens, compactNumber(totalTokens)));
    lines.push(row(s.labelSubagentTotalTools, String(totalTools)));
    lines.push(divider());
  }

  // PERSONALITY
  lines.push(sectionHeader(s.sectionPersonality));
  if (receipt.time.afkMs > 1000) lines.push(row(s.labelAfk, formatDurationMs(receipt.time.afkMs)));
  if (receipt.personality.escInterrupts > 0)
    lines.push(row(s.labelEsc, String(receipt.personality.escInterrupts)));
  if (receipt.personality.permissionFlips > 0)
    lines.push(row(s.labelPerm, String(receipt.personality.permissionFlips)));
  if (receipt.personality.thinkingMs > 1000)
    lines.push(row(s.labelDeep, formatDurationMs(receipt.personality.thinkingMs)));
  if (receipt.personality.skills.length > 0)
    lines.push(row(s.labelSkills, receipt.personality.skills.join(", ")));
  if (receipt.personality.slashCommands.length > 0)
    lines.push(row(s.labelSlash, receipt.personality.slashCommands.join(", ")));
  if (receipt.personality.waitThenGoCount > 0)
    lines.push(row(s.labelWaitThenGo, `× ${receipt.personality.waitThenGoCount}`));
  if (receipt.personality.politenessScore.total > 0) {
    const ps = receipt.personality.politenessScore;
    lines.push(
      row(
        s.labelManners,
        `${ps.please}× please · ${ps.thanks}× thanks${ps.sorry > 0 ? ` · ${ps.sorry}× sorry` : ""}`,
      ),
    );
  }
  if (receipt.personality.correctionCount > 0) {
    const pct = Math.round(receipt.personality.correctionRate * 100);
    lines.push(
      row(
        s.labelCorrections,
        `× ${receipt.personality.correctionCount} · ${s.labelCorrectionRate.replace("{pct}", String(pct))}`,
      ),
    );
  }
  lines.push(divider());

  // PROMPTING
  lines.push(sectionHeader(s.sectionFirstPrompt));
  if (receipt.personality.promptCount > 0) {
    lines.push(row(s.labelPrompts, String(receipt.personality.promptCount)));
    lines.push(row(s.labelLongestPrompt, `${receipt.personality.longestPromptChars} chars`));
    lines.push(row(s.labelAvgPrompt, `${receipt.personality.avgPromptChars} chars`));
  }
  const firstShown = receipt.firstPrompt.revealed ?? receipt.firstPrompt.preview;
  if (firstShown) {
    lines.push("");
    lines.push(`  ${chalk.dim(s.labelFirstPreview.padEnd(10))} "${firstShown}"`);
  }
  if (receipt.personality.shortestPromptText) {
    const txt = receipt.personality.shortestPromptText.replace(/\s+/g, " ").trim().slice(0, 80);
    lines.push(
      `  ${chalk.dim(s.labelShortestText.padEnd(10))} "${txt}" (${receipt.personality.shortestPromptChars} chars)`,
    );
  }
  lines.push(
    `  ${chalk.dim(`${receipt.firstPrompt.moodEmoji} · ${s.fpFooterShaPrefix}${receipt.firstPrompt.fingerprintSha}`)}`,
  );

  // BADGES
  if (receipt.achievements.length > 0) {
    lines.push("");
    lines.push(sectionHeader(s.sectionBadges));
    const labels = receipt.achievements.map((a) => {
      const labelKey = ("achievement" +
        a.key
          .split("-")
          .map((p) => p[0]!.toUpperCase() + p.slice(1))
          .join("")) as keyof Strings;
      const label = (s[labelKey] as string) ?? a.key;
      return `${a.iconGlyph} ${chalk.bold(label)}`;
    });
    lines.push(`  ${labels.join("   ")}`);
  }

  // ARCHETYPE stamp
  {
    const ak = receipt.archetype.key;
    const nameKey = ("arch" +
      ak
        .split("-")
        .map((p) => p[0]!.toUpperCase() + p.slice(1))
        .join("") +
      "Name") as keyof Strings;
    const name = (s[nameKey] as string) ?? ak.toUpperCase();
    lines.push("");
    lines.push(`        ${chalk.bold(gradientText(`[ ${name} ]`))}`);
  }

  lines.push("");
  lines.push(chalk.dim(`        ${s.footerGen}`));
  lines.push(chalk.dim(`        ${s.footerRepo}`));
  lines.push(gradientText("═".repeat(W)));
  return lines.join("\n");
}
