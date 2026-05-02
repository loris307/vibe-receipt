import { describe, expect, it } from "vitest";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractClaudePersonality } from "../../src/extract/personality/claude-jsonl.js";

async function makeFixture(events: unknown[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vibe-receipt-test-"));
  const path = join(dir, "session.jsonl");
  await writeFile(path, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return path;
}

function assistantWithToolUse(ts: string, toolName: string, toolId: string) {
  return {
    type: "assistant",
    sessionId: "sess-test",
    timestamp: ts,
    cwd: "/tmp/proj",
    requestId: `req-${ts}`,
    message: {
      id: `msg-${ts}`,
      role: "assistant",
      model: "claude-opus-4-7",
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: toolId, name: toolName, input: {} },
      ],
      usage: {
        input_tokens: 5,
        output_tokens: 5,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  };
}

describe("v0.3 — MCP server extraction", () => {
  it("session without MCP calls → []", async () => {
    const path = await makeFixture([
      assistantWithToolUse("2026-01-01T00:00:00Z", "Bash", "t1"),
      assistantWithToolUse("2026-01-01T00:01:00Z", "Read", "t2"),
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.mcpServers).toEqual([]);
  });

  it("1 MCP call → 1 server with callCount=1, toolCount=1", async () => {
    const path = await makeFixture([
      assistantWithToolUse("2026-01-01T00:00:00Z", "mcp__github__create_issue", "t1"),
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.mcpServers).toEqual([{ name: "github", callCount: 1, toolCount: 1 }]);
  });

  it("server name with underscore handled (my_server)", async () => {
    const path = await makeFixture([
      assistantWithToolUse("2026-01-01T00:00:00Z", "mcp__my_server__list_files", "t1"),
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.mcpServers[0]!.name).toBe("my_server");
  });

  it("triple-underscore tool name: tool=b__c", async () => {
    const path = await makeFixture([
      assistantWithToolUse("2026-01-01T00:00:00Z", "mcp__a__b__c", "t1"),
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.mcpServers[0]!.name).toBe("a");
    expect(p.mcpServers[0]!.toolCount).toBe(1); // tool="b__c" — single tool
  });

  it("same server, multiple distinct tools → callCount sums, toolCount=distinct", async () => {
    const path = await makeFixture([
      assistantWithToolUse("2026-01-01T00:00:00Z", "mcp__github__create_issue", "t1"),
      assistantWithToolUse("2026-01-01T00:01:00Z", "mcp__github__create_issue", "t2"),
      assistantWithToolUse("2026-01-01T00:02:00Z", "mcp__github__list_prs", "t3"),
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.mcpServers).toEqual([{ name: "github", callCount: 3, toolCount: 2 }]);
  });

  it("multiple servers sorted desc by callCount, capped at 5", async () => {
    const events: any[] = [];
    let id = 0;
    // 3 servers: heavy=10 calls, medium=5, light=1
    for (let i = 0; i < 10; i++) {
      events.push(assistantWithToolUse(`2026-01-01T00:00:${String(i).padStart(2, "0")}Z`, "mcp__heavy__a", `t${id++}`));
    }
    for (let i = 0; i < 5; i++) {
      events.push(assistantWithToolUse(`2026-01-01T00:01:${String(i).padStart(2, "0")}Z`, "mcp__medium__a", `t${id++}`));
    }
    events.push(assistantWithToolUse("2026-01-01T00:02:00Z", "mcp__light__a", `t${id++}`));
    const path = await makeFixture(events);
    const p = await extractClaudePersonality(path);
    expect(p.mcpServers.map((s) => s.name)).toEqual(["heavy", "medium", "light"]);
    expect(p.mcpServers[0]!.callCount).toBe(10);
  });

  it("non-MCP tools ignored in mcpServers but counted in toolCounts", async () => {
    const path = await makeFixture([
      assistantWithToolUse("2026-01-01T00:00:00Z", "Bash", "t1"),
      assistantWithToolUse("2026-01-01T00:01:00Z", "mcp__github__a", "t2"),
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.mcpServers.map((s) => s.name)).toEqual(["github"]);
    expect(p.toolCounts["Bash"]).toBe(1);
    expect(p.toolCounts["mcp__github__a"]).toBe(1);
  });

  it("malformed pattern 'mcp__only' (no separator) → no match", async () => {
    const path = await makeFixture([
      assistantWithToolUse("2026-01-01T00:00:00Z", "mcp__only", "t1"),
    ]);
    const p = await extractClaudePersonality(path);
    expect(p.mcpServers).toEqual([]);
  });
});
