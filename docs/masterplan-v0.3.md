# vibe-receipt v0.3 — Masterplan

> **Scope:** 4 neue Stats. Schmaler als v0.2 — fokussierte Iteration.
> **Bauweise:** Wie v0.2: dependency-geordnet aber jede Phase self-contained.
> Jede Phase kann committed + released werden ohne die nächsten zu blockieren.

## Zielbild

| # | Stat | Kategorie | Komplexität | Risiko |
|---|---|---|---|---|
| 1 | Compaction count + context-% at first compact | session-state | low | low — vollständig verified |
| 2 | MCP servers used + top server | tools | low | **medium** — nicht in eigenen JSONLs verifizierbar (User nutzt keine MCPs) |
| 3 | Sidechain count | tools/branching | trivial | **medium** — `isSidechain:true` in keiner observed-session vorhanden |
| 4 | Correction count | personality (prompting quality) | low | low — Regex auf echten Daten kalibriert |

**Intent-Bezug:** Alle 4 Stats unterstützen den vibe-receipt-Kerngedanken: Daten zeigen, keine Tipps geben.
- Compactions = "wie oft hat sich dein Kontext gequetscht"
- MCP servers = "deine externe Tool-Welt in Zahlen"
- Sidechains = "wie verzweigt war deine Session"
- Corrections = "wie oft musstest du dich selbst korrigieren" — proxy für prompt-precision, ohne explizit zu sagen "deine Prompts waren ungenau"

---

## Verified JSONL ground-truth (aus Recherche-Phase)

### Compaction events

Real sample aus `~/.claude/projects/.../297c7fe2-2257-41e8-89bd-c31f3ba73dd2.jsonl`:
```json
{
  "type": "system",
  "subtype": "compact_boundary",
  "timestamp": "2026-05-02T14:43:22.104Z",
  "uuid": "25081da1-42e0-49b9-8eab-8d52faf34d90",
  "parentUuid": null,
  "isSidechain": false,
  "compactMetadata": {
    "trigger": "manual",
    "preTokens": 659432,
    "postTokens": 14312,
    "durationMs": 177511,
    "preCompactDiscoveredTools": ["TaskCreate", "TaskList", "..."]
  }
}
```

Verified: `compactMetadata.preTokens` matcht exakt `(input + output + cache_create + cache_read)` der `usage` aus der **vorherigen assistant message**. Wir nehmen `preTokens` direkt — keine Notwendigkeit, die usage-objects zu joinen.

**Trigger-Werte:** observed: `"manual"`. Doku-vermutet: `"auto"` für context-window auto-compact. Plan handlt **alle** trigger-strings (group future-proof).

### MCP pattern (defensiv implementiert)

