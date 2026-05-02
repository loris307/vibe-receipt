# vibe-receipt v0.2 — Masterplan

> **Scope:** 10 neue Stats integrieren, ohne v0.1.0-Verhalten zu brechen.
> **Bauweise:** Phasen sind dependency-geordnet aber jede ist self-contained.
> Jede Phase kann committed + released werden ohne die nächsten zu blockieren.

## Zielbild

Folgende 10 Stats werden hinzugefügt:

| # | Stat | Kategorie | Komplexität |
|---|---|---|---|
| 1 | Longest solo-stretch | time | low |
| 2 | Wait-then-go count | personality | medium |
| 3 | Politeness score | personality | low |
| 4 | Most-edited single file | work | low (datendurchgereicht) |
| 5 | Rate-limit hits | cost/friction | low |
| 6 | Cost per line shipped | cost (derived) | trivial |
| 7 | Burn rate peak | cost (rolling) | medium |
| 8 | Archetype (1 von 8) | identity | medium |
| 9 | vs last session + vs last 7 days | comparison | **high** (neue infra) |
| 10 | Achievement badges (0-3 conditional) | gamification | medium |

## Archetype-Auswahl (die 8)

Zwei Achsen pro Pärchen, ein Solo-Stat als Tiebreaker.

| Archetype | Rule (rough) | Tagline-Beispiel |
|---|---|---|
| **The Specifier** | avg prompt > 400 chars + ≥1 file path in >40% of prompts | "73% deiner Prompts hatten exakte Pfade" |
| **The Vibe-Coder** | avg prompt < 60 chars, no code blocks, mostly imperative | "21 Wörter im Schnitt. Du vertraust dem Modell" |
| **The Fixer** | "fix"/"bug"/"broken"/"error" regex in ≥40% of prompts | "62% deiner Prompts erwähnten einen Bug" |
| **The Researcher** | (Read + Grep + WebFetch) > 50% of tools, Edits < 15% | "13× gelesen, 2× geschrieben" |
| **The Firefighter** | error count high + ≥1 compaction + Bash retries | "12 errors überlebt" |
| **The Trustfall Pilot** | longest solo-stretch > 3min, low intervention rate | "Claude lief 4m12s solo, du hast vertraut" |
| **The ESC-Rager** | escInterrupts in top decile (relativ zur prompt count) | "11× ESC. Du hast Standards" |
| **The Night Owl** | session start hour ∈ [22,06] | "Session ab 02:14, andere schliefen" |

→ Algorithmus computed Score pro Archetype, höchster gewinnt. Tie-break per axis priority (Specifier/Vibe > Fixer/Researcher > Firefighter/Trustfall > ESC-Rager > Night Owl). Jede Session hat **immer** genau einen Archetype.

---

## Phase 1 — Schema-Foundation ✅ DONE

**Ziel:** alle neuen Felder im Schema, default-gefüllt, **noch keine** Extraktion. Schaltet alle weiteren Phasen frei zur parallelen Bearbeitung.

### Files

- `src/data/receipt-schema.ts` (extend)
- `src/data/types.ts` (extend `NormalizedSession`)
- `src/aggregate/single.ts` (default values)
- `src/aggregate/combine.ts` (merge logic)

### Schema-Erweiterungen

```ts
// receipt-schema.ts — neue Felder

time: {
  // ...existing
  longestSoloStretchMs: v.number(),       // NEW — phase 2a
  longestSoloStretchEvents: v.optional(v.object({
    startUtc: v.string(),
    endUtc: v.string(),
  })),
}

work: {
  // ...existing
  topFiles: v.array(TopFileSchema),       // EXTEND — add editCount
  mostEditedFile: v.nullable(v.object({
    path: v.string(),                     // basename if not revealed
    editCount: v.number(),
    added: v.number(),
    removed: v.number(),
  })),                                    // NEW — phase 2d
}

cost: {
  // ...existing
  rateLimitHits: v.number(),              // NEW — phase 3a
  rateLimitWaitMs: v.number(),            // NEW — phase 3a
  burnRatePeakTokensPerMin: v.number(),   // NEW — phase 3b
  burnRatePeakWindowUtc: v.optional(v.string()),
  costPerLineUsd: v.number(),             // NEW — phase 2c (derived)
}

personality: {
  // ...existing
  waitThenGoCount: v.number(),            // NEW — phase 3c
  politenessScore: v.object({             // NEW — phase 2b
    please: v.number(),
    thanks: v.number(),
    sorry: v.number(),
    total: v.number(),                    // sum of all 3 across all real prompts
  }),
}

archetype: v.object({                     // NEW — phase 6
  key: v.union([
    v.literal("specifier"),
    v.literal("vibe-coder"),
    v.literal("fixer"),
    v.literal("researcher"),
    v.literal("firefighter"),
    v.literal("trustfall-pilot"),
    v.literal("esc-rager"),
    v.literal("night-owl"),
  ]),
  taglineKey: v.string(),                 // i18n key, e.g. "archetype.fixer.tagline"
  scores: v.record(v.string(), v.number()), // all 8 raw scores (debug/JSON only)
}),

comparison: v.nullable(v.object({         // NEW — phase 5 — null if no history
  vsLastSession: v.nullable(v.object({
    deltaTokensPct: v.number(),           // signed, e.g. +0.21 = 21% more tokens
    deltaCostPct: v.number(),
    deltaDurationPct: v.number(),
    sessionId: v.string(),                // for debugging
    generatedAt: v.string(),
  })),
  vsLast7Days: v.nullable(v.object({
    sessionsInWindow: v.number(),
    tokensRankInWindow: v.number(),       // 1 = highest in window
    longestSessionInWindow: v.boolean(),  // is THIS session the longest in window?
    medianTokens: v.number(),
    medianCostUsd: v.number(),
  })),
})),

achievements: v.array(v.object({          // NEW — phase 7 — 0..3 entries
  key: v.string(),                        // e.g. "night-owl", "no-error-streak", "marathoner"
  labelKey: v.string(),                   // i18n
  iconGlyph: v.string(),                  // emoji or single char
})),
```

