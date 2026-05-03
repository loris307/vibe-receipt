import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractClaudePersonality } from "../../src/extract/personality/claude-jsonl.js";

async function makeFixture(events: unknown[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vibe-receipt-test-"));
  const path = join(dir, "session.jsonl");
  await writeFile(path, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
  return path;
}

function userEvent(ts: string, text: string, opts: { sidechain?: boolean; uuid?: string } = {}) {
  return {
    type: "user",
    sessionId: "sess-test",
    timestamp: ts,
    cwd: "/tmp/proj",
    uuid: opts.uuid ?? `u-${ts}`,
    isSidechain: opts.sidechain ?? false,
    message: { role: "user", content: text },
  };
}

describe("v0.3 — sidechain extraction", () => {
  it("session without sidechain → 0", async () => {
    const path = await makeFixture([
      userEvent("2026-01-01T00:00:00Z", "hi"),
      userEvent("2026-01-01T00:01:00Z", "again"),
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.sidechainEvents).toBe(0);
  });

  it("3 sidechain events with distinct uuids → 3", async () => {
    const path = await makeFixture([
      userEvent("2026-01-01T00:00:00Z", "main"),
      userEvent("2026-01-01T00:01:00Z", "side", { sidechain: true, uuid: "s1" }),
      userEvent("2026-01-01T00:02:00Z", "side", { sidechain: true, uuid: "s2" }),
      userEvent("2026-01-01T00:03:00Z", "side", { sidechain: true, uuid: "s3" }),
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.sidechainEvents).toBe(3);
  });

  it("duplicate uuid sidechain → counted once", async () => {
    const path = await makeFixture([
      userEvent("2026-01-01T00:01:00Z", "side", { sidechain: true, uuid: "dup" }),
      userEvent("2026-01-01T00:02:00Z", "side", { sidechain: true, uuid: "dup" }),
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.sidechainEvents).toBe(1);
  });

  it("isSidechain field absent → 0", async () => {
    const evt = {
      type: "user",
      sessionId: "s",
      timestamp: "2026-01-01T00:00:00Z",
      cwd: "/tmp",
      uuid: "u-1",
      message: { role: "user", content: "hi" },
      // no isSidechain field
    };
    const path = await makeFixture([evt]);
    const p = await extractClaudePersonality(path);
    expect(p.sidechainEvents).toBe(0);
  });

  it("isSidechain:false explicitly → 0", async () => {
    const path = await makeFixture([
      userEvent("2026-01-01T00:00:00Z", "main", { sidechain: false }),
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.sidechainEvents).toBe(0);
  });

  it("sidechain without uuid still counts", async () => {
    const evt = {
      type: "user",
      sessionId: "s",
      timestamp: "2026-01-01T00:00:00Z",
      cwd: "/tmp",
      isSidechain: true,
      // intentional: no uuid
      message: { role: "user", content: "side" },
    };
    const path = await makeFixture([evt]);
    const p = await extractClaudePersonality(path);
    expect(p.sidechainEvents).toBe(1);
  });
});
