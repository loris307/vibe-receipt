import { readJsonlAll } from "../../util/jsonl.js";
import type { Subagent, TopFile } from "../../data/receipt-schema.js";
import { scorePoliteness } from "../politeness.js";

/**
 * Personality fields extracted from a Claude Code JSONL file.
 * Token/cost/model are NOT here — those come from ccusage's loader.
 * This focuses on receipt-card-relevant fields ccusage does not surface.
 */
export interface ClaudePersonality {
  sessionId: string | null;
  cwd: string | null;
  branch: string | null;
  models: string[];
  startUtc: string | null;
  endUtc: string | null;
  durationMs: number;

  activeMs: number;
  afkMs: number;
  afkRecaps: string[];

  filesTouched: string[];
  fileEntries: TopFile[];
  linesAdded: number;
  linesRemoved: number;
  bashCommands: number;
  webFetches: number;
  userModified: number;

  toolCounts: Record<string, number>;
  subagents: Subagent[];

  escInterrupts: number;
  permissionFlips: number;
  yoloEvents: number;
  thinkingMs: number;
  skills: string[];
  slashCommands: string[];
  truncatedOutputs: number;
  hookErrors: number;
  longestUserMsgChars: number;
  promptLengths: number[];
  promptTexts: string[];
  promptTimestamps: string[];

  firstPrompt: string | null;
  shortestPromptText: string | null;

  // v0.2 fields
  longestSoloStretchMs: number;
  longestSoloStretchStartUtc: string | null;
  longestSoloStretchEndUtc: string | null;
  waitThenGoCount: number;
  politenessPlease: number;
  politenessThanks: number;
  politenessSorry: number;
  rateLimitHits: number;
  rateLimitWaitMs: number;
  tokenEvents: { ts: number; tokens: number }[];

  // (stable across the session in practice; may have multiple values across compactions)
  claudeCodeVersion: string | null;
}

interface FilePatchAccum {
  added: number;
  removed: number;
  editCount: number;
}

const TOOL_LIMIT = 5;
const SUBAGENT_LIMIT = 8;
const TOP_FILES_LIMIT = 5;

/** Capped per-turn duration when computing thinking time, to avoid AFK contamination. */
const THINKING_TURN_CAP_MS = 5 * 60 * 1000;

/** Extract a string-content from a user event whose `message.content` may be string or array. */
function userEventStringContent(evt: any): string | null {
  const content = evt?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    // Only extract if it's a "real" user message (not a tool_result wrapper)
    const hasRealText = content.some(
      (c: any) =>
        c && typeof c === "object" && c.type === "text" && typeof c.text === "string",
    );
    if (!hasRealText) return null;
    return content
      .filter((c: any) => c && c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
  }
  return null;
}

function isCommandWrapper(s: string): boolean {
  return s.includes("<command-name>");
}

function extractSlashFromContent(s: string): string | null {
  const m = s.match(/<command-name>\/([\w-]+)<\/command-name>/);
  return m ? `/${m[1]}` : null;
}

/**
 * Strip system-injected wrapper tags from a user message to recover the real
 * user-typed text. Used by the prompt-stats accumulator so system reminders /
 * slash command wrappers / local-command stdout don't inflate prompt lengths.
 *
 * Wrapper inventory (verified against real JSONLs):
 * - <system-reminder>           : auto-injected reminders
 * - <command-name|message|args> : slash commands
 * - <local-command-stdout|stderr|caveat> : `! cmd` shell exec results
 * - <task-notification>         : subagent talkback events
 * - <user-prompt-submit-hook>   : hook output
 * - <task>                      : agent task wrappers
 */
function cleanUserText(s: string): string {
  return s
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, "")
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, "")
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, "")
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, "")
    .replace(/<local-command-stderr>[\s\S]*?<\/local-command-stderr>/g, "")
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "")
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, "")
    .replace(/<user-prompt-submit-hook>[\s\S]*?<\/user-prompt-submit-hook>/g, "")
    .trim();
}