### Acceptance criteria

- [ ] `pnpm build` succeeds
- [ ] All existing tests still pass (55/55)
- [ ] `vibe-receipt --json` output contains all new fields with default values (0, [], null)
- [ ] Combine logic for new fields documented as TODO/no-op (will be filled phase-by-phase)

### Risiko

Sehr gering — nur Schema-Erweiterung mit defaults. Existing render code muss nichts ändern bis Phase 8.

---

## Phase 2 — Easy Stats (parallel implementierbar)

Diese 4 Stats brauchen keine neue Infrastruktur. Können in beliebiger Reihenfolge oder parallel.

### 2a — Longest solo-stretch ✅ DONE

**Definition:** Längste Lücke zwischen zwei aufeinanderfolgenden **realen** User-Prompts (nicht tool_results, nicht hooks).

**Files:**
- `src/extract/personality/claude-jsonl.ts` — emitting field
- `src/extract/personality/codex-jsonl.ts` — Codex equivalent
- `src/data/types.ts` — add `longestSoloStretchMs` zu `NormalizedSession`
- `src/aggregate/single.ts` — pipe through

**Computation:**
```ts
function computeLongestSolo(promptTimestamps: string[]): {
  ms: number;
  startUtc?: string;
  endUtc?: string;
} {
  if (promptTimestamps.length < 2) return { ms: 0 };
  const sorted = [...promptTimestamps].sort();
  let max = 0, maxStart, maxEnd;
  for (let i = 1; i < sorted.length; i++) {
    const gap = Date.parse(sorted[i]) - Date.parse(sorted[i-1]);
    if (gap > max) { max = gap; maxStart = sorted[i-1]; maxEnd = sorted[i]; }
  }
  return { ms: max, startUtc: maxStart, endUtc: maxEnd };
}
```

→ Existing prompt extractor schon filtert auf real-prompts; nur die timestamps mitemittieren.

**Combine logic:** für combine modes nimm das Maximum über alle Sessions (NICHT Summe!). Tagline darf andere Session referenzieren.

**Tests:**
- Gap berechnung mit 0/1/2/N prompts
- ISO timestamp parsing edge cases (UTC vs local)
- single session vs combined

**Acceptance:** `--json` zeigt `time.longestSoloStretchMs`. Real session test: passt mit "Coffee-Break"-Erwartung.

---

### 2b — Politeness score ✅ DONE

**Definition:** Count von "please/thanks/sorry" (+ DE: "bitte/danke/entschuldigung") über alle realen User-Prompts. Case-insensitive, word-boundary.

**Files:**
- `src/extract/personality/claude-jsonl.ts` — analyze prompts (gleiche Stelle wo wir promptLengths zählen)
- `src/extract/personality/codex-jsonl.ts` — same
- `src/aggregate/single.ts`

**Computation:**
```ts
const PATTERNS = {
  please: /\b(please|bitte|s'il te plaît|por favor)\b/gi,
  thanks: /\b(thanks?|thank you|danke|merci|gracias|cheers)\b/gi,
  sorry:  /\b(sorry|sry|entschuldigung|sorry?'?\s)\b/gi,
};
function score(prompts: string[]) {
  let p=0,t=0,s=0;
  for (const text of prompts) {
    p += (text.match(PATTERNS.please) || []).length;
    t += (text.match(PATTERNS.thanks) || []).length;
    s += (text.match(PATTERNS.sorry) || []).length;
  }
  return { please: p, thanks: t, sorry: s, total: p + t + s };
}
```

→ User-Prompt-Texte werden bereits extrahiert (für `shortestPromptText`). Nur jetzt in einer 2nd-pass auch durchscannen.

**Privacy:** keine Prompt-Inhalte leaken — nur Counts. Kein `--reveal` Flag nötig.

**Combine logic:** Summe über Sessions.

**Tests:**
- "please please thanks" → {p:2, t:1, s:0, total:3}
- "Sorry, do you mind?" → {p:0, t:0, s:1, total:1}
- false positives: "thanks-test.ts" must NOT match (word boundary)
- DE: "Danke!" → thanks:1
- empty prompts → all zeros

**Acceptance:** `--json` zeigt `personality.politenessScore`. Real session test.

---

### 2c — Cost per line shipped (derived) ✅ DONE

