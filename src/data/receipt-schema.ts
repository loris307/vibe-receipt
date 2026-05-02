import * as v from "valibot";

export const SourceLiteral = v.union([v.literal("claude"), v.literal("codex")]);
export type Source = v.InferOutput<typeof SourceLiteral>;

export const ReceiptScopeSchema = v.union([
  v.object({ kind: v.literal("single"), sessionId: v.string() }),
  v.object({ kind: v.literal("combine-since"), since: v.string() }),
  v.object({ kind: v.literal("combine-branch"), branch: v.string() }),
  v.object({ kind: v.literal("combine-cwd"), cwd: v.string() }),
  v.object({ kind: v.literal("window-today") }),
  v.object({ kind: v.literal("window-week") }),
  v.object({ kind: v.literal("window-year"), year: v.number() }),
]);
export type ReceiptScope = v.InferOutput<typeof ReceiptScopeSchema>;

export const ToolStatSchema = v.object({
  name: v.string(),
  count: v.number(),
});
export type ToolStat = v.InferOutput<typeof ToolStatSchema>;

export const SubagentSchema = v.object({
  type: v.string(),
  durationMs: v.number(),
  totalTokens: v.number(),
  toolUseCount: v.number(),
});
export type Subagent = v.InferOutput<typeof SubagentSchema>;

export const TopFileSchema = v.object({
  path: v.string(),
  added: v.number(),
  removed: v.number(),
  editCount: v.optional(v.number()),
});
export type TopFile = v.InferOutput<typeof TopFileSchema>;

export const ArchetypeKeySchema = v.union([
  v.literal("specifier"),
  v.literal("vibe-coder"),
  v.literal("fixer"),
  v.literal("researcher"),
  v.literal("firefighter"),
  v.literal("trustfall-pilot"),
  v.literal("esc-rager"),
  v.literal("night-owl"),
]);
export type ArchetypeKey = v.InferOutput<typeof ArchetypeKeySchema>;

export const PolitenessSchema = v.object({
  please: v.number(),
  thanks: v.number(),
  sorry: v.number(),
  total: v.number(),
});
export type Politeness = v.InferOutput<typeof PolitenessSchema>;

export const MostEditedFileSchema = v.object({
  path: v.string(),
  editCount: v.number(),
  added: v.number(),
  removed: v.number(),
});
export type MostEditedFile = v.InferOutput<typeof MostEditedFileSchema>;

export const ArchetypeSchema = v.object({
  key: ArchetypeKeySchema,
  taglineKey: v.string(),
  scores: v.record(v.string(), v.number()),
});
export type Archetype = v.InferOutput<typeof ArchetypeSchema>;

export const VsLastSessionSchema = v.object({
  deltaTokensPct: v.number(),
  deltaCostPct: v.number(),
  deltaDurationPct: v.number(),
  sessionId: v.string(),
  recordedAt: v.string(),
});
export type VsLastSession = v.InferOutput<typeof VsLastSessionSchema>;

export const VsLast7DaysSchema = v.object({
  sessionsInWindow: v.number(),
  tokensRankInWindow: v.number(),
  longestSessionInWindow: v.boolean(),
  medianTokens: v.number(),
  medianCostUsd: v.number(),
});
export type VsLast7Days = v.InferOutput<typeof VsLast7DaysSchema>;

export const ComparisonSchema = v.object({
  vsLastSession: v.nullable(VsLastSessionSchema),
  vsLast7Days: v.nullable(VsLast7DaysSchema),
});
export type Comparison = v.InferOutput<typeof ComparisonSchema>;

export const AchievementSchema = v.object({
  key: v.string(),
  labelKey: v.string(),
  iconGlyph: v.string(),
});
export type Achievement = v.InferOutput<typeof AchievementSchema>;

export const ReceiptSchema = v.object({
  scope: ReceiptScopeSchema,
  generatedAt: v.string(),

  meta: v.object({
    project: v.string(),
    branch: v.nullable(v.string()),
    sources: v.array(SourceLiteral),
    sessionCount: v.number(),
    inFlight: v.optional(v.boolean()),
  }),

  time: v.object({
    startUtc: v.string(),
    endUtc: v.string(),
    durationMs: v.number(),
    activeMs: v.number(),
    afkMs: v.number(),
    afkRecaps: v.array(v.string()),
    longestSoloStretchMs: v.number(),
    longestSoloStretchStartUtc: v.nullable(v.string()),
    longestSoloStretchEndUtc: v.nullable(v.string()),
  }),

  cost: v.object({
    totalUsd: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cacheCreateTokens: v.number(),
    cacheReadTokens: v.number(),
    cacheHitRatio: v.number(),
    models: v.array(v.string()),
    rateLimitHits: v.number(),
    rateLimitWaitMs: v.number(),
    burnRatePeakTokensPerMin: v.number(),
    burnRatePeakWindowUtc: v.nullable(v.string()),
    costPerLineUsd: v.number(),
  }),

  work: v.object({
    filesTouched: v.number(),
    topFiles: v.array(TopFileSchema),
    linesAdded: v.number(),
    linesRemoved: v.number(),
    bashCommands: v.number(),
    webFetches: v.number(),
    userModified: v.number(),
    mostEditedFile: v.nullable(MostEditedFileSchema),
  }),

  tools: v.object({
    total: v.number(),
    top: v.array(ToolStatSchema),
  }),

  subagents: v.array(SubagentSchema),

  personality: v.object({
    escInterrupts: v.number(),
    permissionFlips: v.number(),
    yoloEvents: v.number(),
    thinkingMs: v.number(),
    skills: v.array(v.string()),
    slashCommands: v.array(v.string()),
    truncatedOutputs: v.number(),
    hookErrors: v.number(),
    longestUserMsgChars: v.number(),
    promptCount: v.number(),
    longestPromptChars: v.number(),
    shortestPromptChars: v.number(),
    avgPromptChars: v.number(),
    shortestPromptText: v.nullable(v.string()),
    waitThenGoCount: v.number(),
    politenessScore: PolitenessSchema,
  }),

  firstPrompt: v.object({
    wordCount: v.number(),
    charCount: v.number(),
    moodEmoji: v.string(),
    fingerprintSha: v.string(),
    preview: v.nullable(v.string()),
    revealed: v.nullable(v.string()),
  }),

  archetype: ArchetypeSchema,
  comparison: v.nullable(ComparisonSchema),
  achievements: v.array(AchievementSchema),
});
export type Receipt = v.InferOutput<typeof ReceiptSchema>;
