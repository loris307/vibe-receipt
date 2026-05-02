import * as React from "react";
import type { Receipt, Subagent, ToolStat } from "../data/receipt-schema.js";
import type { Strings } from "../i18n/index.js";
import { theme } from "./theme.js";
import type { SizePreset } from "./sizes.js";
import { SIZES } from "./sizes.js";
import { compactNumber, formatPercent, formatUsd } from "../util/compact-number.js";
import { formatDurationMs } from "../util/duration.js";
import { truncateShortestText } from "../redact/smart-redact.js";

/** Substitute tagline placeholders ({n}, {r}, {e}, {d}, {hh}, {mm}) with concrete values.
 *  Time is shown in UTC (matches the header) so receipts are deterministic
 *  regardless of which machine renders them. */
function renderArchetypeTagline(template: string, r: Receipt): string {
  if (!template) return "";
  // Slice the ISO string directly to keep it UTC and stable.
  const hh = r.time.startUtc.slice(11, 13);
  const mm = r.time.startUtc.slice(14, 16);
  const ak = r.archetype.key;
  // For each archetype, decide which {n} stands for what
  let n = "0";
  if (ak === "specifier") {
    const pct =
      r.personality.promptCount > 0
        ? Math.round(((r.archetype.scores.specifier ?? 0) * 0.4 + 0.2) * 100)
        : 0;
    n = String(pct);
  } else if (ak === "vibe-coder") n = String(r.personality.avgPromptChars);
  else if (ak === "fixer") {
    // approximate from score: score = (rate-0.2)/0.4, so rate = score*0.4 + 0.2
    const rate = (r.archetype.scores.fixer ?? 0) * 0.4 + 0.2;
    n = String(Math.round(rate * 100));
  } else if (ak === "firefighter")
    n = String(r.cost.rateLimitHits + r.personality.escInterrupts);
  else if (ak === "esc-rager") n = String(r.personality.escInterrupts);
  // For researcher: {r} reads, {e} edits
  return template
    .replace("{n}", n)
    .replace("{hh}", hh)
    .replace("{mm}", mm)
    .replace(
      "{r}",
      String(
        (r.tools.top.find((t) => t.name === "Read")?.count ?? 0) +
          (r.tools.top.find((t) => t.name === "Grep")?.count ?? 0),
      ),
    )
    .replace(
      "{e}",
      String(
        (r.tools.top.find((t) => t.name === "Edit")?.count ?? 0) +
          (r.tools.top.find((t) => t.name === "Write")?.count ?? 0),
      ),
    )
    .replace("{d}", formatDurationMs(r.time.longestSoloStretchMs));
}

interface CardProps {
  receipt: Receipt;
  s: Strings;
  size: SizePreset;
  /** Optional height override (auto-extended canvas). Falls back to SIZES[size].height. */
  height?: number;
}

/**
 * Satori layout rules used here:
 * - every container is `display: flex`
 * - text always inside a <span> with explicit fontFamily + fontSize
 * - vertical stacks set `flexDirection: "column"` AND child margins
 * - never put raw text directly inside a flex container
 */

function Divider({ size = "regular" }: { size?: "regular" | "thin" }) {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: size === "thin" ? 1 : 2,
        background: theme.accentGradient,
        opacity: 0.5,
        borderRadius: 2,
        marginTop: 18,
        marginBottom: 18,
      }}
    />
  );
}

function SectionHeader({ children }: { children: string }) {
  return (
    <div
      style={{
        display: "flex",
        marginBottom: 14,
      }}
    >
      <span
        style={{
          fontFamily: theme.monoFamily,
          fontWeight: 700,
          fontSize: 24,
          color: theme.ink,
          letterSpacing: 2,
        }}
      >
        {children}
      </span>
    </div>
  );
}

