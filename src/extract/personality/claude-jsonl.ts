import { readJsonlAll } from "../../util/jsonl.js";
import type { Subagent, TopFile } from "../../data/receipt-schema.js";

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
  topFiles: TopFile[];
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

  firstPrompt: string | null;
  shortestPromptText: string | null;

  // (stable across the session in practice; may have multiple values across compactions)
  claudeCodeVersion: string | null;
}

interface FilePatchAccum {
  added: number;
  removed: number;
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

export async function extractClaudePersonality(
  filePath: string,
): Promise<ClaudePersonality> {
  const events = await readJsonlAll<any>(filePath);

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
    topFiles: [],
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

    firstPrompt: null,
    shortestPromptText: null,
    claudeCodeVersion: null,
  };

  if (events.length === 0) return out;

  const filePatchById: Map<string, FilePatchAccum> = new Map();
  const seenToolUseIds = new Set<string>();
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
        const len = realPrompt.real.length;
        out.promptLengths.push(len);
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
        const tType = tur.type;
        if (tType === "create" || tType === "update") {
          if (typeof tur.filePath === "string") {
            const fp = tur.filePath;
            if (!filePatchById.has(fp)) filePatchById.set(fp, { added: 0, removed: 0 });
            const acc = filePatchById.get(fp)!;
            const patches = Array.isArray(tur.structuredPatch) ? tur.structuredPatch : [];
            for (const hunk of patches) {
              const lines: string[] = Array.isArray(hunk?.lines) ? hunk.lines : [];
              for (const ln of lines) {
                if (typeof ln !== "string") continue;
                if (ln.startsWith("+")) acc.added += 1;
                else if (ln.startsWith("-")) acc.removed += 1;
              }
            }
            if (tur.userModified === true) out.userModified += 1;
          }
        } else if (tur.interrupted === true) {
          out.escInterrupts += 1;
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
      continue;
    }
  }

  // Resolve top-files
  const fileEntries = Array.from(filePatchById.entries())
    .map(([path, p]) => ({ path, added: p.added, removed: p.removed }))
    .sort((a, b) => b.added + b.removed - (a.added + a.removed));
  out.filesTouched = fileEntries.map((f) => f.path);
  out.topFiles = fileEntries.slice(0, TOP_FILES_LIMIT);
  for (const f of fileEntries) {
    out.linesAdded += f.added;
    out.linesRemoved += f.removed;
  }

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

  // Subagents: top by duration
  out.subagents.sort((a, b) => b.durationMs - a.durationMs);
  out.subagents = out.subagents.slice(0, SUBAGENT_LIMIT);

  // Limit toolCounts via sorting at the read site (we keep all here for aggregation).
  void TOOL_LIMIT;

  return out;
}