**Definition:** `totalUsd / max(1, linesAdded - linesRemoved)`. Wenn delta ≤ 0 → null/0.

**Files:**
- `src/aggregate/single.ts` (and `combine.ts`)

**Computation:**
```ts
const netLines = ns.linesAdded - ns.linesRemoved;
const costPerLineUsd = netLines > 0 ? ns.totalCostUsd / netLines : 0;
```

**Combine logic:** über summierte costs / summierte netLines.

**Tests:** trivial — 3-4 cases (positive net, zero net, negative net, zero cost).

**Acceptance:** Receipt JSON enthält `cost.costPerLineUsd`. Display: `$0.04/line`.

---

### 2d — Most-edited single file ✅ DONE

**Definition:** das File mit dem höchsten **Edit-Count** (nicht lines added — count der Tool-Aufrufe). Edit/Write/MultiEdit zählen als 1 edit pro Aufruf.

**Files:**
- `src/extract/claude.ts` — `fileEntries` extension: add `editCount`
- `src/data/receipt-schema.ts` — extend `TopFileSchema`
- `src/aggregate/single.ts` — derive `mostEditedFile`

**Schema-Erweiterung:**
```ts
TopFileSchema = v.object({
  path: v.string(),
  added: v.number(),
  removed: v.number(),
  editCount: v.number(),         // NEW
});
```

**Computation:** wo immer wir aktuell `topFiles` aufbauen (in extract/claude.ts), zählen wir auch wieviele tool_uses pro Datei. → `Map<filePath, {added, removed, editCount}>`.

→ Aggregator: `mostEditedFile = topFiles.sort((a,b) => b.editCount - a.editCount)[0]`. Wenn alle ===1 → fallback auf `null` (uninteressant).

**Smart-redact:** path → basename wenn `--reveal=paths` not set (existing behavior für topFiles).

**Combine logic:** merge fileEntries by path summing all 3 fields, then re-pick `mostEditedFile`.

**Tests:**
- session with 9× edit on same file → mostEditedFile.editCount=9
- 1 edit each on 3 files → mostEditedFile=null
- combine 2 sessions both editing api.ts → editCount summed

**Acceptance:** Receipt JSON zeigt `work.mostEditedFile`. Display: `api.ts · edited 9× · +124/-31`.

---

## Phase 3 — New JSONL signals

### 3a — Rate-limit hits ✅ DONE

**Definition:** Count von `system.subtype === "api_error"` events mit `error.error.type === "rate_limit_error"`. Sum über `error.retryInMs`.

**Files:**
- `src/extract/claude.ts` (or `personality/claude-jsonl.ts`) — neuer events handler
- Codex: skip (Codex JSONLs haben anderes error format — log warning, default 0)

**Computation:**
```ts
let hits = 0, waitMs = 0;
for (const e of events) {
  if (e.type === "system" && e.subtype === "api_error" &&
      e.error?.error?.type === "rate_limit_error") {
    hits++;
    waitMs += e.error?.retryInMs ?? 0;
  }
}
```

**Combine logic:** Summe.

**Tests:**
- session ohne rate-limits → 0/0
- 2× rate-limit mit 5s + 3s wait → hits:2, waitMs:8000
- malformed event mit fehlendem `retryInMs` → zählt als hit, +0ms

**Acceptance:** `--json` zeigt `cost.rateLimitHits` und `cost.rateLimitWaitMs`.

---

### 3b — Burn-rate peak ✅ DONE

**Definition:** Max(tokens-per-minute) über die Session. Bin assistant message tokens (input+output) in 60-Sekunden-Windows nach `timestamp`. Output: peak window's value + window-start UTC.

**Files:**
- `src/extract/claude.ts` — sammelt `[timestamp, totalTokensThisMessage]` Liste
- `src/aggregate/single.ts` oder neue helper `src/aggregate/burn-rate.ts`

**Computation:**
```ts
function computeBurnRatePeak(events: {ts:number, tokens:number}[]): {tpm:number, windowStartUtc?:string} {
  if (events.length === 0) return { tpm: 0 };
  const sorted = [...events].sort((a,b) => a.ts - b.ts);
  const windowMs = 60_000;
  let peak = 0, peakStart = sorted[0].ts;
  // sliding window — for each event, count tokens in [ts-60s, ts]
  let left = 0, sum = 0;
  for (let r = 0; r < sorted.length; r++) {
    sum += sorted[r].tokens;
    while (sorted[r].ts - sorted[left].ts > windowMs) {
      sum -= sorted[left].tokens;
      left++;
    }
    if (sum > peak) { peak = sum; peakStart = sorted[left].ts; }
  }
  return { tpm: peak, windowStartUtc: new Date(peakStart).toISOString() };
}
```

**Tokens definition:** `inputTokens + outputTokens + cacheCreateTokens` aus `message.usage`. **NICHT** cacheRead (das wäre eher "consumed cache" — discuss).

**Combine logic:** für combine: berechne global über alle events aller Sessions (nicht max der per-session-peaks — sonst niedriger Wert).

**Tests:**
- 0 events → 0
- 100 tokens spread over 5 minutes → peak ≈ 100 (one event in any 60s window)
- 5 events à 50 tokens within 30s → peak = 250
- 60s+1s gap → peaks separately

