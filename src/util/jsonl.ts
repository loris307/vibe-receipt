import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";

/**
 * Streams JSONL events line-by-line. Silently skips malformed lines (matches ccusage behavior).
 * Returns an async iterable of parsed JSON objects.
 */
export async function* readJsonl<T = unknown>(
  filePath: string,
): AsyncGenerator<T, void, void> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      yield JSON.parse(trimmed) as T;
    } catch {
      // skip malformed
    }
  }
}

export async function readJsonlAll<T = unknown>(filePath: string): Promise<T[]> {
  const out: T[] = [];
  for await (const evt of readJsonl<T>(filePath)) out.push(evt);
  return out;
}