function Row({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "baseline",
        marginBottom: 8,
        width: "100%",
      }}
    >
      <span
        style={{
          fontFamily: theme.monoFamily,
          fontWeight: 400,
          fontSize: 22,
          color: theme.inkSoft,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: theme.monoFamily,
          fontWeight: emphasis ? 700 : 400,
          fontSize: 22,
          color: theme.ink,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function ComparisonLine({
  label,
  tokenPct,
  costPct,
  text,
}: {
  label: string;
  tokenPct?: number;
  costPct?: number;
  text?: string;
}) {
  // Build the body. If pcts provided, format them with sign.
  const body =
    text ??
    [
      typeof tokenPct === "number"
        ? `${tokenPct >= 0 ? "+" : ""}${(tokenPct * 100).toFixed(0)}% tok`
        : null,
      typeof costPct === "number"
        ? `${costPct >= 0 ? "+" : ""}${(costPct * 100).toFixed(0)}% $`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        marginTop: 6,
        marginBottom: 2,
        width: "100%",
      }}
    >
      <div style={{ display: "flex", width: 240 }}>
        <span
          style={{
            fontFamily: theme.monoFamily,
            fontWeight: 400,
            fontSize: 18,
            color: theme.inkSoft,
          }}
        >
          {label}
        </span>
      </div>
      <div style={{ display: "flex", flex: 1 }}>
        <span
          style={{
            fontFamily: theme.monoFamily,
            fontWeight: 400,
            fontSize: 18,
            color: theme.inkMuted,
            fontStyle: "italic",
          }}
        >
          {body}
        </span>
      </div>
    </div>
  );
}

function ToolBar({ tool, max }: { tool: ToolStat; max: number }) {
  const pct = max > 0 ? Math.max(0.05, tool.count / max) : 0;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        marginBottom: 8,
        width: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          width: 130,
        }}
      >
        <span
          style={{
            fontFamily: theme.monoFamily,
            fontWeight: 400,
            fontSize: 20,
            color: theme.ink,
          }}
        >
          {tool.name}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          flex: 1,
          height: 14,
          background: "#EEEAE2",
          borderRadius: 4,
          overflow: "hidden",
          marginRight: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            width: `${pct * 100}%`,
            height: "100%",
            background: theme.accentGradient,
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          width: 70,
          justifyContent: "flex-end",
        }}
      >
        <span
          style={{
            fontFamily: theme.monoFamily,
            fontWeight: 700,
            fontSize: 20,
            color: theme.ink,
          }}
        >
          {tool.count}×
        </span>
      </div>
    </div>
  );
}

function SubagentLine({ a }: { a: Subagent }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        justifyContent: "space-between",
        marginBottom: 6,
        width: "100%",
      }}
    >
      <span
        style={{
          fontFamily: theme.monoFamily,
          fontWeight: 400,
          fontSize: 20,
          color: theme.ink,
        }}
      >
        {`> ${a.type}`}
      </span>
      <span
        style={{
          fontFamily: theme.monoFamily,
          fontWeight: 400,
          fontSize: 20,
          color: theme.inkSoft,
        }}
      >
        {formatDurationMs(a.durationMs)} · {compactNumber(a.totalTokens)} tok
      </span>
    </div>
  );
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}
function timeOnly(iso: string): string {
  return iso.slice(11, 19);
}

function modeBadge(receipt: Receipt, s: Strings): string {
  switch (receipt.scope.kind) {
    case "single":
      return s.badgeSession;
    case "combine-since":
    case "combine-branch":
    case "combine-cwd":
      return `${s.badgeCombined} · ${receipt.meta.sessionCount}`;
    case "window-today":
      return s.badgeToday;
    case "window-week":
      return s.badgeWeek;
    case "window-year":
      return `${s.badgeYear} ${receipt.scope.year}`;
  }
}