**Acceptance:** `--json` zeigt `cost.burnRatePeakTokensPerMin`. Real session test: peak makes sense vs duration.

---

### 3c — Wait-then-go count ✅ DONE

**Definition:** Anzahl der User-Prompts, die geschickt wurden während Claude noch arbeitete (also vor dem nächsten `stop_reason === "end_turn"` der Antwort).

**Files:**
- `src/extract/personality/claude-jsonl.ts`
- Codex: skip oder approximieren

**Heuristic (v1, robust genug):**
Iteriere events chronologisch. Track `inFlight = false`. 
- assistant message mit `stop_reason !== "end_turn"` (e.g. "tool_use") → `inFlight = true`
- assistant message mit `stop_reason === "end_turn"` → `inFlight = false`
- system event with subtype `compact_boundary` → `inFlight = false`
- user-prompt-event (real, nicht tool_result) während `inFlight === true` → `waitThenGoCount++`

**Edge cases:**
- ESC-Interrupt: User cancels — der nachfolgende prompt sollte NICHT als wait-then-go zählen. → if previous event in tool_results is `interrupted: true`, set `inFlight=false` first.
- Background tasks: ignore for v1.

**Combine logic:** Summe.

**Tests:**
- linearer ablauf (user → assistant end → user) → 0
- user → assistant tool_use → user prompt eingeflogen → 1
- user → assistant tool_use → ESC → user → 0
- 3× wait-then-go in einer session → 3

**Acceptance:** `--json` zeigt `personality.waitThenGoCount`. Real session test on bekannte impulsive Sessions.

---

## Phase 4 — History store (new infra) ✅ DONE

> **Critical Path** — alle nachfolgenden Comparison-Stats hängen daran.

### Ziel

Persistente Liste aller jemals gerenderten Sessions, lokal in `~/.vibe-receipt/history.jsonl`. Jede Zeile ist ein kompakter Snapshot — keine Receipt-Vollkopie, nur was wir für Comparisons brauchen.

### Files (neu)

- `src/history/store.ts` — read/write/append
- `src/history/record.ts` — `recordSessionSnapshot(receipt, ...)` 
- `src/history/types.ts` — `SessionHistoryEntry` interface
- `src/cli.ts` — call recordSessionSnapshot nach jedem render
- Neue CLI-Subcommands:
  - `vibe-receipt history list [--limit N]` — print entries als table
  - `vibe-receipt history clear` — delete file (with prompt)
  - `vibe-receipt history export` — print full file

### Existing hook integration

