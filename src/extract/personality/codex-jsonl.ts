import type { Subagent, TopFile } from "../../data/receipt-schema.js";
import { readJsonlAll } from "../../util/jsonl.js";
import { countCorrections } from "../corrections.js";
import { scorePoliteness } from "../politeness.js";

/**
 * Codex CLI JSONL → personality bundle.
 * Codex emits cumulative `token_count` events; we use the *last* event's totals (cumulative).
 */
export interface CodexPersonality {
  sessionId: string | null;
  cwd: string | null;
  models: string[];
  cliVersion: string | null;
  startUtc: string | null;
  endUtc: string | null;
  durationMs: number;

  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;

  filesTouched: string[];
  fileEntries: TopFile[];
  linesAdded: number;
  linesRemoved: number;
  bashCommands: number;
  /** Captured Bash command strings (parsed from function_call arguments.cmd). */
  bashCommandsList: string[];

  toolCounts: Record<string, number>;
  subagents: Subagent[];

  thinkingMs: number;
  firstPrompt: string | null;
  shortestPromptText: string | null;
  longestUserMsgChars: number;
  promptLengths: number[];
  promptTexts: string[];
  promptTimestamps: string[];

  // v0.2 fields (codex extractor leaves most as defaults; computed by aggregator)
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

  // v0.3 fields — Codex doesn't expose compaction/MCP/sidechain; corrections via shared regex
  compactionCount: number;
  firstCompactPreTokens: number | null;
  firstCompactContextPct: number | null;
  mcpServers: import("../../data/receipt-schema.js").McpServerStat[];
  sidechainEvents: number;
  correctionCount: number;
}

const TOP_FILES_LIMIT = 5;

/**
 * Apply-patch parser for unified-diff-ish text payloads (very forgiving).
 * Returns (filesTouched, linesAdded, linesRemoved).
 */