/**
 * A user event is a real typed prompt only if:
 *   - origin is not a task-notification (subagent talkback)
 *   - it has string content (or text-array content)
 *   - after stripping all known system wrappers, residual text is non-empty
 */
function isRealUserPrompt(evt: any): { real: string } | null {
  // Subagent-driven task notifications appear as type:"user" with origin.kind:"task-notification"
  if (evt?.origin?.kind === "task-notification") return null;
  const str = userEventStringContent(evt);
  if (str === null) return null;
  if (isCommandWrapper(str)) return null;
  const real = cleanUserText(str);
  if (real.length === 0) return null;
  return { real };
}

export interface ExtractOpts {
  /** If set, ignore events with timestamp < sinceMs. */
  sinceMs?: number;
}

export async function extractClaudePersonality(
  filePath: string,
  opts: ExtractOpts = {},
): Promise<ClaudePersonality> {
  const allEvents = await readJsonlAll<any>(filePath);
  const events =
    typeof opts.sinceMs === "number"
      ? allEvents.filter((e) => {
          const ts = e?.timestamp;
          if (typeof ts !== "string") return false;
          const t = new Date(ts).getTime();
          return Number.isFinite(t) && t >= opts.sinceMs!;
        })
      : allEvents;

  const out: ClaudePersonality = {
    sessionId: null,
    cwd: null,
    branch: null,
    models: [],
    startUtc: null,
    endUtc: null,
    durationMs: 0,

    activeMs: 0,
    afkMs: 0,
    afkRecaps: [],

    filesTouched: [],
    fileEntries: [],
    linesAdded: 0,
    linesRemoved: 0,
    bashCommands: 0,
    webFetches: 0,
    userModified: 0,

    toolCounts: {},
    subagents: [],

    escInterrupts: 0,
    permissionFlips: 0,
    yoloEvents: 0,
    thinkingMs: 0,
    skills: [],
    slashCommands: [],
    truncatedOutputs: 0,
    hookErrors: 0,
    longestUserMsgChars: 0,
    promptLengths: [],
    promptTexts: [],
    promptTimestamps: [],

    firstPrompt: null,
    shortestPromptText: null,

    longestSoloStretchMs: 0,
    longestSoloStretchStartUtc: null,
    longestSoloStretchEndUtc: null,
    waitThenGoCount: 0,
    politenessPlease: 0,
    politenessThanks: 0,
    politenessSorry: 0,
    rateLimitHits: 0,
    rateLimitWaitMs: 0,
    tokenEvents: [],

    claudeCodeVersion: null,
  };

  if (events.length === 0) return out;

  const filePatchById: Map<string, FilePatchAccum> = new Map();
  const seenToolUseIds = new Set<string>();
  const seenMessageIds = new Set<string>();
  // v0.2 — wait-then-go: track whether the assistant is mid-stream when the
  // next real user prompt lands.
  let assistantInFlight = false;
  const skillSet = new Set<string>();
  const slashSet = new Set<string>();
  const modelSet = new Set<string>();
  const branches = new Map<string, number>();

  // Track thinking turns: index of assistant events with thinking blocks → timestamp
  // We compute thinking duration as `nextEvent.timestamp - thisEvent.timestamp` (capped).
  const thinkingTurnTimestamps: number[] = [];

  let firstTs: number | null = null;
  let lastTs: number | null = null;

  for (let i = 0; i < events.length; i++) {
    const evt = events[i];
    if (!evt || typeof evt !== "object") continue;

    // Envelope fields stamped on every record
    if (evt.cwd && !out.cwd) out.cwd = evt.cwd;
    if (evt.gitBranch) {
      branches.set(evt.gitBranch, (branches.get(evt.gitBranch) ?? 0) + 1);
    }
    if (evt.version && !out.claudeCodeVersion) out.claudeCodeVersion = evt.version;
    if (evt.sessionId && !out.sessionId) out.sessionId = evt.sessionId;

    if (evt.timestamp) {
      const t = new Date(evt.timestamp).getTime();
      if (Number.isFinite(t)) {
        if (firstTs === null || t < firstTs) firstTs = t;
        if (lastTs === null || t > lastTs) lastTs = t;
      }
    }

    const type = evt.type;

    if (type === "system") {
      const sub = evt.subtype;
      if (sub === "turn_duration" && typeof evt.durationMs === "number") {
        out.activeMs += evt.durationMs;
      } else if (sub === "away_summary" && typeof evt.content === "string") {
        out.afkRecaps.push(evt.content.slice(0, 120));
      } else if (sub === "stop_hook_summary") {
        const errs = evt.hookErrors;
        if (Array.isArray(errs)) out.hookErrors += errs.length;
      } else if (sub === "compact_boundary") {
        assistantInFlight = false;
      } else if (sub === "api_error") {
        // Rate-limit detection. Robust path: HTTP status 429 (Anthropic rate limit).
        // Fallback path: deeply-nested error.error.error.type === "rate_limit_error".
        const status = evt?.error?.status;
        const innerType = evt?.error?.error?.error?.type;
        if (status === 429 || innerType === "rate_limit_error") {
          out.rateLimitHits += 1;
          if (typeof evt.retryInMs === "number" && Number.isFinite(evt.retryInMs)) {
            out.rateLimitWaitMs += Math.max(0, evt.retryInMs);
          }
        }
      }
      continue;
    }

    if (type === "permission-mode") {
      out.permissionFlips += 1;
      if (evt.permissionMode === "bypassPermissions") out.yoloEvents += 1;
      continue;
    }

    if (type === "last-prompt") {
      if (!out.firstPrompt && typeof evt.lastPrompt === "string") {
        out.firstPrompt = evt.lastPrompt;
      }
      continue;
    }

    if (type === "user") {
      const str = userEventStringContent(evt);
      if (str !== null && isCommandWrapper(str)) {
        const slash = extractSlashFromContent(str);
        if (slash) slashSet.add(slash);
      }
      const realPrompt = isRealUserPrompt(evt);
      if (realPrompt) {
        if (assistantInFlight) {
          out.waitThenGoCount += 1;
        }
        assistantInFlight = false;
        const len = realPrompt.real.length;
        out.promptLengths.push(len);
        out.promptTexts.push(realPrompt.real);
        if (typeof evt.timestamp === "string") {
          out.promptTimestamps.push(evt.timestamp);
        } else {
          out.promptTimestamps.push("");
        }
        if (!out.firstPrompt) out.firstPrompt = realPrompt.real;
        if (len > out.longestUserMsgChars) out.longestUserMsgChars = len;
        if (
          out.shortestPromptText === null ||
          len < out.shortestPromptText.length
        ) {
          out.shortestPromptText = realPrompt.real;
        }
      }
      // tool_result + toolUseResult — count file/bash effects
      const tur = evt.toolUseResult;
      const content = evt.message?.content;
      const isToolResult = Array.isArray(content) && content.some((c: any) => c?.type === "tool_result");
      if (isToolResult && tur && typeof tur === "object") {
        // Detect file-edit results by SHAPE (not by `type` field — Edit's
        // toolUseResult has no `type` at all; Write has type:"create" with
        // empty structuredPatch + populated `content`).
        const isFileEditResult =
          typeof tur.filePath === "string" &&
          (Array.isArray(tur.structuredPatch) ||
            typeof tur.content === "string" ||
            typeof tur.oldString === "string" ||
            typeof tur.newString === "string");

        if (isFileEditResult) {
          const fp = tur.filePath;
          if (!filePatchById.has(fp))
            filePatchById.set(fp, { added: 0, removed: 0, editCount: 0 });
          const acc = filePatchById.get(fp)!;
          acc.editCount += 1;

          let added = 0;
          let removed = 0;
          let patchHasLines = false;
          const patches = Array.isArray(tur.structuredPatch) ? tur.structuredPatch : [];
          for (const hunk of patches) {
            const lines: string[] = Array.isArray(hunk?.lines) ? hunk.lines : [];
            for (const ln of lines) {
              if (typeof ln !== "string") continue;
              if (ln.startsWith("+")) {
                added += 1;
                patchHasLines = true;
              } else if (ln.startsWith("-")) {
                removed += 1;
                patchHasLines = true;
              }
            }
          }

          // Fallback for new-file Write: type:"create", empty structuredPatch,
          // full file content in `content`. Count lines in content.
          if (!patchHasLines && typeof tur.content === "string" && tur.content) {
            const isNewFile = tur.type === "create" || !tur.originalFile;
            if (isNewFile) {
              added = (tur.content.match(/\n/g)?.length ?? 0) + 1;
            }
          }

          acc.added += added;
          acc.removed += removed;
          if (tur.userModified === true) out.userModified += 1;
        } else if (tur.interrupted === true) {
          out.escInterrupts += 1;
          // ESC interrupt clears any in-flight state — the next prompt is not "wait-then-go"
          assistantInFlight = false;
        } else if (tur.agentType && typeof tur.totalDurationMs === "number") {
          out.subagents.push({
            type: String(tur.agentType),
            durationMs: Number(tur.totalDurationMs ?? 0),
            totalTokens: Number(tur.totalTokens ?? 0),
            toolUseCount: Number(tur.totalToolUseCount ?? 0),
          });
        }
      }
      continue;
    }

    if (type === "attachment") {
      const at = evt.attachment;
      if (!at || typeof at !== "object") continue;
      if (at.type === "async_hook_response" && typeof at.stdout === "string") {
        if (at.stdout.includes("Output truncated")) out.truncatedOutputs += 1;
      } else if (at.type === "hook_success" && typeof at.exitCode === "number") {
        if (at.exitCode !== 0) out.hookErrors += 1;
      }
      continue;
    }

    if (type === "assistant") {
      const msg = evt.message;
      if (!msg || typeof msg !== "object") continue;
      if (typeof msg.model === "string") modelSet.add(msg.model);

      // v0.2 — wait-then-go: track whether assistant intends to continue.
      // stop_reason "end_turn" → finished, "tool_use" / "max_tokens" / "stop_sequence" → mid-stream.
      // stop_reason may be undefined for streaming intermediates (treat as in-flight).
      const sr = msg.stop_reason;
      if (sr === "end_turn") {
        assistantInFlight = false;
      } else if (typeof sr === "string" && sr.length > 0) {
        assistantInFlight = true;
      }

      const content = Array.isArray(msg.content) ? msg.content : [];
      let hasThinking = false;
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        if (block.type === "thinking") {
          hasThinking = true;
        } else if (block.type === "tool_use") {
          const id = block.id;
          if (typeof id === "string") {
            if (seenToolUseIds.has(id)) continue;
            seenToolUseIds.add(id);
          }
          const name = String(block.name ?? "");
          if (!name) continue;
          out.toolCounts[name] = (out.toolCounts[name] ?? 0) + 1;
          if (name === "Bash") out.bashCommands += 1;
          else if (name === "WebFetch") out.webFetches += 1;
          else if (name === "Skill" && typeof block.input?.skill === "string") {
            skillSet.add(block.input.skill);
          }
        }
      }
      if (hasThinking && evt.timestamp) {
        const t = new Date(evt.timestamp).getTime();
        if (Number.isFinite(t)) thinkingTurnTimestamps.push(t);
      }

      // v0.2 — burn-rate event: input + output + cache_create per assistant message.
      // Skip cache-read (that's prior-cache consumption, not new tokens generated).
      // Dedup by (message.id, requestId) to match cost-summation behaviour.
      if (evt.timestamp) {
        const dedupKey = `${msg.id ?? ""}::${evt.requestId ?? ""}`;
        if (!seenMessageIds.has(dedupKey)) {
          seenMessageIds.add(dedupKey);
          const usage = msg.usage ?? {};
          const inp = Number(usage.input_tokens ?? 0);
          const outp = Number(usage.output_tokens ?? 0);
          const cc = Number(usage.cache_creation_input_tokens ?? 0);
          const total = inp + outp + cc;
          if (total > 0) {
            const t = new Date(evt.timestamp).getTime();
            if (Number.isFinite(t)) out.tokenEvents.push({ ts: t, tokens: total });
          }
        }
      }
      continue;
    }
  }

  // Resolve files — keep ALL of them (combine + render slice top N from this list).
  const fileEntries = Array.from(filePatchById.entries())
    .map(([path, p]) => ({
      path,
      added: p.added,
      removed: p.removed,
      editCount: p.editCount,
    }))
    .sort((a, b) => b.added + b.removed - (a.added + a.removed));
  out.filesTouched = fileEntries.map((f) => f.path);
  out.fileEntries = fileEntries;
  for (const f of fileEntries) {
    out.linesAdded += f.added;
    out.linesRemoved += f.removed;
  }
  void TOP_FILES_LIMIT;

  // Models, sorted by first-seen
  out.models = Array.from(modelSet);

  // Branches: pick most common
  if (branches.size > 0) {
    out.branch = Array.from(branches.entries()).sort((a, b) => b[1] - a[1])[0]![0]!;
  }

  // Time
  if (firstTs !== null && lastTs !== null) {
    out.startUtc = new Date(firstTs).toISOString();
    out.endUtc = new Date(lastTs).toISOString();
    out.durationMs = Math.max(0, lastTs - firstTs);
  }
  out.afkMs = Math.max(0, out.durationMs - out.activeMs);

  // Thinking time (precise rule from spec): for each thinking-bearing assistant event,
  // take time-to-next-event capped at 5 min.
  if (thinkingTurnTimestamps.length > 0) {
    const allTs = events
      .map((e) => (e?.timestamp ? new Date(e.timestamp).getTime() : null))
      .filter((t): t is number => t !== null && Number.isFinite(t))
      .sort((a, b) => a - b);
    for (const ts of thinkingTurnTimestamps) {
      const nextIdx = allTs.findIndex((t) => t > ts);
      if (nextIdx === -1) continue;
      const delta = allTs[nextIdx]! - ts;
      out.thinkingMs += Math.min(delta, THINKING_TURN_CAP_MS);
    }
  }

  // Skills + slash, capped for receipt
  out.skills = Array.from(skillSet).slice(0, 3);
  out.slashCommands = Array.from(slashSet).slice(0, 3);

  // Subagents: keep all (renderer shows aggregate stats; cap was for old per-agent list).
  out.subagents.sort((a, b) => b.durationMs - a.durationMs);
  void SUBAGENT_LIMIT;

  // Limit toolCounts via sorting at the read site (we keep all here for aggregation).
  void TOOL_LIMIT;

  // v0.2 — politeness across all real user prompts
  {
    const pol = scorePoliteness(out.promptTexts);
    out.politenessPlease = pol.please;
    out.politenessThanks = pol.thanks;
    out.politenessSorry = pol.sorry;
  }

  // v0.2 — longest solo-stretch: max gap between two consecutive REAL user prompts.
  // (one prompt → 0; no prompts → 0.)
  if (out.promptTimestamps.length >= 2) {
    const tss = out.promptTimestamps
      .map((s) => Date.parse(s))
      .filter((n) => Number.isFinite(n));
    tss.sort((a, b) => a - b);
    let maxGap = 0;
    let maxStart: number | null = null;
    let maxEnd: number | null = null;
    for (let i = 1; i < tss.length; i++) {
      const gap = tss[i]! - tss[i - 1]!;
      if (gap > maxGap) {
        maxGap = gap;
        maxStart = tss[i - 1]!;
        maxEnd = tss[i]!;
      }
    }
    out.longestSoloStretchMs = maxGap;
    if (maxStart !== null) out.longestSoloStretchStartUtc = new Date(maxStart).toISOString();
    if (maxEnd !== null) out.longestSoloStretchEndUtc = new Date(maxEnd).toISOString();
  }

  return out;
}
