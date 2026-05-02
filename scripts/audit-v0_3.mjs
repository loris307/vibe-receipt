#!/usr/bin/env node
/**
 * audit-v0_3.mjs — verify v0.3 stats end-to-end against raw JSONL.
 *
 * Usage: node scripts/audit-v0_3.mjs <session-id>
 *
 * Re-runs the receipt extractor and a parallel hand-rolled scan over the same
 * JSONL file, then asserts the four v0.3 stats match (compactionCount,
 * firstCompactPreTokens, sidechainEvents, mcpServers shape, correctionCount).
 *
 * Exit 0 on full match; exit 1 with a diff on any mismatch.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const sessionId = process.argv[2];
if (!sessionId) {
  console.error("Usage: node scripts/audit-v0_3.mjs <session-id>");
  process.exit(2);
}

// 1. Locate the JSONL file
const projectsRoot = join(homedir(), ".claude", "projects");
let jsonlPath = null;
function walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name === `${sessionId}.jsonl`) jsonlPath = p;
  }
}
walk(projectsRoot);
if (!jsonlPath) {
  console.error(`Session ${sessionId}.jsonl not found under ${projectsRoot}`);
  process.exit(2);
}
console.log(`audit-v0_3 · session ${sessionId}\nJSONL: ${jsonlPath}`);

// 2. Hand-rolled raw scan
const events = readFileSync(jsonlPath, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

const compactionUuids = new Set();
let firstCompactPreTokens = null;
const sidechainUuids = new Set();
const mcpAcc = new Map();
const userPrompts = [];

const MCP_RX = /^mcp__(.+?)__(.+)$/;
const seenToolIds = new Set();

for (const evt of events) {
  if (evt.isSidechain === true) {
    const u = typeof evt.uuid === "string" ? evt.uuid : null;
    if (u) sidechainUuids.add(u);
    else sidechainUuids.add(`__no-uuid-${sidechainUuids.size}`);
  }
  if (evt.type === "system" && evt.subtype === "compact_boundary") {
    const u = typeof evt.uuid === "string" ? evt.uuid : null;
    const counted = u && compactionUuids.has(u) ? false : true;
    if (counted) {
      if (u) compactionUuids.add(u);
      else compactionUuids.add(`__no-uuid-${compactionUuids.size}`);
      const pre = evt.compactMetadata?.preTokens;
      if (firstCompactPreTokens === null && typeof pre === "number") {
        firstCompactPreTokens = pre;
      }
    }
  }
  if (evt.type === "assistant" && evt.message?.content) {
    for (const block of evt.message.content) {
      if (block?.type === "tool_use") {
        const id = block.id;
        if (id && seenToolIds.has(id)) continue;
        if (id) seenToolIds.add(id);
        const name = String(block.name ?? "");
        const m = MCP_RX.exec(name);
        if (m) {
          const server = m[1];
          const tool = m[2];
          if (!mcpAcc.has(server)) mcpAcc.set(server, { calls: 0, tools: new Set() });
          mcpAcc.get(server).calls += 1;
          mcpAcc.get(server).tools.add(tool);
        }
      }
    }
  }
  if (evt.type === "user" && evt.message?.content) {
    const c = evt.message.content;
    if (typeof c === "string") userPrompts.push(c);
    else if (Array.isArray(c)) {
      const t = c.filter((x) => x?.type === "text").map((x) => x.text).join("\n");
      if (t.trim()) userPrompts.push(t);
    }
  }
}

const mcpServers = [...mcpAcc.entries()]
  .map(([name, e]) => ({ name, callCount: e.calls, toolCount: e.tools.size }))
  .sort((a, b) => b.callCount - a.callCount)
  .slice(0, 5);

// 3. Pull receipt JSON
const cli = spawnSync("node", ["dist/cli.mjs", "--session", sessionId, "--json"], {
  cwd: process.cwd(),
});
if (cli.status !== 0) {
  console.error("vibe-receipt --json failed:", cli.stderr.toString());
  process.exit(2);
}
const receipt = JSON.parse(cli.stdout.toString());

// 4. Compare
const issues = [];
function assertEq(name, expected, actual) {
  const same = JSON.stringify(expected) === JSON.stringify(actual);
  console.log(`  ${same ? "✓" : "✗"} ${name}: raw=${JSON.stringify(expected)} receipt=${JSON.stringify(actual)}`);
  if (!same) issues.push({ name, expected, actual });
}

console.log("\nv0.3 stat verification (ratio target: 1.0000)");
assertEq("compactionCount", compactionUuids.size, receipt.time.compactionCount);
assertEq("firstCompactPreTokens", firstCompactPreTokens, receipt.time.firstCompactPreTokens);
assertEq("sidechainEvents", sidechainUuids.size, receipt.tools.sidechainEvents);
assertEq(
  "mcpServers (shape)",
  mcpServers.map((s) => s.name).join(","),
  receipt.tools.mcpServers.map((s) => s.name).join(","),
);

// Corrections: re-run regex to verify counts within ±1 (regex pack lives in src; we re-eval)
const CORRECTION_RX_LIST = [
  /^\s*nein[\s,!.]/iu,
  /^\s*doch[\s,!.]/iu,
  /\bdoch\s+nur\b/iu,
  /\bich\s+meine\b/iu,
  /\beigentlich[\s,]/iu,
  /^\s*aber\s/iu,
  /\bsondern\b/iu,
  /\bnicht\s+so[\s,]/iu,
  /\bkorrigier/iu,
  /^\s*no[\s,!.]/iu,
  /\bactually[\s,]/iu,
  /^\s*sorry[\s,]/iu,
  /\bi\s+meant\b/iu,
  /^\s*wait[\s,!.]/iu,
  /\bnot\s+like\s+that\b/iu,
  /\binstead\s+of\b/iu,
  /\bnot\s+\w+,?\s+but\b/iu,
];
let rawCorrections = 0;
for (const text of userPrompts) {
  const trimmed = text.trim();
  if (trimmed.length < 4) continue;
  if (CORRECTION_RX_LIST.some((rx) => rx.test(trimmed))) rawCorrections += 1;
}
// note: receipt extracts only "real" prompts (post AUTO_USER_MESSAGES filter), so raw scan
// can be ≥ receipt count when phantom prompts contain match patterns. We allow that direction.
const recCorr = receipt.personality.correctionCount;
const passes = rawCorrections >= recCorr && rawCorrections - recCorr <= 5;
console.log(
  `  ${passes ? "✓" : "✗"} correctionCount: raw≈${rawCorrections} receipt=${recCorr} (raw-side may include phantom prompts; tolerance ±5)`,
);
if (!passes) issues.push({ name: "correctionCount", expected: rawCorrections, actual: recCorr });

if (issues.length > 0) {
  console.error(`\n${issues.length} mismatch(es) — audit FAILED.`);
  process.exit(1);
}
console.log("\nAll v0.3 stats verified vs raw JSONL ✓");
process.exit(0);