function parseApplyPatch(payload: unknown): {
  files: string[];
  added: number;
  removed: number;
} {
  if (!payload || typeof payload !== "object") return { files: [], added: 0, removed: 0 };
  const patchText = (payload as any).patch;
  if (typeof patchText !== "string") return { files: [], added: 0, removed: 0 };
  const files = new Set<string>();
  let added = 0;
  let removed = 0;
  for (const line of patchText.split("\n")) {
    const m = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/);
    if (m) {
      files.add(m[2]!);
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { files: Array.from(files), added, removed };
}

function eventTimestamp(evt: any): number | null {
  const ts = evt?.payload?.timestamp ?? evt?.timestamp;
  if (typeof ts !== "string") return null;
  const t = new Date(ts).getTime();
  return Number.isFinite(t) ? t : null;
}

export interface ExtractOpts {
  sinceMs?: number;
}

export async function extractCodexPersonality(
  filePath: string,
  opts: ExtractOpts = {},
): Promise<CodexPersonality> {
  const allEvents = await readJsonlAll<any>(filePath);
  const events =
    typeof opts.sinceMs === "number"
      ? allEvents.filter((e) => {
          const ts = e?.payload?.timestamp ?? e?.timestamp;
          if (typeof ts !== "string") return false;
          const t = new Date(ts).getTime();
          return Number.isFinite(t) && t >= opts.sinceMs!;
        })
      : allEvents;

  const out: CodexPersonality = {
    sessionId: null,
    cwd: null,
    models: [],
    cliVersion: null,
    startUtc: null,
    endUtc: null,
    durationMs: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    filesTouched: [],
    fileEntries: [],
    linesAdded: 0,
    linesRemoved: 0,
    bashCommands: 0,
    bashCommandsList: [],
    toolCounts: {},
    subagents: [],
    thinkingMs: 0,
    firstPrompt: null,
    shortestPromptText: null,
    longestUserMsgChars: 0,
    promptLengths: [],
    promptTexts: [],
    promptTimestamps: [],
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

    // v0.3 defaults (Codex: compaction/MCP/sidechain stay 0/null/[]; corrections in Phase 5)
    compactionCount: 0,
    firstCompactPreTokens: null,
    firstCompactContextPct: null,
    mcpServers: [],
    sidechainEvents: 0,
    correctionCount: 0,
  };

  if (events.length === 0) return out;

  const fileMap = new Map<string, { added: number; removed: number; editCount: number }>();
  const modelSet = new Set<string>();

  let firstTs: number | null = null;
  let lastTs: number | null = null;

  // Codex token_count events are *cumulative*; we keep last seen totals.
  let lastInput = 0;
  let lastCachedInput = 0;
  let lastOutput = 0;
  let lastReasoning = 0;

  for (const evt of events) {
    if (!evt || typeof evt !== "object") continue;
    const ts = eventTimestamp(evt);
    if (ts !== null) {
      if (firstTs === null || ts < firstTs) firstTs = ts;
      if (lastTs === null || ts > lastTs) lastTs = ts;
    }

    const type = evt.type;
    const payload = evt.payload ?? {};

    if (type === "session_meta") {
      if (typeof payload.id === "string") out.sessionId = payload.id;
      if (typeof payload.cwd === "string") out.cwd = payload.cwd;
      if (typeof payload.cli_version === "string") out.cliVersion = payload.cli_version;
      continue;
    }

    if (type === "turn_context") {
      if (typeof payload.model === "string") modelSet.add(payload.model);
      if (typeof payload.cwd === "string" && !out.cwd) out.cwd = payload.cwd;
      continue;
    }

    if (type === "response_item") {
      const innerType = payload.type;
      // Old fixture shape: response_item/user_message with payload.text
      // (kept for fixture/back-compat — current Codex emits event_msg/user_message instead)
      if (innerType === "user_message" && typeof payload.text === "string") {
        const text = payload.text.trim();
        if (text.length > 0) {
          out.promptLengths.push(text.length);
          out.promptTexts.push(text);
          const tsStr =
            typeof payload.timestamp === "string"
              ? payload.timestamp
              : typeof evt.timestamp === "string"
                ? evt.timestamp
                : "";
          out.promptTimestamps.push(tsStr);
          if (!out.firstPrompt) out.firstPrompt = text;
          if (text.length > out.longestUserMsgChars) out.longestUserMsgChars = text.length;
          if (out.shortestPromptText === null || text.length < out.shortestPromptText.length) {
            out.shortestPromptText = text;
          }
        }
      } else if (innerType === "function_call") {
        const name = String(payload.name ?? "");
        if (!name) continue;
        out.toolCounts[name] = (out.toolCounts[name] ?? 0) + 1;
        // shell: legacy fixture name. exec_command / local_shell_call: current Codex.
        if (name === "shell" || name === "exec_command" || name === "local_shell_call") {
          out.bashCommands += 1;
          // Capture the actual command line. Codex stringifies args; parse and pull cmd.
          if (out.bashCommandsList.length < 50) {
            let cmd: string | null = null;
            const args = payload.arguments;
            if (typeof args === "string") {
              try {
                const parsed = JSON.parse(args);
                if (typeof parsed?.cmd === "string") cmd = parsed.cmd;
                else if (typeof parsed?.command === "string") cmd = parsed.command;
                else if (Array.isArray(parsed?.command)) cmd = parsed.command.join(" ");
              } catch {
                // ignore
              }
            } else if (args && typeof args === "object") {
              if (typeof (args as any).cmd === "string") cmd = (args as any).cmd;
              else if (typeof (args as any).command === "string") cmd = (args as any).command;
              else if (Array.isArray((args as any).command)) cmd = (args as any).command.join(" ");
            }
            if (cmd) out.bashCommandsList.push(cmd);
          }
        }
        if (name === "apply_patch") {
          let parsed: any = payload.arguments;
          if (typeof parsed === "string") {
            try {
              parsed = JSON.parse(parsed);
            } catch {
              parsed = null;
            }
          }
          const result = parseApplyPatch(parsed);
          for (const f of result.files) {
            if (!fileMap.has(f)) fileMap.set(f, { added: 0, removed: 0, editCount: 0 });
            fileMap.get(f)!.editCount += 1;
          }
          // Distribute additions/removals across all touched files (best-effort).
          // For simplicity, attribute totals to the first file when 1, or all proportionally.
          if (result.files.length === 1) {
            const acc = fileMap.get(result.files[0]!)!;
            acc.added += result.added;
            acc.removed += result.removed;
          } else if (result.files.length > 1) {
            for (const f of result.files) {
              const acc = fileMap.get(f)!;
              acc.added += Math.floor(result.added / result.files.length);
              acc.removed += Math.floor(result.removed / result.files.length);
            }
          }
        }
      } else if (innerType === "agent_reasoning") {
        const dur = Number(payload.duration_ms ?? 0);
        if (Number.isFinite(dur) && dur > 0) out.thinkingMs += dur;
      }
      continue;
    }

    if (type === "event_msg") {
      const innerType = payload.type;
      if (innerType === "token_count") {
        // Current Codex (>= ~0.125): cumulative totals nested under payload.info.total_token_usage.
        // Legacy fixture shape: top-level payload.input_tokens etc.
        const info = payload.info;
        const tot =
          info && typeof info === "object" && info.total_token_usage
            ? info.total_token_usage
            : info && typeof info === "object" && info.last_token_usage
              ? info.last_token_usage
              : null;
        if (tot && typeof tot === "object") {
          lastInput = Number(tot.input_tokens ?? lastInput);
          lastCachedInput = Number(tot.cached_input_tokens ?? lastCachedInput);
          lastOutput = Number(tot.output_tokens ?? lastOutput);
          lastReasoning = Number(tot.reasoning_output_tokens ?? lastReasoning);
        } else {
          lastInput = Number(payload.input_tokens ?? lastInput);
          lastCachedInput = Number(payload.cached_input_tokens ?? lastCachedInput);
          lastOutput = Number(payload.output_tokens ?? lastOutput);
          lastReasoning = Number(payload.reasoning_output_tokens ?? lastReasoning);
        }
      } else if (innerType === "user_message" && typeof payload.message === "string") {
        // Current Codex shape: real user prompt is event_msg/user_message with payload.message.
        const text = payload.message.trim();
        if (text.length > 0) {
          out.promptLengths.push(text.length);
          out.promptTexts.push(text);
          const tsStr = typeof evt.timestamp === "string" ? evt.timestamp : "";
          out.promptTimestamps.push(tsStr);
          if (!out.firstPrompt) out.firstPrompt = text;
          if (text.length > out.longestUserMsgChars) out.longestUserMsgChars = text.length;
          if (out.shortestPromptText === null || text.length < out.shortestPromptText.length) {
            out.shortestPromptText = text;
          }
        }
      }
    }
  }

  out.inputTokens = lastInput;
  out.cachedInputTokens = lastCachedInput;
  out.outputTokens = lastOutput;
  out.reasoningOutputTokens = lastReasoning;
  out.models = Array.from(modelSet);

  if (firstTs !== null && lastTs !== null) {
    out.startUtc = new Date(firstTs).toISOString();
    out.endUtc = new Date(lastTs).toISOString();
    out.durationMs = Math.max(0, lastTs - firstTs);
  }

  const fileEntries = Array.from(fileMap.entries())
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

  // v0.2 — politeness
  {
    const pol = scorePoliteness(out.promptTexts);
    out.politenessPlease = pol.please;
    out.politenessThanks = pol.thanks;
    out.politenessSorry = pol.sorry;
  }

  // v0.3 — correction count
  out.correctionCount = countCorrections(out.promptTexts);

  // v0.2 — longest solo-stretch
  if (out.promptTimestamps.length >= 2) {
    const tss = out.promptTimestamps.map((s) => Date.parse(s)).filter((n) => Number.isFinite(n));
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