export function VibeCard({ receipt, s, size, height }: CardProps): React.ReactElement {
  const dim = SIZES[size];
  const padX = dim.paddingX ?? theme.paddingX;
  const padY = dim.paddingY ?? theme.paddingY;
  const cardHeight = height ?? dim.height;
  const isCompact = size === "og";
  const totalTokens =
    receipt.cost.inputTokens +
    receipt.cost.outputTokens +
    receipt.cost.cacheCreateTokens +
    receipt.cost.cacheReadTokens;

  const mainModel = receipt.cost.models[0] ?? "—";
  const showInFlight = receipt.meta.inFlight === true;
  const isMulti = receipt.meta.sessionCount > 1;

  const mastheadFontSize = isCompact ? 32 : 48;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: dim.width,
        height: cardHeight,
        background: theme.bg,
        padding: `${padY}px ${padX}px`,
        color: theme.ink,
      }}
    >
      {/* Masthead */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          width: "100%",
          marginBottom: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <span
            style={{
              fontFamily: theme.monoFamily,
              fontWeight: 700,
              fontSize: mastheadFontSize,
              letterSpacing: 4,
              color: theme.ink,
            }}
          >
            {s.masthead}
          </span>
          <div
            style={{
              display: "flex",
              padding: "8px 16px",
              borderRadius: 18,
              background: theme.accentGradient,
            }}
          >
            <span
              style={{
                fontFamily: theme.monoFamily,
                fontWeight: 700,
                fontSize: isCompact ? 14 : 18,
                color: "#FFFFFF",
                letterSpacing: 1,
              }}
            >
              {modeBadge(receipt, s)}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", marginTop: 8 }}>
          <span
            style={{
              fontFamily: theme.monoFamily,
              fontWeight: 400,
              fontSize: 18,
              color: theme.inkMuted,
              letterSpacing: 1,
            }}
          >
            {s.tagline}
            {showInFlight ? ` ${s.inFlight}` : ""}
          </span>
        </div>

        <div style={{ display: "flex", marginTop: 18 }}>
          <span
            style={{
              fontFamily: theme.monoFamily,
              fontWeight: 400,
              fontSize: 20,
              color: theme.ink,
            }}
          >
            {dateOnly(receipt.time.startUtc)} · {timeOnly(receipt.time.startUtc)} →{" "}
            {timeOnly(receipt.time.endUtc)}
          </span>
        </div>
        <div style={{ display: "flex", marginTop: 4 }}>
          <span
            style={{
              fontFamily: theme.monoFamily,
              fontWeight: 400,
              fontSize: 20,
              color: theme.inkSoft,
            }}
          >
            {receipt.meta.project}
            {receipt.meta.branch && receipt.meta.branch !== "HEAD"
              ? `  @  ${receipt.meta.branch}`
              : ""}
            {receipt.meta.sources.length > 1
              ? `  ·  ${receipt.meta.sources.join("+")}`
              : ""}
          </span>
        </div>
      </div>

      <Divider />

      {/* SESSION */}
      <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
        <SectionHeader>{s.sectionSession}</SectionHeader>
        {isMulti ? (
          <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
            <Row label={s.labelSessions} value={String(receipt.meta.sessionCount)} />
            <Row label={s.labelWallWindow} value={formatDurationMs(receipt.time.durationMs)} />
            <Row
              label={s.labelActiveTime}
              value={formatDurationMs(receipt.time.activeMs)}
              emphasis
            />
          </div>
        ) : (
          <Row
            label={s.labelDuration}
            value={formatDurationMs(receipt.time.durationMs)}
            emphasis
          />
        )}
        <Row label={s.labelModel} value={mainModel} />
        <Row label={s.labelTokens} value={compactNumber(totalTokens)} />
        <Row label={s.labelCost} value={formatUsd(receipt.cost.totalUsd)} emphasis />
        <Row label={s.labelCacheHit} value={formatPercent(receipt.cost.cacheHitRatio)} />
        {receipt.time.longestSoloStretchMs > 60_000 ? (
          <Row
            label={s.labelLongestSolo}
            value={formatDurationMs(receipt.time.longestSoloStretchMs)}
          />
        ) : null}
        {receipt.cost.burnRatePeakTokensPerMin > 0 ? (
          <Row
            label={s.labelPeakBurn}
            value={`${compactNumber(receipt.cost.burnRatePeakTokensPerMin)}/min`}
          />
        ) : null}
        {receipt.cost.rateLimitHits > 0 ? (
          <Row
            label={s.labelRateLimits}
            value={`× ${receipt.cost.rateLimitHits} · ${formatDurationMs(receipt.cost.rateLimitWaitMs)}`}
          />
        ) : null}
        {receipt.time.compactionCount > 0 && !isCompact ? (
          <Row
            label={s.labelCompactions}
            value={
              receipt.time.firstCompactContextPct !== null
                ? `× ${receipt.time.compactionCount} · ${s.labelFirstCompactCtx.replace(
                    "{pct}",
                    String(Math.round(receipt.time.firstCompactContextPct * 100)),
                  )}`
                : `× ${receipt.time.compactionCount}`
            }
          />
        ) : null}
        {receipt.comparison?.vsLastSession ? (
          <ComparisonLine
            label={s.labelVsLast}
            tokenPct={receipt.comparison.vsLastSession.deltaTokensPct}
            costPct={receipt.comparison.vsLastSession.deltaCostPct}
          />
        ) : null}
        {receipt.comparison?.vsLast7Days ? (
          <ComparisonLine
            label={s.labelRankWeek}
            text={`${receipt.comparison.vsLast7Days.tokensRankInWindow}/${receipt.comparison.vsLast7Days.sessionsInWindow}${
              receipt.comparison.vsLast7Days.longestSessionInWindow ? "  " + s.labelLongestThisWeek : ""
            }`}
          />
        ) : null}
      </div>

      <Divider />

      {/* WORK */}
      <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
        <SectionHeader>{s.sectionWork}</SectionHeader>
        <Row label={s.labelFiles} value={String(receipt.work.filesTouched)} />
        <Row label={s.labelLinesAdded} value={`+${receipt.work.linesAdded}`} />
        <Row label={s.labelLinesRemoved} value={`−${receipt.work.linesRemoved}`} />
        <Row label={s.labelBash} value={String(receipt.work.bashCommands)} />
        {receipt.work.webFetches > 0 ? (
          <Row label={s.labelWeb} value={String(receipt.work.webFetches)} />
        ) : null}
        {receipt.work.mostEditedFile ? (
          <Row
            label={s.labelMostEdited}
            value={`${receipt.work.mostEditedFile.path} · ${receipt.work.mostEditedFile.editCount}× · +${receipt.work.mostEditedFile.added}/−${receipt.work.mostEditedFile.removed}`}
          />
        ) : null}
        {receipt.cost.costPerLineUsd > 0 ? (
          <Row
            label={s.labelCostPerLine}
            value={`$${receipt.cost.costPerLineUsd.toFixed(4)}`}
          />
        ) : null}
      </div>

      {receipt.tools.top.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
          <Divider />
          <SectionHeader>{s.sectionTools}</SectionHeader>
          <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
            {receipt.tools.top.slice(0, 5).map((t) => {
              const max = receipt.tools.top.reduce((m, x) => Math.max(m, x.count), 0);
              return <ToolBar key={t.name} tool={t} max={max} />;
            })}
          </div>
          {receipt.tools.sidechainEvents > 0 && !isCompact ? (
            <div
              style={{
                display: "flex",
                fontSize: 18,
                opacity: 0.55,
                fontStyle: "italic",
                marginTop: 6,
              }}
            >
              {`${s.labelSideBranches}: ${receipt.tools.sidechainEvents}×`}
            </div>
          ) : null}
        </div>
      ) : null}

      {receipt.tools.mcpServers.length >= 2 && size !== "og" ? (
        <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
          <Divider />
          <SectionHeader>{s.sectionMcp}</SectionHeader>
          <Row
            label={s.labelMcpServers}
            value={String(receipt.tools.mcpServers.length)}
          />
          {receipt.tools.mcpServers.slice(0, 5).map((m) => (
            <Row
              key={m.name}
              label={m.name}
              value={`${m.callCount}× · ${m.toolCount} tool${m.toolCount === 1 ? "" : "s"}`}
            />
          ))}
        </div>
      ) : receipt.tools.mcpServers.length === 1 && size !== "og" ? (
        <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
          <Row
            label={s.labelMcpServers}
            value={s.labelMcpTopServer
              .replace("{name}", receipt.tools.mcpServers[0]!.name)
              .replace("{count}", String(receipt.tools.mcpServers[0]!.callCount))}
          />
        </div>
      ) : null}

      {receipt.subagents.length > 0 && size !== "og"
        ? (() => {
            const totalDurationMs = receipt.subagents.reduce((s, a) => s + a.durationMs, 0);
            const totalTokens = receipt.subagents.reduce((s, a) => s + a.totalTokens, 0);
            const totalTools = receipt.subagents.reduce((s, a) => s + a.toolUseCount, 0);
            return (
              <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
                <Divider />
                <SectionHeader>{s.sectionSubagents}</SectionHeader>
                <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
                  <Row
                    label={s.labelSubagentCount}
                    value={String(receipt.subagents.length)}
                  />
                  <Row
                    label={s.labelSubagentTotalTime}
                    value={formatDurationMs(totalDurationMs)}
                  />
                  <Row
                    label={s.labelSubagentTotalTokens}
                    value={compactNumber(totalTokens)}
                  />
                  <Row
                    label={s.labelSubagentTotalTools}
                    value={String(totalTools)}
                  />
                </div>
              </div>
            );
          })()
        : null}

      <Divider />

      {/* PERSONALITY */}
      <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
        <SectionHeader>{s.sectionPersonality}</SectionHeader>
        {receipt.time.afkMs > 1000 ? (
          <Row label={s.labelAfk} value={formatDurationMs(receipt.time.afkMs)} />
        ) : null}
        {receipt.personality.escInterrupts > 0 ? (
          <Row label={s.labelEsc} value={String(receipt.personality.escInterrupts)} />
        ) : null}
        {receipt.personality.permissionFlips > 0 ? (
          <Row label={s.labelPerm} value={String(receipt.personality.permissionFlips)} />
        ) : null}
        {receipt.personality.thinkingMs > 1000 ? (
          <Row label={s.labelDeep} value={formatDurationMs(receipt.personality.thinkingMs)} />
        ) : null}
        {receipt.personality.skills.length > 0 ? (
          <Row label={s.labelSkills} value={receipt.personality.skills.join(", ")} />
        ) : null}
        {receipt.personality.slashCommands.length > 0 ? (
          <Row label={s.labelSlash} value={receipt.personality.slashCommands.join(", ")} />
        ) : null}
        {receipt.personality.waitThenGoCount > 0 ? (
          <Row label={s.labelWaitThenGo} value={`× ${receipt.personality.waitThenGoCount}`} />
        ) : null}
        {receipt.personality.politenessScore.total > 0 ? (
          <Row
            label={s.labelManners}
            value={`${receipt.personality.politenessScore.please}× please · ${receipt.personality.politenessScore.thanks}× thanks${
              receipt.personality.politenessScore.sorry > 0
                ? ` · ${receipt.personality.politenessScore.sorry}× sorry`
                : ""
            }`}
          />
        ) : null}
        {receipt.personality.correctionCount > 0 && !isCompact ? (
          <Row
            label={s.labelCorrections}
            value={`× ${receipt.personality.correctionCount} · ${s.labelCorrectionRate.replace(
              "{pct}",
              String(Math.round(receipt.personality.correctionRate * 100)),
            )}`}
          />
        ) : null}
      </div>

      {!isCompact ? (
        <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
          <Divider />
          <SectionHeader>{s.sectionFirstPrompt}</SectionHeader>
          {receipt.personality.promptCount > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
              <Row label={s.labelPrompts} value={String(receipt.personality.promptCount)} />
              <Row
                label={s.labelLongestPrompt}
                value={`${receipt.personality.longestPromptChars} chars`}
              />
              <Row
                label={s.labelAvgPrompt}
                value={`${receipt.personality.avgPromptChars} chars`}
              />
            </div>
          ) : null}
          {receipt.firstPrompt.revealed || receipt.firstPrompt.preview ? (
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                width: "100%",
                marginTop: 12,
              }}
            >
              <div style={{ display: "flex", width: 130 }}>
                <span
                  style={{
                    fontFamily: theme.monoFamily,
                    fontWeight: 400,
                    fontSize: 22,
                    color: theme.inkSoft,
                  }}
                >
                  {s.labelFirstPreview}
                </span>
              </div>
              <div style={{ display: "flex", flex: 1 }}>
                <span
                  style={{
                    fontFamily: theme.monoFamily,
                    fontWeight: 400,
                    fontSize: 22,
                    color: theme.ink,
                  }}
                >
                  {`"${receipt.firstPrompt.revealed ?? receipt.firstPrompt.preview}"`}
                </span>
              </div>
            </div>
          ) : null}
          {receipt.personality.shortestPromptText ? (
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                width: "100%",
                marginTop: 8,
              }}
            >
              <div style={{ display: "flex", width: 130 }}>
                <span
                  style={{
                    fontFamily: theme.monoFamily,
                    fontWeight: 400,
                    fontSize: 22,
                    color: theme.inkSoft,
                  }}
                >
                  {s.labelShortestText}
                </span>
              </div>
              <div style={{ display: "flex", flex: 1 }}>
                <span
                  style={{
                    fontFamily: theme.monoFamily,
                    fontWeight: 400,
                    fontSize: 22,
                    color: theme.ink,
                  }}
                >
                  {`"${truncateShortestText(receipt.personality.shortestPromptText)}" (${receipt.personality.shortestPromptChars} chars)`}
                </span>
              </div>
            </div>
          ) : null}
          <div style={{ display: "flex", marginTop: 10, width: "100%" }}>
            <span
              style={{
                fontFamily: theme.monoFamily,
                fontWeight: 400,
                fontSize: 18,
                color: theme.inkMuted,
              }}
            >
              {`${receipt.firstPrompt.moodEmoji}  ·  ${s.fpFooterShaPrefix}${receipt.firstPrompt.fingerprintSha}`}
            </span>
          </div>
        </div>
      ) : null}

      {/* BADGES — 0..3 emoji-glyph achievements (skip on og teaser) */}
      {receipt.achievements.length > 0 && size !== "og" ? (
        <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
          <Divider />
          <SectionHeader>{s.sectionBadges}</SectionHeader>
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 18,
              marginTop: 6,
            }}
          >
            {receipt.achievements.map((a) => {
              const labelKey =
                ("achievement" +
                  a.key
                    .split("-")
                    .map((p) => p[0]!.toUpperCase() + p.slice(1))
                    .join("")) as keyof typeof s;
              const label = (s[labelKey] as string) ?? a.key;
              return (
                <div
                  key={a.key}
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    paddingTop: 6,
                    paddingBottom: 6,
                    paddingLeft: 12,
                    paddingRight: 12,
                    background: "#F5F0E6",
                    borderRadius: 6,
                  }}
                >
                  <span style={{ fontSize: 22 }}>{a.iconGlyph}</span>
                  <span
                    style={{
                      fontFamily: theme.monoFamily,
                      fontWeight: 700,
                      fontSize: 16,
                      color: theme.ink,
                    }}
                  >
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* spacer */}
      <div style={{ display: "flex", flex: 1 }} />

      {/* ARCHETYPE stamp — faux rubber-stamp (skip on og teaser) */}
      {size !== "og" ? (
        (() => {
          const ak = receipt.archetype.key;
          const nameKey = ("arch" +
            ak
              .split("-")
              .map((p) => p[0]!.toUpperCase() + p.slice(1))
              .join("") +
            "Name") as keyof typeof s;
          const taglineKey = (nameKey.toString().replace("Name", "Tagline")) as keyof typeof s;
          const name = (s[nameKey] as string) ?? ak.toUpperCase();
          const taglineRaw = (s[taglineKey] as string) ?? "";
          const tagline = renderArchetypeTagline(taglineRaw, receipt);
          return (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                width: "100%",
                marginBottom: 14,
                marginTop: 6,
              }}
            >
              <div
                style={{
                  display: "flex",
                  paddingTop: 6,
                  paddingBottom: 6,
                  paddingLeft: 22,
                  paddingRight: 22,
                  border: `3px solid ${theme.ink}`,
                  borderRadius: 4,
                  transform: "rotate(-3deg)",
                }}
              >
                <span
                  style={{
                    fontFamily: theme.monoFamily,
                    fontWeight: 700,
                    fontSize: 26,
                    color: theme.ink,
                    letterSpacing: 2,
                  }}
                >
                  [ {name} ]
                </span>
              </div>
              {tagline ? (
                <span
                  style={{
                    fontFamily: theme.monoFamily,
                    fontWeight: 400,
                    fontSize: 16,
                    color: theme.inkMuted,
                    marginTop: 8,
                    fontStyle: "italic",
                  }}
                >
                  {tagline}
                </span>
              ) : null}
            </div>
          );
        })()
      ) : null}

      {isMulti ? (
        <div style={{ display: "flex", justifyContent: "center", width: "100%", marginBottom: 6 }}>
          <span
            style={{
              fontFamily: theme.monoFamily,
              fontWeight: 400,
              fontSize: 14,
              color: theme.inkMuted,
            }}
          >
            · {s.combineHint} ·
          </span>
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "100%",
        }}
      >
        <span
          style={{
            fontFamily: theme.monoFamily,
            fontWeight: 400,
            fontSize: 16,
            color: theme.inkMuted,
          }}
        >
          {s.footerGen}
        </span>
        <span
          style={{
            fontFamily: theme.monoFamily,
            fontWeight: 400,
            fontSize: 16,
            color: theme.inkMuted,
            marginTop: 2,
          }}
        >
          {s.footerRepo}
        </span>
      </div>
    </div>
  );
}
