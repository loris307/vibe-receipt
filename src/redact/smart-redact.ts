import { basename } from "node:path";
import type { Receipt, TopFile } from "../data/receipt-schema.js";
import type { RevealOpts } from "../data/types.js";
import { NO_REVEAL } from "../data/types.js";

const REVEAL_PROMPT_MAX_CHARS = 200;

function redactBranch(branch: string | null, reveal: boolean): string | null {
  if (!branch) return null;
  if (reveal) return branch;
  // Keep prefix segment (e.g. "feature/oss-saint-cards" → "feature/…")
  if (branch.includes("/")) return `${branch.split("/")[0]}/…`;
  return branch;
}

function redactFile(f: TopFile, reveal: boolean): TopFile {
  if (reveal) return f;
  return { ...f, path: basename(f.path) };
}

function redactAfkRecaps(recaps: string[], reveal: boolean): string[] {
  if (reveal) return recaps;
  return recaps.map((_) => `<recap hidden>`);
}

export function applyRedaction(receipt: Receipt, reveal: RevealOpts = NO_REVEAL): Receipt {
  return {
    ...receipt,
    meta: {
      ...receipt.meta,
      // meta.project is already basename; nothing further to redact
      branch: redactBranch(receipt.meta.branch, reveal.paths),
    },
    time: {
      ...receipt.time,
      afkRecaps: redactAfkRecaps(receipt.time.afkRecaps, reveal.prompt),
    },
    work: {
      ...receipt.work,
      topFiles: receipt.work.topFiles.map((f) => redactFile(f, reveal.paths)),
      mostEditedFile: receipt.work.mostEditedFile
        ? {
            ...receipt.work.mostEditedFile,
            path: reveal.paths
              ? receipt.work.mostEditedFile.path
              : basename(receipt.work.mostEditedFile.path),
          }
        : null,
    },
    firstPrompt: {
      ...receipt.firstPrompt,
      revealed: reveal.prompt
        ? truncateForReveal(receipt.firstPrompt.revealed)
        : null,
    },
  };
}

/** Truncate the shortest-prompt text shown on the card. Long "shortest"s are still possible
 *  (a session where every prompt is huge), so cap at 80 chars. */
export function truncateShortestText(s: string | null, max = 80): string | null {
  if (!s) return null;
  const collapsed = s.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max).trimEnd()}…`;
}

function truncateForReveal(s: string | null): string | null {
  if (!s) return null;
  if (s.length <= REVEAL_PROMPT_MAX_CHARS) return s;
  return `${s.slice(0, REVEAL_PROMPT_MAX_CHARS)}…`;
}

/**
 * Helper: pre-fill firstPrompt.revealed when caller knows the raw prompt and wants
 * --reveal=prompt to actually surface text. Used by aggregator + cli.
 */
export function withRawPrompt(receipt: Receipt, rawPrompt: string | null): Receipt {
  return {
    ...receipt,
    firstPrompt: {
      ...receipt.firstPrompt,
      revealed: rawPrompt,
    },
  };
}

export function parseRevealFlag(input: string | undefined): RevealOpts {
  const out: RevealOpts = { paths: false, prompt: false, bash: false };
  if (!input) return out;
  const tokens = input
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const tok of tokens) {
    if (tok === "all") {
      out.paths = true;
      out.prompt = true;
      out.bash = true;
    } else if (tok === "paths") out.paths = true;
    else if (tok === "prompt") out.prompt = true;
    else if (tok === "bash") out.bash = true;
  }
  return out;
}