`vibe-receipt install-hook` schreibt aktuell schon `~/.vibe-receipt/index.jsonl` (laut summary). 
**Decision:** umbenennen zu `~/.vibe-receipt/history.jsonl` und unifizieren. Migration: wenn `index.jsonl` existiert beim ersten Start, append nach `history.jsonl` und leave alone (don't delete — user may have older versions).

### Schema

```ts
interface SessionHistoryEntry {
  schemaVersion: 1;
  recordedAt: string;             // ISO8601
  sessionId: string;
  source: "claude" | "codex";
  project: string;                // basename — already redacted
  branch: string | null;          // already redacted
  startUtc: string;
  endUtc: string;
  durationMs: number;
  activeMs: number;
  totalUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalTokens: number;            // input + output + cacheCreate (matches burn-rate def)
  filesTouched: number;
  linesAdded: number;
  linesRemoved: number;
  toolCount: number;
  promptCount: number;
  archetype?: string;             // populated phase 6+
  models: string[];
}
```

### Behavior

- **Idempotent:** wenn (sessionId + source) schon existiert → in-place update statt append. Verhindert duplicate entries when user re-renders the same session.
- **Atomic write:** read + replace via `tmpfile + rename`. Concurrent runs sind selten aber möglich.
- **Cap:** keine size-cap erst (jsonl bleibt klein). Wenn future need: "keep last N=10000".
- **Privacy:** **immer** redacted form geschrieben (basename project, first-segment branch). Reveal flags affecten nur das Receipt-output, nie history.

### Opt-out

`VIBE_RECEIPT_NO_HISTORY=1` env var → skip recording. Document in README.

### Acceptance

- [ ] `vibe-receipt` 3× hintereinander → 3 entries (oder 1 entry wenn gleiche session, idempotent)
- [ ] history file is valid JSONL
- [ ] schema version field set
- [ ] `vibe-receipt history list --limit 5` zeigt schöne table
- [ ] `VIBE_RECEIPT_NO_HISTORY=1 vibe-receipt` schreibt nichts

### Tests

- read/write round-trip
- idempotent update
- malformed line in file (corrupt) → skip + warn, don't crash
- concurrent write simulation (probably skip — file locking is OS-specific)

### Risiko

Medium — neue Infra, neue Filesystem-Interaktionen. Gut isoliert in `src/history/`. Kein bestehender Code muss ändern.

---

## Phase 5 — Comparisons (vs last session, vs last 7 days) ✅ DONE

**Depends on Phase 4.**

### Files

- `src/aggregate/comparisons.ts` — derives `Receipt.comparison` from history + current receipt
- `src/aggregate/single.ts` — invoke comparisons after building receipt

### Algorithm

```ts
function deriveComparison(current: Receipt, history: SessionHistoryEntry[]) {
  const sameSource = history.filter(h => h.source === current.meta.sources[0])
                            .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  
  // vs last session
  const lastSession = sameSource.find(h => h.sessionId !== getCurrentSessionId(current));
  const vsLast = lastSession ? {
    deltaTokensPct: pctDelta(currentTokens, lastSession.totalTokens),
    deltaCostPct:   pctDelta(current.cost.totalUsd, lastSession.totalUsd),
    deltaDurationPct: pctDelta(current.time.durationMs, lastSession.durationMs),
    sessionId: lastSession.sessionId,
    generatedAt: lastSession.recordedAt,
  } : null;
  
  // vs last 7 days (rolling, not calendar week)
  const sevenDaysAgo = Date.now() - 7 * 86400_000;
  const inWindow = sameSource.filter(h => Date.parse(h.recordedAt) >= sevenDaysAgo);
  if (inWindow.length === 0) return { vsLastSession: vsLast, vsLast7Days: null };
  
  const sorted = inWindow.slice().sort((a, b) => b.totalTokens - a.totalTokens);
  const tokensRank = sorted.findIndex(h => h.sessionId === currentSessionId) + 1;
  const longest = inWindow.reduce((a, b) => a.durationMs > b.durationMs ? a : b);
  
  return {
    vsLastSession: vsLast,
    vsLast7Days: {
      sessionsInWindow: inWindow.length,
      tokensRankInWindow: tokensRank > 0 ? tokensRank : inWindow.length + 1,
      longestSessionInWindow: longest.sessionId === currentSessionId,
      medianTokens: median(inWindow.map(h => h.totalTokens)),
      medianCostUsd: median(inWindow.map(h => h.totalUsd)),
    },
  };
}
```

### Edge cases

- **First-ever session:** comparison = null → render skips section silently (no error).
- **Combine mode:** comparison disabled (apples-to-oranges). Set `comparison = null`.
- **Codex first, then Claude:** compare per-source. No cross-source.
- **In-flight session:** record AFTER receipt build so current session doesn't show up in its own "last 7 days" set.

### Display teaser (Phase 8 baut full)

JSON-only in this phase. Render kommt später.

### Tests

- 0 history entries → null
- 1 entry (= current) → vsLastSession=null, vsLast7Days={sessionsInWindow:1, ...}
- 5 entries spanning 14 days → window cuts to 7-day subset
- combine mode → comparison=null

### Acceptance

`--json` output zeigt comparison bei zweiter+ Session-Auswertung. Werte verifiziert manuell.

---

## Phase 6 — Archetype

**Depends on Phases 2 + 3.** (Specifier braucht prompt-stats, Researcher braucht tool-counts, Trustfall braucht longest-solo, etc.)

### Files (neu)

- `src/aggregate/archetype.ts` — scoring + selector
- `src/aggregate/single.ts` — invoke
- `src/i18n/en.ts` + `src/i18n/de.ts` — 8 archetype name + tagline keys

### Algorithm

```ts
type ArchetypeKey = "specifier" | "vibe-coder" | "fixer" | "researcher" |
                    "firefighter" | "trustfall-pilot" | "esc-rager" | "night-owl";

function scoreArchetypes(r: Receipt, ns: NormalizedSession): Record<ArchetypeKey, number> {
  // each scorer returns 0..1
  return {
    "specifier":         scoreSpecifier(r, ns),
    "vibe-coder":        scoreVibeCoder(r, ns),
    "fixer":             scoreFixer(r, ns),
    "researcher":        scoreResearcher(r, ns),
    "firefighter":       scoreFirefighter(r, ns),
    "trustfall-pilot":   scoreTrustfall(r, ns),
    "esc-rager":         scoreEscRager(r, ns),
    "night-owl":         scoreNightOwl(r, ns),
  };
}
```

### Scorer-Defs

Alle returnen `clamp01(...)`. Bei "kein-signal" → 0 (nicht 0.5).

```ts
function scoreSpecifier(r, ns) {
  // avg prompt > 400 chars + ≥1 file path in >40% of prompts
  const lengthScore = clamp01((r.personality.avgPromptChars - 200) / 400);  // 200→0, 600→1
  const pathRate = countPromptsWithPath(ns.allPromptTexts) / Math.max(1, r.personality.promptCount);
  const pathScore = clamp01((pathRate - 0.2) / 0.4);  // 0.2→0, 0.6→1
  return 0.6 * lengthScore + 0.4 * pathScore;
}

function scoreVibeCoder(r, ns) {
  const shortScore = clamp01((100 - r.personality.avgPromptChars) / 80);  // 100→0, 20→1
  const noCodeScore = 1 - clamp01(countPromptsWithCodeBlock(ns) / Math.max(1, r.personality.promptCount));
  return 0.7 * shortScore + 0.3 * noCodeScore;
}

function scoreFixer(r, ns) {
  const buggy = /\b(fix|bug|broken|error|fail|crash|wrong)\b/gi;
  const matches = ns.allPromptTexts.filter(t => buggy.test(t)).length;
  const rate = matches / Math.max(1, r.personality.promptCount);
  return clamp01((rate - 0.2) / 0.4);
}

function scoreResearcher(r, ns) {
  const counts = ns.toolCounts;
  const research = (counts.Read || 0) + (counts.Grep || 0) + (counts.WebFetch || 0) + (counts.Glob || 0);
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  if (total < 5) return 0;
  const rate = research / total;
  const editRate = (counts.Edit || 0) / total;
  return clamp01((rate - 0.4) / 0.3) * (1 - clamp01(editRate / 0.3));
}

function scoreFirefighter(r, ns) {
  const errorSignal = clamp01(r.cost.rateLimitHits / 5)                    // 5+ hits = 1
                     + clamp01(countCompactions(ns) / 3)                    // 3+ compacts = 1
                     + clamp01(r.personality.escInterrupts / 10);           // 10+ esc = 1
  return clamp01(errorSignal / 2);  // soft mix
}

function scoreTrustfall(r, ns) {
  // long solo + low intervention rate
  const soloMin = r.time.longestSoloStretchMs / 60000;
  const soloScore = clamp01((soloMin - 1) / 4);  // 1min→0, 5min→1
  const interventionRate = r.personality.promptCount / Math.max(1, r.time.durationMs / 60000);
  const lowInterv = 1 - clamp01(interventionRate / 2);  // 2 prompts/min → 0
  return 0.7 * soloScore + 0.3 * lowInterv;
}

function scoreEscRager(r, ns) {
  // top-decile interrupts relative to prompt count
  const rate = r.personality.escInterrupts / Math.max(1, r.personality.promptCount);
  return clamp01((rate - 0.1) / 0.4);  // 0.1→0, 0.5→1
}

function scoreNightOwl(r, ns) {
  // session start hour in [22, 06] (local)
  const hour = new Date(r.time.startUtc).getHours();  // local time of host
  if (hour >= 22 || hour < 6) return 1;
  if (hour === 21 || hour === 6) return 0.5;
  return 0;
}
```

### Selector

Tie-break ordered by axis priority:
```ts
const PRIORITY: ArchetypeKey[] = [
  "fixer", "researcher",        // tool-mix axis (most distinctive when applicable)
  "specifier", "vibe-coder",    // prompt-shape axis
  "firefighter", "trustfall-pilot",
  "esc-rager",
  "night-owl",                  // fallback time axis
];

function pickArchetype(scores: Record<ArchetypeKey, number>): ArchetypeKey {
  const max = Math.max(...Object.values(scores));
  if (max === 0) return "vibe-coder";  // safe default
  for (const key of PRIORITY) {
    if (scores[key] === max) return key;
  }
  return "vibe-coder";
}
```

### i18n-Strings (Phase 8 implementiert die ANZEIGE)

```ts
// en.ts
archetype: {
  specifier:        { name: "THE SPECIFIER",        tagline: "{n}% of your prompts had explicit paths" },
  vibeCoder:        { name: "THE VIBE-CODER",       tagline: "{n} chars per prompt — you trusted the model" },
  fixer:            { name: "THE FIXER",            tagline: "{n}% of your prompts mentioned a bug" },
  researcher:       { name: "THE RESEARCHER",       tagline: "{r} reads, {e} edits — recon mode" },
  firefighter:      { name: "THE FIREFIGHTER",      tagline: "you survived {n} errors" },
  trustfallPilot:   { name: "THE TRUSTFALL PILOT",  tagline: "claude ran {d} solo — you trusted" },
  escRager:         { name: "THE ESC-RAGER",        tagline: "{n}× ESC — you have standards" },
  nightOwl:         { name: "THE NIGHT OWL",        tagline: "session at {hh}:{mm} — others were asleep" },
}
```

### Tests

- session with avgPrompt=600, all paths → specifier wins
- empty session (no prompts) → defaults to vibe-coder
- tie between fixer & researcher → fixer wins (priority)
- night-owl @ 02:14 → matches even if other scores moderate
- snapshot test against 5 real fixture sessions

### Acceptance

`--json` zeigt `archetype` immer. Manual review on 10 real sessions: assignments fühlen sich korrekt an.

### Risiko

Medium. Scoring-Formeln sind opinionated und brauchen Tuning auf real corpus. **Nach Phase 6 sollte ein audit-script alle eigenen JSONLs durchscannen und die Verteilung der Archetypes loggen** — wenn 80% in einer Kategorie landen, Schwellen anpassen.

---

## Phase 7 — Achievement badges

**Depends on Phases 2-6.**

### Definition

Pro Receipt: 0..3 Badges. Conditional auf thresholds. Sortiert by rarity (bonusartiger sticker-vibe).

### Files (neu)

- `src/aggregate/achievements.ts`
- `src/i18n/{en,de}.ts` — labels
- `src/aggregate/single.ts` — invoke

### Catalog (Initial 12 — pick top 3)

```ts
const ACHIEVEMENTS: AchievementRule[] = [
  // rarity ordered descending — rarer first
  { key: "token-millionaire",  glyph: "🏆", trigger: r => r.cost.inputTokens + r.cost.outputTokens > 1_000_000 },
  { key: "big-spender",        glyph: "💸", trigger: r => r.cost.totalUsd > 5 },
  { key: "marathoner",         glyph: "🏃", trigger: r => r.time.durationMs > 2*3600_000 },  // 2h+
  { key: "auto-pilot",         glyph: "🤝", trigger: r => r.time.longestSoloStretchMs > 5*60_000 },
  { key: "deep-thinker",       glyph: "🧠", trigger: r => r.personality.thinkingMs > 0.5 * (r.time.activeMs || 1) },
  { key: "no-error-streak",    glyph: "🔥", trigger: r => r.cost.rateLimitHits === 0 && r.personality.escInterrupts === 0 && r.time.durationMs > 30*60_000 },
  { key: "sprinter",           glyph: "⚡", trigger: r => r.time.durationMs < 15*60_000 && r.tools.total > 30 },
  { key: "toolbox-master",     glyph: "🛠", trigger: r => r.tools.top.length >= 7 },  // assumes top expanded later
  { key: "night-owl",          glyph: "🌙", trigger: r => { const h = new Date(r.time.startUtc).getHours(); return h >= 22 || h < 6; } },
  { key: "researcher",         glyph: "📚", trigger: r => /* same logic as archetype scoreResearcher >= 0.5 */ },
  { key: "bug-hunter",         glyph: "🐛", trigger: r => /* fixer score >= 0.5 */ },
  { key: "polite",             glyph: "🙏", trigger: r => r.personality.politenessScore.total >= 5 },
];
```

### Selector

```ts
function pickAchievements(r: Receipt): Achievement[] {
  return ACHIEVEMENTS
    .filter(a => a.trigger(r))
    .slice(0, 3)              // max 3 — "rarer first" because catalog is rarity-ordered
    .map(a => ({
      key: a.key,
      labelKey: `achievement.${a.key}.label`,
      iconGlyph: a.glyph,
    }));
}
```

### Tests

- session > 1M tokens → "token-millionaire" first
- session matching 5 triggers → only top 3 returned (rarer wins)
- session matching 0 → empty array
- snapshot tests on real fixtures

### Acceptance

`--json` zeigt `achievements` (0..3 entries). Real session test: badges machen Sinn.

---

## Phase 8 — Render + i18n + Smart-redact

> **Depends on all prior phases.** Macht alles sichtbar im PNG/ANSI.

### Files

- `src/render/card.tsx` — neue sections + per-stat slots
- `src/render/ansi.ts` — terminal preview parity
- `src/render/sizes.ts` — `estimateReceiptHeight` updaten für neue rows
- `src/i18n/en.ts` + `src/i18n/de.ts` — labels
- `src/redact/smart-redact.ts` — `mostEditedFile.path` wie bestehende topFiles

### Layout-Decisions

- **Archetype-Stamp:** ganz unten als faux-rubber-stamp, gedreht 4-6°. Single line: `[ THE FIXER ]` + tagline darunter klein. **Hervorgehoben — DAS ist der Sharing-Hebel.**
- **Achievement-Badges:** neue Section "BADGES" ABOVE archetype, 0..3 emoji + label. Wenn empty: skip section.
- **vs-Last-Session-Line:** kleine fine-print italic UNTER der `cost`-Zeile. "tokens 2.1× last session".
- **vs-7-Days:** in PROMPTING section: "rank: 2 of 6 sessions this week".
- **Most-edited-file:** integriert in WORK section nach `topFiles`. New label: "MOST EDITED   api.ts · 9× · +124/-31".
- **Cost/line:** neue row in cost section: "$/LINE   $0.04" (skip if 0/null).
- **Burn-rate-peak:** "PEAK   12.3k tok/min" — neue row in cost section.
- **Rate-limit-hits:** in COST section ALS WARNING-row WENN >0: "RATE LIMITS   2 hits · 47s waited". Skip if 0.
- **Politeness-score:** klein in PROMPTING fine-print: "manners: 9× please / 4× thanks".
- **Wait-then-go:** in PERSONALITY: "wait-then-go: 5× — impulsive".
- **Longest-solo:** in TIME section: "longest solo: 4m12s".

### Size auto-extension

`src/render/sizes.ts` `estimateReceiptHeight`: pro neuer Row +36px, neue Section header +50px. Re-tune gegen real heavy session.

### i18n Maps

Add ~25 new keys to `en.ts` und `de.ts`. Naming:
- `archetype.{key}.name` / `archetype.{key}.tagline`
- `achievement.{key}.label`
- `time.longestSolo`
- `cost.rateLimits` / `cost.peakBurn` / `cost.perLine`
- `work.mostEdited`
- `personality.waitThenGo` / `personality.politeness`
- `comparison.vsLastSession` / `comparison.vsLast7Days`

DE-Variante wie bisher (siehe v0.1 i18n als Referenz).

### Smart-redact

`mostEditedFile.path` → basename when `--reveal=paths` not set.
Burn-rate-peak window timestamp: kein Privacy-issue (UTC-only).
Comparison sessionId in JSON only, nicht im PNG.

### ANSI preview parity

Jede neue Render-Zeile muss auch in `ansi.ts` erscheinen — sonst leakt im PNG was im Preview nicht zu sehen war (privacy-leak).

### Tests

- Snapshot test of full PNG + ANSI for a "richest" fixture session that triggers ALL features
- Snapshot test for "empty" fixture (newly-created session, 1 prompt, no tools) — shouldn't crash, gracefully skip empty sections

### Acceptance

- [ ] vibe-receipt renders for 5 real sessions — visual review passes
- [ ] ANSI preview matches PNG content
- [ ] Story (1080×1920) and OG (1200×630) sizes still fit (OG: archetype + 1 badge max)
- [ ] DE rendering check
- [ ] No clipping at portrait auto-extend on heaviest session

### Risiko

Medium-High. Layout-Tetris ist fragil. Buffer: nach Phase 8 könnte ein 2nd-iteration sprint nötig sein für Tuning.

---

## Phase 9 — Tests + Audit + README

### Per-stat unit tests

Jede neue Stat: ≥3 unit tests (zero, normal, edge).

### Integration test

Single fixture session in `test/fixtures/full-feature.jsonl` — synthetic, triggers ALL new fields. Snapshot the receipt JSON.

### Audit-script update

`/tmp/audit.py` (oder neu in `scripts/audit.ts`): erweitern um die 10 neuen Stats. Verifies ratios=1.0000 vs raw JSONL.

### README update

- New section "What's new in v0.2"
- Document `VIBE_RECEIPT_NO_HISTORY` env var
- New CLI subcommands: `vibe-receipt history list/clear/export`
- Update screenshot in `docs/images/hero.png` once Phase 8 lands
- Update Roadmap: v0.2 ✓, v1.0 next

### Tag + release

- bump `package.json` to 0.2.0
- git tag v0.2.0
- Update Codex/Claude data-source dependency notes if anything new

---

## Reihenfolge / Critical Path

```
Phase 1 (schema) ─┬─> Phase 2 (easy stats) ─┐
                  ├─> Phase 3 (jsonl signals) ┐
                  └─> Phase 4 (history) ─> Phase 5 (comparisons) ─┐
                                                                  ├─> Phase 8 (render) ─> Phase 9 (tests/release)
                            Phase 2+3 ─────> Phase 6 (archetype) ─┤
                            Phase 2-6 ─────> Phase 7 (badges)    ─┘
```

**Empfohlene Reihenfolge fürs schrittweise Abarbeiten:**

1. **Phase 1** (1-2 commits) — schema foundation
2. **Phase 2a + 2b + 2c + 2d** (4-6 commits, 1 pro stat) — easy wins  
3. **Phase 3a + 3b + 3c** (3-5 commits)
4. **Phase 4** (3-4 commits) — history infra (test thoroughly)
5. **Phase 5** (2-3 commits) — comparisons
6. **Phase 6** (3-5 commits) — archetype + audit-tuning
7. **Phase 7** (1-2 commits) — badges
8. **Phase 8** (5-10 commits, layout iteration)
9. **Phase 9** (1-2 commits) — release

Geschätzter Gesamtumfang: 25-40 commits. Phasen 1-3 könnten in einem Tag laufen, Phase 4-5 ein Tag, Phasen 6-7 ein Tag, Phase 8 ein Tag mit Tuning, Phase 9 ein halber Tag.

---

## Was NICHT in v0.2 reinkommt (bewusst)

- Globale Comparison (Viberank-Style) — opt-in, Spec für v1.1
- LLM-generated personalized roast/hype lines — Anti-Pattern (siehe Wrapped 2024)
- Receipt-format Satire (TIP/TAX-Lines) — geile Idee, aber separater Layout-Sprint, in v1.1
- Per-tool failure rate breakdown
- File-type pie chart
- Mood/Aura color derivation
- "Repo Twin" matching

Diese landen alle in v1.1+ als separate Specs.

---

## Open Questions (vor Phase 1 entscheiden)

1. **Tokens-Definition für burn-rate-peak:** input+output+cacheCreate, oder nur output? → vorgeschlagen: alle 3 (matcht ccusage). Decide before Phase 3b.
2. **History format:** JSONL pro Source separat (`history.claude.jsonl`, `history.codex.jsonl`) oder kombiniert mit `source` field? → vorgeschlagen: kombiniert, source als field. Simpler.
3. **Archetype für combine-modes:** computed pro session und most-frequent? Oder pro receipt-aggregate? → vorgeschlagen: pro aggregate (treat combine als virtual session). Decide before Phase 6.
4. **Achievement display when 0 triggered:** skip section completely, oder zeige "—"? → vorgeschlagen: skip section. Decide Phase 7.
5. **Archetype display für combine modes:** anders labelled? "across 5 sessions: THE FIXER"? → ja.

---

## Done = ?

v0.2 ist done wenn:
- [ ] alle 10 Stats sichtbar im PNG für eine reale heavy session
- [ ] alle 10 Stats korrekt für eine reale leichte session (oder graceful skip)
- [ ] ANSI preview = PNG content
- [ ] EN + DE i18n
- [ ] history file growing on every render
- [ ] vs-last-session shows up on 2nd session
- [ ] vs-last-7-days shows up on 8th-or-later session
- [ ] all original 55 tests still pass + ≥30 new tests for new stats
- [ ] audit script verifies all 10 new stats vs raw JSONLs
- [ ] README updated, tag pushed
