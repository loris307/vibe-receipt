import * as React from "react";
import type { Receipt, Subagent, ToolStat } from "../data/receipt-schema.js";
import type { Strings } from "../i18n/index.js";
import { theme } from "./theme.js";
import type { SizePreset } from "./sizes.js";
import { SIZES } from "./sizes.js";
import { compactNumber, formatPercent, formatUsd } from "../util/compact-number.js";
import { formatDurationMs } from "../util/duration.js";
import { truncateShortestText } from "../redact/smart-redact.js";

interface CardProps {
  receipt: Receipt;
  s: Strings;
  size: SizePreset;
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

export function VibeCard({ receipt, s, size }: CardProps): React.ReactElement {
  const dim = SIZES[size];
  const padX = dim.paddingX ?? theme.paddingX;
  const padY = dim.paddingY ?? theme.paddingY;
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
        height: dim.height,
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
        </div>
      ) : null}

      {receipt.subagents.length > 0 && size !== "og" ? (
        <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
          <Divider />
          <SectionHeader>
            {`${s.sectionSubagents}  (${receipt.subagents.length})`}
          </SectionHeader>
          {receipt.subagents.slice(0, size === "story" ? 6 : 4).map((a, i) => (
            <SubagentLine key={`${a.type}-${i}`} a={a} />
          ))}
        </div>
      ) : null}

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
        {receipt.personality.yoloEvents > 0 ? (
          <Row label={s.labelYolo} value={`× ${receipt.personality.yoloEvents}`} />
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
          {receipt.firstPrompt.preview ? (
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
                  {`"${receipt.firstPrompt.preview}"`}
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

      {/* spacer */}
      <div style={{ display: "flex", flex: 1 }} />

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