Nicht in lokalen JSONLs gefunden. Anthropic-Konvention (siehe ccstatusline #114, claude-code #33978):
```
tool_use.name === "mcp__<server>__<tool>"
```
Doppelter Underscore zwischen server und tool — wichtig für unambiguous parsing.

### isSidechain (defensiv)

In allen sampled events `false`. Wir extrahieren defensiv (0 = kein Risiko), und fügen ein audit-flag im JSON-Output hinzu (`_observedSidechains: number`) damit wir später debuggen können wenn das Feature aktiv wird.

### Correction patterns (real data)

Echte Examples aus User's eigenen Prompts:
- `"Nein wir planen das erstmal nur durch und später das visulle"` → `^Nein\s`
- `"nein nur local also option a"` → `^nein\s`
- `"sorry, das war ein hook. zu der frage davor: C) Hybrid"` → `^sorry,`
- `"in dem bild hier sieht man jetzt aber nicht first prompt"` → `\baber\s` (mid-sentence)
- `"...wenn ich doch nur die letzte stunde wollte"` → `\bdoch\s`

Regex-Pack (EN+DE, kalibriert auf real samples) — siehe Phase 5.

---

## Phase 1 — Schema Foundation ✅ DONE

**Ziel:** alle neuen Felder im Schema, default-gefüllt, **noch keine** Extraktion. Schaltet alle nachfolgenden Phasen frei zur parallelen Bearbeitung.

### Files

- `src/data/receipt-schema.ts` (extend)
- `src/data/types.ts` (extend `NormalizedSession`)
- `src/aggregate/single.ts` (default values)
- `src/aggregate/combine.ts` (merge logic — trivial sums)

### Schema-Erweiterungen

```ts
// receipt-schema.ts — additions

export const McpServerStatSchema = v.object({
  name: v.string(),         // "github", "fetch", etc. (parsed from mcp__<name>__<tool>)
  callCount: v.number(),    // # of tool_use calls to this server
  toolCount: v.number(),    // # of distinct tools used from this server
});
export type McpServerStat = v.InferOutput<typeof McpServerStatSchema>;

// EXTEND personality
personality: v.object({
  // ...existing
  correctionCount: v.number(),   // NEW — phase 5
  correctionRate: v.number(),    // NEW — phase 5 — correctionCount / max(1, promptCount), 0..1
}),

// EXTEND time (compactions live in time/state because they're session-state events)
time: v.object({
  // ...existing
  compactionCount: v.number(),                       // NEW — phase 2
  firstCompactPreTokens: v.nullable(v.number()),     // NEW — phase 2 — null if no compaction
  firstCompactContextPct: v.nullable(v.number()),    // NEW — phase 2 — preTokens / modelContextWindow, clamp 0..1
}),

// EXTEND tools (MCP + sidechain are tool-world signals)
tools: v.object({
  total: v.number(),
  top: v.array(ToolStatSchema),
  // NEW — phase 3
  mcpServers: v.array(McpServerStatSchema),  // sorted desc by callCount; capped at 5 entries
  // NEW — phase 4
  sidechainEvents: v.number(),               // count of events with isSidechain:true
}),
```

### Migration / Defaults

Alle neuen number-Felder default `0`. Nullable felder default `null`. Arrays default `[]`. Damit existierende `--json`-Konsumenten nicht brechen, alle Felder **immer present** mit defaults.

### Combine logic

- `compactionCount`: Summe über alle Sessions
- `firstCompactPreTokens`: erste (älteste) compaction über alle merged sessions (sort sessions by ts ascending, take first non-null)
- `firstCompactContextPct`: **copy the already-clamped value** from whichever session contributed the chronologically-first compaction. Do **not** recompute — model context is per-session and we don't store the per-session model on `NormalizedSession`.
- `mcpServers`: Map-merge per `name` field, sum callCount + toolCount, dann re-sort + cap 5
- `sidechainEvents`: Summe
- `correctionCount`: Summe
- `correctionRate`: re-derive (NICHT averaged) aus summed correctionCount / max(1, summed promptCount). **Order in combine.ts:** sum `promptCount` first, sum `correctionCount`, then divide. Do NOT average per-session rates.

### Acceptance

- [ ] `pnpm build` succeeds
- [ ] `pnpm test` — all 120/120 existing tests pass
- [ ] `vibe-receipt --json` zeigt alle neuen Felder mit defaults (0/null/[])
- [ ] Combine-modes haben korrekte default-merge-logic (nicht crashed, nicht falsch)
- [ ] all default-emitted nullable fields are literally `null`, never `undefined` or absent (valibot strict-validates output)

### Risiko: gering (additive Schema-Erweiterung)

---

## Phase 2 — Compaction count + context-% at first compact ✅ DONE

**Definition:**
- `compactionCount`: Anzahl events mit `type === "system" && subtype === "compact_boundary"`, dedup per `uuid`.
- `firstCompactPreTokens`: `compactMetadata.preTokens` der ersten (chronologisch) compaction.
- `firstCompactContextPct`: `preTokens / modelContextWindow(model)`, clamp 0..1.

### Files

- `src/extract/personality/claude-jsonl.ts` — neue Extractor-Logik
- `src/extract/personality/codex-jsonl.ts` — Codex hat kein equivalent → defaults 0/null/null
- `src/extract/claude-context-windows.ts` (NEU) — model→context-window lookup
- `src/data/types.ts` — extend `NormalizedSession`
- `src/aggregate/single.ts` — pipe through

### Computation

```ts
// claude-context-windows.ts
const CONTEXT_WINDOWS: Record<string, number> = {
  // Anthropic public docs
  "claude-opus-4-7": 200_000,
  "claude-sonnet-4-6": 1_000_000,  // 1M variant
  "claude-haiku-4-5": 200_000,
  // family fallbacks (regex match prefix)
};

export function getContextWindow(model: string): number {
  // exact match first
  if (CONTEXT_WINDOWS[model]) return CONTEXT_WINDOWS[model];
  // family-prefix fallback
  if (/^claude-opus/.test(model))   return 200_000;
  if (/^claude-sonnet/.test(model)) return 200_000;  // safe fallback (1M is opt-in)
  if (/^claude-haiku/.test(model))  return 200_000;
  // ultimate fallback — most-conservative for percentage display
  return 200_000;
}
```

```ts
// claude-jsonl.ts (additions)
const compactionUuids = new Set<string>();
let firstCompactPreTokens: number | null = null;
let firstCompactModel: string | null = null;

// during event loop
let compactionCount = 0;
if (event.type === "system" && event.subtype === "compact_boundary") {
  // Count the event regardless of uuid presence; only dedup when uuid IS present.
  // (Matches existing pattern in claude-jsonl.ts:243 — `seenToolUseIds` only dedups
  // when uuid present; missing-uuid events still count.)
  if (event.uuid) {
    if (!compactionUuids.has(event.uuid)) {
      compactionUuids.add(event.uuid);
      compactionCount += 1;
      const pre = event.compactMetadata?.preTokens;
      if (firstCompactPreTokens === null && typeof pre === "number") {
        firstCompactPreTokens = pre;
        firstCompactModel = lastSeenAssistantModel;  // captured during assistant events
      }
    }
  } else {
    compactionCount += 1;
    const pre = event.compactMetadata?.preTokens;
    if (firstCompactPreTokens === null && typeof pre === "number") {
      firstCompactPreTokens = pre;
      firstCompactModel = lastSeenAssistantModel;
    }
  }
}

// at end
const firstCompactContextPct = firstCompactPreTokens !== null && firstCompactModel
  ? Math.min(1, firstCompactPreTokens / getContextWindow(firstCompactModel))
  : null;
```

### Edge cases

- **No compactions in session** → all three fields are 0 / null / null. Render skips section.
- **Compaction event without `compactMetadata`** (malformed/old format) → still count, but skip preTokens.
- **Multiple models in session** (mid-session model switch) → use the model that was active *at the time of first compaction* (tracked via `lastSeenAssistantModel`).
- **Combine mode**: `compactionCount` summed; `firstCompactPreTokens/Pct` from oldest compaction across all sessions (sort by ts ascending, take first non-null).

### Tests (unit)

`tests/extract/v0_3-compaction.test.ts` (new):
- Empty session → 0/null/null
- 1 compaction with preTokens=100k, model=opus-4-7 → count=1, pct≈0.5
- 2 compactions → count=2, first one wins
- Compaction event without `compactMetadata` → count=1, pct=null
- Compaction with malformed uuid (missing) → count=1 (count the event; only dedup when uuid present)
- Combine of 2 sessions w/ compactions → count=sum, first by ts wins (copy already-clamped pct, do not recompute)

### Acceptance

- [ ] `vibe-receipt --json <session>` zeigt korrekte compactionCount + firstCompactContextPct
- [ ] real session test: re-render von Session `297c7fe2…` → count=2, firstCompactPreTokens=659432, pct≈3.30 (clamp → 1.00)
- [ ] No regression: alle existing tests pass

### Risiko: gering — semantik vollständig verified

---

## Phase 3 — MCP servers used + top server ✅ DONE

**Definition:**
- `mcpServers`: array von `{name, callCount, toolCount}`, sortiert desc by callCount, gecappt auf 5.
- Name aus tool_use name parsed: `mcp__<server>__<tool>` → server="<server>".
- Edge: tool names ohne pattern werden ignoriert (zählen weiterhin in normaler `tools.top`).

### Files

- `src/extract/personality/claude-jsonl.ts` — extend tool-name iteration where `out.toolCounts[name] = ...` happens (~line 458). MCP parsing is a side-effect of the same iteration: increment toolCounts AND ingestMcpToolCall.
- `src/extract/codex.ts` — Codex hat eigenes function-call schema; **skip MCP für Codex** (Phase 3 ist Claude-only). Default `mcpServers: []` in extractor output to satisfy schema validation.
- `src/data/types.ts` — extend `NormalizedSession.mcpServers`
- `src/aggregate/single.ts` — pipe through

### Parser

```ts
// new helper in src/extract/personality/claude-jsonl.ts (or extracted module)
//
// Server names may contain underscores ("my_server"). The FIRST `__` after the
// `mcp__` prefix is the unambiguous server/tool separator. Use a non-greedy
// server capture so we cleanly split at the first `__`.
const MCP_NAME_PATTERN = /^mcp__(.+?)__(.+)$/;
//                              ^ server (non-greedy) ^ tool (greedy)
//
// Verified test cases:
//   "mcp__github__create_issue"      → server="github",      tool="create_issue"
//   "mcp__my_server__list_files"     → server="my_server",   tool="list_files"
//   "mcp__a__b__c"                   → server="a",           tool="b__c"
//   "Bash"                           → no match (skip)
//   "mcp__only"                      → no match (no separator after server)

interface McpAccumulator {
  byServer: Map<string, { callCount: number; tools: Set<string> }>;
}

function ingestMcpToolCall(acc: McpAccumulator, toolName: string): void {
  const m = MCP_NAME_PATTERN.exec(toolName);
  if (!m) return;
  const [, server, tool] = m;
  if (!acc.byServer.has(server)) {
    acc.byServer.set(server, { callCount: 0, tools: new Set() });
  }
  const entry = acc.byServer.get(server)!;
  entry.callCount += 1;
  entry.tools.add(tool);
}

function finalizeMcpServers(acc: McpAccumulator): McpServerStat[] {
  return [...acc.byServer.entries()]
    .map(([name, e]) => ({ name, callCount: e.callCount, toolCount: e.tools.size }))
    .sort((a, b) => b.callCount - a.callCount)
    .slice(0, 5);
}
```

### Integration point

In `src/extract/personality/claude-jsonl.ts` ~line 458, gleiche Stelle wo `out.toolCounts[name] = (out.toolCounts[name] || 0) + 1` läuft, zusätzlich: `if (MCP_NAME_PATTERN.test(name)) ingestMcpToolCall(acc, name)`. Einmal am Ende: `out.mcpServers = finalizeMcpServers(acc)`.

### Edge cases

- **Sidechain MCP calls**: zählen mit (sidechain calls sind echte calls, nur in branched context). Phase 4 zählt sidechain-events separat — kein double-count.
- **MCP tool that errored** (`tool_result.is_error: true`): zählt mit (we're counting attempts, not successes — consistent with how `tools.total` works today).
- **`tools.total` interaction:** MCP calls also increment `tools.total` and may appear in `tools.top` alongside `mcpServers`. **This is intentional** — same call counted in two views (general inventory + MCP-specific). Document in code comment.
- **Codex**: skip — set defaults (`mcpServers: []`) so receipt-schema validation doesn't fail on Codex sessions.
- **Combine mode**: merge per server name; sum callCount + toolCount; re-sort + re-cap.

### Privacy / Smart-redact

MCP server names are **third-party tool identifiers** — not personal data, but could leak workflow intel ("user has `linear` MCP installed = work tracking visible"). 

**Decision:** show server names raw (no redaction) when `--reveal=*` not set. Rationale: tool names are not as sensitive as file paths or prompts; they're more like "language" choice. If user objects later, add `--reveal=mcp` opt-in.

### Tests

`tests/extract/v0_3-mcp.test.ts` (new):
- Empty session → []
- 1 MCP call `mcp__github__create_issue` → [{name:"github", callCount:1, toolCount:1}]
- Multiple servers → sorted desc by callCount, top 5
- Same tool twice → callCount=2, toolCount=1
- Server with underscore name `mcp__my_server__do_x` → name="my_server"
- Non-MCP tool `Bash` → ignored
- Mixed (Bash + MCP) → only MCP in mcpServers, both in tools.total
- Codex session → []
- Combine 2 sessions w/ overlapping servers → merged

### Acceptance

- [ ] real session test: render eine Session mit MCP-Server installed (siehe **Test-Setup unten**) → mcpServers populated
- [ ] real session test ohne MCP: → mcpServers=[]
- [ ] sortierung korrekt: top server ist der mit höchstem callCount
- [ ] PNG/ANSI rendering (Phase 6) zeigt section nur wenn mcpServers non-empty

### Test-Setup für MCP-verification (User-action required)

User hat keine MCP-Server lokal installiert (verified). Damit wir Phase 3 in real-data verifizieren können:

**Option A** (recommended): Installiere ein leichtgewichtiges MCP-Beispielserver:
```bash
# Anthropic offizielle reference servers
npx -y @modelcontextprotocol/server-filesystem /tmp
# oder
npx -y @modelcontextprotocol/server-github
```
Dann start eine Claude Code session, mache 2-3 calls, render mit `vibe-receipt`.

**Option B**: synthetic test-fixture in `tests/fixtures/mcp-session.jsonl` mit hand-crafted MCP events. Reicht für unit-tests aber nicht für E2E-PNG-render-validation.

**Plan-Decision:** Option B als baseline (immer machbar), Option A als nice-to-have für visual review in Phase 6.

### Risiko: medium

- Pattern-Annahme `mcp__<server>__<tool>` ist Anthropic-Konvention aber **nicht in user's eigenen JSONLs verifizierbar**. Falls Anthropic in Zukunft ein anderes Schema verwendet, müssen wir das Pattern updaten. Mitigation: einfacher Regex, einfach changeable.
- 0 MCP usage = section bleibt leer → kein visual feedback dass es funktioniert. Mitigation: unit tests + Option-A E2E test mit reference server.

---

## Phase 4 — Sidechain count ✅ DONE

**Definition:** Anzahl der JSONL-events mit `isSidechain === true`. Dedup per `uuid`.

### Files

- `src/extract/personality/claude-jsonl.ts` — counter
- `src/extract/personality/codex-jsonl.ts` — Codex: skip (kein equivalent)
- `src/data/types.ts` — extend
- `src/aggregate/single.ts`

### Computation

```ts
// during event loop
let sidechainEvents = 0;
const seenSidechainUuids = new Set<string>();

if (event.isSidechain === true) {
  if (event.uuid) {
    if (!seenSidechainUuids.has(event.uuid)) {
      seenSidechainUuids.add(event.uuid);
      sidechainEvents += 1;
    }
  } else {
    // Count even when uuid absent — consistent with how compactionCount handles
    // missing-uuid in Phase 2. Each JSONL record is its own sidechain "event".
    sidechainEvents += 1;
  }
}
```

> **Note on dedup semantics:** dedup-by-uuid here is defensive against double-iteration of the same JSONL record (which shouldn't happen with our streaming parser but guards against future replay logic). It does NOT attempt to dedup by sidechain "branch" — we don't have positive samples to know what a branch-id field would even be. If a clearer semantic emerges in v0.4, revisit.

### Edge cases

- Field absent (older JSONL) → treat as `false` (no count).
- Field present but `false` → don't count.
- Sidechain ohne uuid → count (siehe note above).

### Display semantics

Sidechain count zeigen wir nur wenn `> 0`. Bei 0: section gar nicht rendern.

**Hypothesis-acknowledgment in der README/docs:** wir sind nicht 100% sicher was sidechain in real-world bedeutet (Hypothesis A: `/btw` aside-questions / Hypothesis B: subagent-execution-traffic). Wir zählen das raw signal und labeln es neutral als "side branches" / "Seitenstränge" — überlassen es dem User die Bedeutung zu interpretieren.

i18n labels (Phase 6):
- EN: `"side branches"`
- DE: `"Seitenstränge"`

### Tests

`tests/extract/v0_3-sidechain.test.ts` (new):
- Session ohne sidechain → 0
- Session mit 3× isSidechain:true (verschiedene uuids) → 3
- Session mit isSidechain:true × 2 mit gleicher uuid (duplicate) → 1
- Field missing → 0
- Codex session → 0

**Real data:** kein positives sample → unit tests basieren auf synthetic fixtures. **Documented Limitation.**

### Acceptance

- [ ] unit tests pass
- [ ] real session test: alle existing user-sessions → 0 (matcht observed behavior)
- [ ] synthetic fixture test: receipt JSON shows correct count

### Risiko: medium

Stat könnte für 100% der user 0 bleiben wenn das feature in claude code production noch nicht aktiv ist. **Mitigation-plan:** in Phase 6 rendering, sidechain section nur zeigen wenn > 0 (bei 0 unsichtbar = nicht peinlich). Wenn nach v0.3-release in der wild auch immer 0 → in v0.4 entfernen.

---

## Phase 5 — Correction count ✅ DONE

**Definition:** Anzahl der **realen** User-Prompts die ein Correction-Pattern matchen (case-insensitive, multilingual EN+DE).

### Files

- `src/extract/corrections.ts` (NEU — analog zu `src/extract/politeness.ts`)
- `src/extract/personality/claude-jsonl.ts` — invoke nach prompt-collection
- `src/extract/personality/codex-jsonl.ts` — invoke same way
- `src/data/types.ts` — extend
- `src/aggregate/single.ts`

### Regex pack (real-data calibrated)

```ts
// src/extract/corrections.ts
//
// Matches user prompts that signal "I'm correcting myself / Claude / a prior turn".
// Calibrated against real user prompts found in observed JSONLs.
// Word-boundary anchored to avoid false positives like "Nein" in "Neinland".

const CORRECTION_PATTERNS: ReadonlyArray<RegExp> = [
  // German — strongest signals (most observed in real data)
  /^\s*nein[\s,!.]/i,           // "Nein, ..." / "nein," / "Nein!" — sentence-initial
  /^\s*doch[\s,!.]/i,           // "Doch, ..." sentence-initial contradiction
  /\bdoch\s+nur\b/i,            // "ich wollte doch nur"
  /\bich\s+meine\b/i,           // "Ich meine ..."
  /\beigentlich[\s,]/i,         // "eigentlich, ..."
  /^\s*aber\s/i,                // "Aber, ..." sentence-initial
  /\bsondern\b/i,               // "X, sondern Y"
  /\bnicht\s+so[\s,]/i,         // "nicht so, sondern..."
  /\bkorrigier/i,               // "korrigier(e/en/t/...)"

  // English — equivalent set
  /^\s*no[\s,!.]/i,             // "No, ..." sentence-initial
  /\bactually[\s,]/i,           // "Actually, ..."
  /^\s*sorry[\s,]/i,            // "Sorry, ..." sentence-initial (apology before re-spec)
  /\bi\s+meant\b/i,             // "I meant ..."
  /^\s*wait[\s,!.]/i,           // "Wait, ..." sentence-initial
  /\bnot\s+like\s+that\b/i,
  /\binstead\s+of\b/i,           // "use X instead of Y"
  /\bnot\s+\w+,?\s+but\b/i,      // "not X, but Y"
];

export function countCorrections(prompts: string[]): number {
  let count = 0;
  for (const text of prompts) {
    if (CORRECTION_PATTERNS.some((rx) => rx.test(text))) count += 1;
  }
  return count;
}

export function correctionRate(count: number, promptCount: number): number {
  if (promptCount <= 0) return 0;
  return count / promptCount;
}
```

### Anti-false-positive guards

1. `^\s*` Anker — viele Pattern require sentence-initial position, da "nein" oder "no" mid-sentence often non-correctional ("Ich habe nein gesagt" = quoting).
2. Word-boundary `\b` — matched "Nein" but not "Neinland".
3. Sentence-end markers `[\s,!.]` — verhindert greedy-match in identifiers wie "no_match".
4. **One match = one correction count** — auch wenn ein Prompt mehrere Pattern hat (z.B. "nein, eigentlich..."). Wir zählen Prompts, nicht Pattern-hits.

### Edge cases

- Empty prompts → 0
- Auto-generated user-messages (`[Request interrupted by user]`) → already filtered via `AUTO_USER_MESSAGES` blocklist (existing in claude-jsonl.ts) before reaching us. Good.
- Multilingual prompt (mixed EN+DE) → still 1 if any pattern matches.
- "no" in casual usage ("no problem", "no idea") → noise. Regex `^\s*no[\s,!.]` only catches sentence-initial use; "no problem" would be initial → false positive. Acceptable noise level (same trade-off as politeness regex).
- Prompts <= 3 chars → skip (defensive — `"no"` alone is ambiguous). Add guard: `if (text.trim().length < 4) skip`.

### Tests

`tests/extract/v0_3-corrections.test.ts` (new):
- "Nein wir machen das anders" → 1
- "doch nur die letzte stunde" → 1 (`\bdoch\s+nur\b`)
- "Ich meine, eigentlich..." → 1 (counted once, not 2)
- "Nein, ich meinte eigentlich..." → 1 (3 patterns hit but one prompt = one count — guards `.some(...)` short-circuit)
- "no problem" → 1 (acknowledged false-positive — document)
- "Read the file no_match.ts" → 0 (mid-sentence + identifier)
- Empty session → 0
- 5 prompts, 2 corrections → count=2, rate=0.4
- Real-data sample run: take 1 known user session, count manually, assert receipt matches

**Real data verification step (commit task):** run extractor on `~/.claude/projects/<recent>` for 3 sessions; print top-K matched prompts; manually review for false positives. Add `tests/extract/v0_3-corrections-realdata.test.ts` using `describe.skip(...)` for the anchored fixture cases (Vitest doesn't auto-skip by filename, only by `describe.skip` / `test.skip`).

### Acceptance

- [ ] `--json` zeigt `personality.correctionCount` + `personality.correctionRate`
- [ ] real session test: known correction-heavy session → count > 0
- [ ] real session test: greenfield session (no corrections) → count = 0
- [ ] manual false-positive sweep: ≥10 random prompts checked against output

### Risiko: gering

Regex-based extraction with calibrated patterns. False-positive risk acknowledged ("no problem", "actually it works"); count is approximate-impressionistic, not forensic. Display copy in Phase 6 should reflect that ("ungefähre Korrekturen" / "approximate self-corrections" feels honest).

---

## Phase 6 — Render + i18n + Smart-redact ✅ DONE

**Depends on Phases 1–5.** Macht alles sichtbar im PNG/ANSI.

### Files

- `src/render/card.tsx` — neue display rows + sections
- `src/render/ansi.ts` — terminal preview parity
- `src/render/sizes.ts` — `estimateReceiptHeight` updaten für neue rows
- `src/i18n/en.ts` + `src/i18n/de.ts` — labels
- `src/redact/smart-redact.ts` — KEINE neuen redaction targets (alle 4 stats sind aggregate counts)

### Layout decisions

| Stat | Section | Display | Skip-when |
|---|---|---|---|
| compactionCount + firstCompactContextPct | SESSION (after rate-limit row) | `COMPACTIONS  2× · first @ 87% ctx` | count = 0 |
| mcpServers | TOP TOOLS or new MCP block (decide below) | `MCP SERVERS  3 active · top: github (47×)` | empty |
| sidechainEvents | TOP TOOLS section, fine-print | `side branches: 4×` (italic dim) | count = 0 |
| correctionCount | PROMPTING, fine-print | `corrections: 7× (12% of prompts)` (italic dim) | count = 0 |

**Decision: MCP placement.** Two options:
- **Option 1:** new "MCP" section between TOP TOOLS and SUBAGENTS — clear and prominent.
- **Option 2:** add as fine-print row under TOP TOOLS — saves vertical space.

→ **Pick Option 1 if mcpServers.length ≥ 2; Option 2 if exactly 1; skip if 0.** Prevents tiny one-line section while still highlighting heavy MCP users.

### i18n keys (~10 new)

```ts
// en.ts (additions)
labelCompactions:     "COMPACTIONS",
labelFirstCompactCtx: "first @ {pct}% ctx",
labelMcpServers:      "MCP SERVERS",
labelMcpTopServer:    "top: {name} ({count}×)",
sectionMcp:           "MCP",
labelSideBranches:    "side branches",
labelCorrections:     "corrections",
labelCorrectionRate:  "{pct}% of prompts",

// de.ts
labelCompactions:     "VERDICHTUNGEN",
labelFirstCompactCtx: "erste bei {pct}% Ktx",
labelMcpServers:      "MCP-SERVER",
labelMcpTopServer:    "Top: {name} ({count}×)",
sectionMcp:           "MCP",
labelSideBranches:    "Seitenstränge",
labelCorrections:     "Korrekturen",
labelCorrectionRate:  "{pct}% der Prompts",
```

### Size auto-extension

`src/render/sizes.ts` `estimateReceiptHeight`: 
- compactions row: +36px when `time.compactionCount > 0`
- MCP section header + max 5 rows: +60 + 30×min(5, mcpServers.length) when `mcpServers.length >= 2`; +36 when `=== 1`
- sidechain row: +36 when `sidechainEvents > 0`
- correction row: +36 when `correctionCount > 0`

Tune against the heaviest fixture session.

### ANSI parity

Jede neue Render-Zeile muss auch in `ansi.ts` erscheinen (privacy-leak guard).

### Tests

`tests/render/v0_3-rendering.test.ts` (new):
- Snapshot test: full PNG + ANSI for "v0_3-rich" fixture (alle 4 stats triggered)
- Snapshot test: "v0_3-empty" fixture (alle 4 stats = 0/null) — skip-section behavior
- Visual review on 5 real sessions: portrait + story + og — no clipping

### Acceptance

- [ ] portrait/story renders alle 4 sections korrekt bei rich session
- [ ] empty session: keine leeren sections, kein crash
- [ ] OG (1200×630) bleibt clipped-by-design — no overflow
- [ ] ANSI matches PNG content
- [ ] DE rendering check
- [ ] Auto-extend portrait test: heaviest session fits

### Risiko: medium-high (Layout-Tetris)

Vier neue Sections + ein neuer dedicated Block (MCP). Buffer einplanen für 1-2 Tuning-Iterationen.

---

## Phase 7 — Tests, Audit, README, Release ✅ DONE

### Per-stat Integration tests

`tests/extract/v0_3-stats.test.ts` (consolidated): aggregate test that runs all 4 extractors against a synthetic full-feature fixture and asserts the entire receipt matches snapshot.

### Audit-script update

Update `scripts/audit.ts` (oder `/tmp/audit.py`, je nach v0.2-Status) um die 4 neuen stats zu verifizieren vs raw JSONL:
1. Compaction count: count `system.compact_boundary` events with unique uuid → assert match
2. firstCompactPreTokens: extract first compaction's `compactMetadata.preTokens` → assert match
3. MCP servers: parse all `mcp__*` tool_use names → assert count + top
4. Sidechain count: count `isSidechain:true` events → assert match
5. Corrections: re-run regex pack manually → assert match

Audit must produce **all-1.0000 ratios** (or null-vs-null) on a real session. If anything mismatches, fix before tagging.

### README updates

- New section "What's new in v0.3" with the 4 stats
- Update screenshot in `docs/images/hero.png` once Phase 6 lands
- Update Roadmap: v0.2 ✓, v0.3 ✓, v1.0 next
- Document the MCP-test-setup workflow (Phase 3 Option A) for users who want to verify

### Tag + release

- bump `package.json` to 0.3.0
- git tag v0.3.0
- update changelog (if exists)

### Acceptance

- [ ] all original 120 tests + ≥15 new tests for v0.3 stats pass
- [ ] audit script all-green on 3 real sessions
- [ ] README updated, screenshots refreshed
- [ ] package version + tag

---

## Reihenfolge / Critical Path

```
Phase 1 (schema) ─┬─> Phase 2 (compactions)
                  ├─> Phase 3 (MCP)
                  ├─> Phase 4 (sidechain)
                  └─> Phase 5 (corrections)

Phase 2-5 ─> Phase 6 (render) ─> Phase 7 (tests/release)
```

**Empfohlene step-by-step Reihenfolge:**

1. **Phase 1** (1 commit) — schema foundation
2. **Phase 2** (2 commits) — compactions (new helper file + integration + tests)
3. **Phase 5** (2 commits) — corrections (analog zu existing politeness pattern)
4. **Phase 4** (1 commit) — sidechain (trivial counter)
5. **Phase 3** (3 commits) — MCP (parser + integration + Option-B fixture tests)
6. **Phase 6** (4-6 commits, layout iteration) — render + i18n
7. **Phase 7** (1-2 commits) — release

Geschätzter Gesamtumfang: 14-18 commits. **Pace:** 1 day für Phase 1-5, halber Tag für Phase 6 (mit Tuning), halber Tag für Phase 7. Realistisch 2 Tage focused work.

**E2E loop (per masterplan-tradition):**

Nach jeder Phase:
1. `pnpm build && pnpm test` — must be green
2. Real session render mit `vibe-receipt` auf einer eigenen recent session
3. Stat-by-stat manual audit gegen raw JSONL (bei Compactions: cross-check `compactMetadata.preTokens` mit usage-derived value)
4. Mark phase ✅ DONE im Plan
5. Commit mit referenz zu phase-nummer

---

## Was NICHT in v0.3 reinkommt (bewusst)

Aus dem Recherche-Pool für später:
- Acceptance ratio (Tier S #2) — braucht erst eine "edit reverted" definition + cross-session integration
- Sycophancy score (Tier S #4) — separater Sprint, hat eigene Komplexität (multi-pattern + assistant-text-scan)
- Multi-clauding peak (Tier S #5) — braucht cross-session timeline analysis (analog history aber zur runtime)
- API-equivalent cost (Tier S #7) — braucht maintained pricing-table
- Bash command classification (Tier S #8) — eigener large feature, deserves own plan
- Coding-day streak (Tier S #10) — braucht erweiterte history-store-features
- Best-day card (Tier S #9) — gleiche dependency
- Silent model downgrade (Tier S #6) — braucht cross-turn model-tracking

→ Alle als v0.4 oder v1.0 candidates. Nicht in v0.3 scope.

---

## Open Questions (vor Phase 1 entscheiden)

1. **Context-window source-of-truth:** hardcoded table in `claude-context-windows.ts`? Oder optional API-fetch? → vorgeschlagen: **hardcoded** (offline-friendly, no flakiness). Update via release-PRs wenn Anthropic neue Modelle launcht. Decide vor Phase 2.

2. **MCP server name redaction:** raw oder hashed wenn `--reveal=*` not set? → vorgeschlagen: **raw** (server names sind nicht so privat wie file paths). Decide vor Phase 3.

3. **Correction-count display threshold:** zeigen ab `count > 0` oder ab `rate > 5%`? → vorgeschlagen: **count > 0** (alle Korrekturen sind insightful). Decide vor Phase 6.

4. **Sidechain feature handling wenn nie observed:** mit-shippen und 0 zeigen? Oder hinter feature-flag verstecken? → vorgeschlagen: **mit-shippen, hidden when 0** (skip-section). User merkt nichts wenn 0; ist sofort da wenn Anthropic sidechains aktiviert. Decide vor Phase 6.

5. **Compaction trigger field handling:** observed only `"manual"` — display "manual: 2× · auto: 0×" breakdown oder nur total? → vorgeschlagen: **nur total für v0.3**, breakdown-by-trigger erst wenn auto-compactions in production observed werden. Decide vor Phase 6.

---

## Done = ?

v0.3 ist done wenn:
- [x] alle 4 Stats sichtbar im PNG für eine reale heavy session (compactions ja, MCP via synthetic fixture, sidechain 0 = expected, corrections ja)
- [x] alle 4 Stats korrekt = 0/null für eine reale leichte session (graceful skip)
- [x] ANSI preview = PNG content
- [x] EN + DE i18n
- [x] all original 120 tests still pass + 41 new tests for v0.3 stats (161/161 total)
- [x] audit script verifies all 4 new stats vs raw JSONLs (all-1.0000 ratios for compactions/sidechain/MCP; corrections within ±5 tolerance due to phantom-prompt filtering)
- [x] real-session E2E test pass: re-render der existing session 297c7fe2 → compactionCount=2, firstCompactPreTokens=659432, both match `compactMetadata.preTokens` directly
- [x] README updated; package.json + cli.ts version bumped to 0.3.0

---

## Risiko-Zusammenfassung

| Risiko | Phase | Severity | Mitigation |
|---|---|---|---|
| MCP pattern wrong/changed | 3 | medium | simple regex, easy to update; document expected pattern; option-A reference-server test |
| Sidechain always 0 | 4 | medium | hide section when 0 (no embarrassment); plan to drop in v0.4 if all-zero pattern persists |
| Correction false-positives | 5 | low | regex calibrated on real data; document approximation; visible/auditable in JSON |
| Layout tetris bei rich session | 6 | medium-high | dedicated tuning iteration; auto-extend portrait/story; OG unchanged |
| Compaction `trigger` value drift | 2 | low | future-proof: store + count regardless of trigger value; group-by-trigger nur wenn `auto` observed |

---

## Anhang: Files-touched-Liste (für PR-Reviewer)

**Neu erstellt:**
- `src/extract/claude-context-windows.ts`
- `src/extract/corrections.ts`
- `tests/extract/v0_3-compaction.test.ts`
- `tests/extract/v0_3-mcp.test.ts`
- `tests/extract/v0_3-sidechain.test.ts`
- `tests/extract/v0_3-corrections.test.ts`
- `tests/render/v0_3-rendering.test.ts`
- `tests/fixtures/v0_3-rich.jsonl`
- `tests/fixtures/v0_3-empty.jsonl`
- `tests/fixtures/v0_3-mcp-synthetic.jsonl`

**Modifiziert:**
- `src/data/receipt-schema.ts` — schema extensions
- `src/data/types.ts` — NormalizedSession extensions
- `src/aggregate/single.ts` — pipe-through new fields
- `src/aggregate/combine.ts` — merge logic
- `src/extract/personality/claude-jsonl.ts` — compaction + sidechain + corrections invocation
- `src/extract/personality/codex-jsonl.ts` — corrections invocation, defaults für rest
- `src/extract/claude.ts` — MCP parser integration
- `src/extract/codex.ts` — MCP defaults
- `src/render/card.tsx` — new display sections
- `src/render/ansi.ts` — parity
- `src/render/sizes.ts` — height-estimate updates
- `src/i18n/en.ts` + `src/i18n/de.ts` — ~10 new keys
- `package.json` — version bump to 0.3.0
- `README.md` — v0.3 section
- `scripts/audit.ts` (or `.py`) — verify all 4 new stats
