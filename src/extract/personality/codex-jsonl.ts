import { readJsonlAll } from "../../util/jsonl.js";
import type { Subagent, TopFile } from "../../data/receipt-schema.js";

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
  topFiles: TopFile[];
  linesAdded: number;
  linesRemoved: number;
  bashCommands: number;

  toolCounts: Record<string, number>;
  subagents: Subagent[];

  thinkingMs: number;
  firstPrompt: string | null;
  shortestPromptText: string | null;
  longestUserMsgChars: number;
  promptLengths: number[];
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
    topFiles: [],
    linesAdded: 0,
    linesRemoved: 0,
    bashCommands: 0,
    toolCounts: {},
    subagents: [],
    thinkingMs: 0,
    firstPrompt: null,
    shortestPromptText: null,
    longestUserMsgChars: 0,
    promptLengths: [],
  };

  if (events.length === 0) return out;

  const fileMap = new Map<string, { added: number; removed: number }>();
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
      if (innerType === "user_message" && typeof payload.text === "string") {
        const text = payload.text.trim();
        if (text.length > 0) {
          out.promptLengths.push(text.length);
          if (!out.firstPrompt) out.firstPrompt = text;
          if (text.length > out.longestUserMsgChars) out.longestUserMsgChars = text.length;
          if (
            out.shortestPromptText === null ||
            text.length < out.shortestPromptText.length
          ) {
            out.shortestPromptText = text;
          }
        }
      } else if (innerType === "function_call") {
        const name = String(payload.name ?? "");
        if (!name) continue;
        out.toolCounts[name] = (out.toolCounts[name] ?? 0) + 1;
        if (name === "shell") out.bashCommands += 1;
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
            if (!fileMap.has(f)) fileMap.set(f, { added: 0, removed: 0 });
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
        lastInput = Number(payload.input_tokens ?? lastInput);
        lastCachedInput = Number(payload.cached_input_tokens ?? lastCachedInput);
        lastOutput = Number(payload.output_tokens ?? lastOutput);
        lastReasoning = Number(payload.reasoning_output_tokens ?? lastReasoning);
      }
      continue;
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
    .map(([path, p]) => ({ path, added: p.added, removed: p.removed }))
    .sort((a, b) => b.added + b.removed - (a.added + a.removed));
  out.filesTouched = fileEntries.map((f) => f.path);
  out.topFiles = fileEntries.slice(0, TOP_FILES_LIMIT);
  for (const f of fileEntries) {
    out.linesAdded += f.added;
    out.linesRemoved += f.removed;
  }

  return out;
}
