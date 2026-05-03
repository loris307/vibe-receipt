import { existsSync, statSync } from "node:fs";
import { glob } from "node:fs/promises";
import { resolve } from "node:path";
import { getClaudeJsonlRoots } from "../extract/claude.js";
import { getCodexJsonlRoot } from "../extract/codex.js";

interface SourceRow {
  source: string;
  root: string;
  exists: boolean;
  fileCount: number;
  totalSizeKb: number;
}

function isSubagentJsonl(path: string): boolean {
  return path.includes("/subagents/") || /\/agent-[a-z0-9]+\.jsonl$/i.test(path);
}

async function summarizeRoot(source: string, root: string): Promise<SourceRow> {
  if (!existsSync(root)) return { source, root, exists: false, fileCount: 0, totalSizeKb: 0 };
  let count = 0;
  let bytes = 0;
  try {
    for await (const file of glob("**/*.jsonl", { cwd: root, withFileTypes: false })) {
      const abs = resolve(root, String(file));
      if (source === "claude" && isSubagentJsonl(abs)) continue;
      try {
        bytes += statSync(abs).size;
        count += 1;
      } catch {
        // skip
      }
    }
  } catch {
    // skip
  }
  return { source, root, exists: true, fileCount: count, totalSizeKb: Math.round(bytes / 1024) };
}

export async function listSourcesSummary(): Promise<string> {
  const claudeRoots = getClaudeJsonlRoots();
  const codexRoot = getCodexJsonlRoot();
  const rows: SourceRow[] = [];
  for (const r of claudeRoots) rows.push(await summarizeRoot("claude", r));
  rows.push(await summarizeRoot("codex", codexRoot));

  const lines = ["Detected JSONL sources:\n"];
  for (const r of rows) {
    if (!r.exists) {
      lines.push(`  [${r.source}] ${r.root}  (not present)`);
    } else {
      lines.push(`  [${r.source}] ${r.root}`);
      lines.push(`     ${r.fileCount} files · ${r.totalSizeKb} KB`);
    }
  }
  return lines.join("\n");
}
