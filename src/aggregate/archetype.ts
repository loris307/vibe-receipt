import type { Archetype, ArchetypeKey, Receipt } from "../data/receipt-schema.js";
import type { NormalizedSession } from "../data/types.js";

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const FIXER_RE = /\b(fix|bug|broken|error|fail(?:ed|ing)?|crash|wrong|hak)/giu;
const FILE_PATH_RE =
  /(?:\/[\w.-]+){2,}|[A-Za-z][\w.-]+\/[\w./-]+|\b[\w.-]+\.(?:ts|tsx|js|jsx|py|rs|go|java|cs|cpp|c|md|json|yml|yaml|toml|sh|sql)\b/g;
const CODE_BLOCK_RE = /```/g;

function ratio(part: number, total: number): number {
  if (total <= 0) return 0;
  return part / total;
}

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) || []).length;
}

export interface ArchetypeFeatures {
  promptCount: number;
  avgPromptChars: number;
  promptsWithPath: number;
  promptsWithCodeBlock: number;
  promptsWithBugKeyword: number;
  toolTotal: number;
  readishTools: number; // Read + Grep + WebFetch + Glob
  editTools: number; // Edit + Write + MultiEdit
  bashTools: number;
  longestSoloMs: number;
  durationMs: number;
  escInterrupts: number;
  rateLimitHits: number;
  startHourLocal: number; // 0..23
}

export function extractFeatures(r: Receipt, ns: NormalizedSession): ArchetypeFeatures {
  const prompts = ns.promptTexts ?? [];
  let pPath = 0;
  let pCode = 0;
  let pBug = 0;
  for (const t of prompts) {
    if (typeof t !== "string") continue;
    if (countMatches(t, FILE_PATH_RE) > 0) pPath++;
    if (countMatches(t, CODE_BLOCK_RE) >= 2) pCode++; // pair = 1 block
    if (countMatches(t, FIXER_RE) > 0) pBug++;
  }
  const c = ns.toolCounts ?? {};
  const readish = (c.Read ?? 0) + (c.Grep ?? 0) + (c.WebFetch ?? 0) + (c.Glob ?? 0);
  const editish = (c.Edit ?? 0) + (c.Write ?? 0) + (c.MultiEdit ?? 0);
  // UTC-based hour for deterministic archetype assignment regardless of
  // which machine renders the receipt. The header also displays UTC time,
  // so this stays consistent.
  const utcHour = Number.parseInt(r.time.startUtc.slice(11, 13), 10);
  return {
    promptCount: r.personality.promptCount,
    avgPromptChars: r.personality.avgPromptChars,
    promptsWithPath: pPath,
    promptsWithCodeBlock: pCode,
    promptsWithBugKeyword: pBug,
    toolTotal: r.tools.total,
    readishTools: readish,
    editTools: editish,
    bashTools: c.Bash ?? 0,
    longestSoloMs: r.time.longestSoloStretchMs,
    durationMs: r.time.durationMs,
    escInterrupts: r.personality.escInterrupts,
    rateLimitHits: r.cost.rateLimitHits,
    startHourLocal: Number.isFinite(utcHour) ? utcHour : 12,
  };
}

function scoreSpecifier(f: ArchetypeFeatures): number {
  if (f.promptCount === 0) return 0;
  const lengthScore = clamp01((f.avgPromptChars - 200) / 400); // 200→0, 600→1
  const pathRate = ratio(f.promptsWithPath, f.promptCount);
  const pathScore = clamp01((pathRate - 0.2) / 0.4); // 0.2→0, 0.6→1
  return 0.6 * lengthScore + 0.4 * pathScore;
}

function scoreVibeCoder(f: ArchetypeFeatures): number {
  if (f.promptCount === 0) return 0;
  const shortScore = clamp01((100 - f.avgPromptChars) / 80); // 100→0, 20→1
  const codeRate = ratio(f.promptsWithCodeBlock, f.promptCount);
  const noCodeScore = 1 - clamp01(codeRate * 2); // 0% → 1, 50%+ → 0
  return 0.7 * shortScore + 0.3 * noCodeScore;
}

function scoreFixer(f: ArchetypeFeatures): number {
  if (f.promptCount === 0) return 0;
  const rate = ratio(f.promptsWithBugKeyword, f.promptCount);
  return clamp01((rate - 0.2) / 0.4); // 0.2→0, 0.6→1
}

function scoreResearcher(f: ArchetypeFeatures): number {
  if (f.toolTotal < 5) return 0;
  const r = ratio(f.readishTools, f.toolTotal);
  const e = ratio(f.editTools, f.toolTotal);
  const readScore = clamp01((r - 0.4) / 0.3);
  const editPenalty = 1 - clamp01(e / 0.3);
  return readScore * editPenalty;
}

function scoreFirefighter(f: ArchetypeFeatures): number {
  // weighted mix of friction signals
  const limits = clamp01(f.rateLimitHits / 5);
  const escs = clamp01(f.escInterrupts / 10);
  return clamp01((limits + escs) / 2);
}

function scoreTrustfall(f: ArchetypeFeatures): number {
  // No engagement at all → not "trustfall", just empty.
  if (f.promptCount === 0 || f.durationMs <= 0) return 0;
  const soloMin = f.longestSoloMs / 60_000;
  const soloScore = clamp01((soloMin - 1) / 4); // 1min→0, 5min→1
  const dMin = f.durationMs / 60_000;
  const interventionRate = f.promptCount / dMin;
  const lowInterv = 1 - clamp01(interventionRate / 2);
  return 0.7 * soloScore + 0.3 * lowInterv;
}

function scoreEscRager(f: ArchetypeFeatures): number {
  if (f.promptCount === 0) return 0;
  const rate = f.escInterrupts / f.promptCount;
  return clamp01((rate - 0.1) / 0.4); // 0.1→0, 0.5→1
}

function scoreNightOwl(f: ArchetypeFeatures): number {
  const h = f.startHourLocal;
  if (h >= 22 || h < 6) return 1;
  if (h === 21 || h === 6) return 0.5;
  return 0;
}

const PRIORITY: ArchetypeKey[] = [
  // tool-mix axis (most distinctive when applicable)
  "fixer",
  "researcher",
  // prompt-shape axis
  "specifier",
  "vibe-coder",
  // friction axis
  "firefighter",
  "trustfall-pilot",
  "esc-rager",
  // fallback time axis
  "night-owl",
];

export function scoreAllArchetypes(f: ArchetypeFeatures): Record<ArchetypeKey, number> {
  return {
    specifier: scoreSpecifier(f),
    "vibe-coder": scoreVibeCoder(f),
    fixer: scoreFixer(f),
    researcher: scoreResearcher(f),
    firefighter: scoreFirefighter(f),
    "trustfall-pilot": scoreTrustfall(f),
    "esc-rager": scoreEscRager(f),
    "night-owl": scoreNightOwl(f),
  };
}

export function pickArchetype(scores: Record<ArchetypeKey, number>): ArchetypeKey {
  const max = Math.max(...Object.values(scores));
  if (max <= 0) return "vibe-coder"; // safe default for empty/tiny sessions
  for (const key of PRIORITY) {
    if (scores[key] === max) return key;
  }
  return "vibe-coder";
}

export function deriveArchetype(r: Receipt, ns: NormalizedSession): Archetype {
  const f = extractFeatures(r, ns);
  const scores = scoreAllArchetypes(f);
  const key = pickArchetype(scores);
  // Round scores for storage (avoid 0.123456789 noise in JSON output)
  const rounded: Record<string, number> = {};
  for (const [k, v] of Object.entries(scores)) rounded[k] = Math.round(v * 1000) / 1000;
  return {
    key,
    taglineKey: `archetype.${key}.tagline`,
    scores: rounded,
  };
}
