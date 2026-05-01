import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";

const STATE_DIR = resolve(homedir(), ".vibe-receipt");
const INDEX_PATH = resolve(STATE_DIR, "index.jsonl");

function ensureStateDir() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
}

async function readStdin(): Promise<string> {
  return new Promise((res) => {
    if (process.stdin.isTTY) {
      res("");
      return;
    }
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buf += chunk;
    });
    process.stdin.on("end", () => res(buf));
    setTimeout(() => res(buf), 500);
  });
}

/**
 * SessionEnd hook handler.
 * Per spec §12: lazy by design — write a one-line index record, print a toast, exit 0.
 * Never block session shutdown. Never render the PNG here.
 */
export async function handleHookReceive(): Promise<void> {
  ensureStateDir();
  const stdin = await readStdin();
  let payload: any = null;
  if (stdin.trim()) {
    try {
      payload = JSON.parse(stdin);
    } catch {
      // ignore — just write a minimal record
    }
  }
  const record = {
    v: 1,
    ts: new Date().toISOString(),
    src: "claude",
    sessionId: payload?.session_id ?? payload?.sessionId ?? null,
    cwd: payload?.cwd ?? process.cwd(),
    branch: null as string | null,
    raw: payload ?? null,
  };
  try {
    appendFileSync(INDEX_PATH, JSON.stringify(record) + "\n", "utf8");
  } catch {
    // never block shutdown
  }
  process.stderr.write(`📸 Receipt ready · vibe-receipt show\n`);
}

export const HOOK_INDEX_PATH = INDEX_PATH;
export const HOOK_STATE_DIR = STATE_DIR;
