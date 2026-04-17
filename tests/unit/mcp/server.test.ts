/**
 * Unit tests for the MCP JSON-RPC server layer.
 *
 * Tests message parsing, routing, and error handling without
 * spawning a subprocess — we call the internal dispatch logic
 * by simulating stdin/stdout via the server's exported functions.
 *
 * Since the server reads from stdin and writes to stdout, the
 * integration test (tests/integration/mcp-session.test.ts) covers
 * the real stdio transport. These tests exercise the JSON-RPC
 * protocol contract at the message level.
 */

import { describe, expect, it } from "bun:test";

/**
 * Helper: sends a JSON-RPC message to the server subprocess and
 * reads the response. Uses a short-lived process per test to
 * avoid cross-test state leaks.
 */
async function rpc(message: Record<string, unknown>): Promise<Record<string, unknown>> {
  const proc = Bun.spawn(["bun", "run", "src/cli.ts", "--mcp"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    cwd: import.meta.dir.replace("/tests/unit/mcp", ""),
  });

  const payload = `${JSON.stringify(message)}\n`;
  proc.stdin.write(payload);
  proc.stdin.end();

  const text = await new Response(proc.stdout).text();
  proc.kill();

  const lines = text
    .trim()
    .split("\n")
    .filter((l) => l.length > 0);
  if (lines.length === 0) return {};
  return JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
}

describe("MCP server JSON-RPC", () => {
  it("responds to initialize with protocol version and capabilities", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0" },
      },
    });

    expect(res.jsonrpc).toBe("2.0");
    expect(res.id).toBe(1);
    const result = res.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe("2024-11-05");
    expect(result.capabilities).toEqual({ tools: {} });
    const info = result.serverInfo as Record<string, unknown>;
    expect(info.name).toBe("ra11y");
    expect(typeof info.version).toBe("string");
    expect(typeof result.instructions).toBe("string");
  });

  it("responds to tools/list with every registered tool", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });

    expect(res.id).toBe(2);
    const result = res.result as { tools: Array<{ name: string }> };
    expect(result.tools.length).toBe(15);

    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "audit",
      "baseline",
      "checklist",
      "configure",
      "coverage",
      "detect_native_wrappers",
      "explain_rule",
      "explain_standard",
      "list_rules",
      "review_candidates",
      "scan",
      "scan_diff",
      "scan_file",
      "scan_project",
      "suggest_fix",
    ]);

    // Every tool has a description and inputSchema.
    for (const tool of result.tools) {
      const t = tool as Record<string, unknown>;
      expect(typeof t.description).toBe("string");
      expect(typeof t.inputSchema).toBe("object");
    }
  });

  it("returns METHOD_NOT_FOUND for unknown methods", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: 3,
      method: "nonexistent/method",
    });

    expect(res.id).toBe(3);
    const err = res.error as { code: number; message: string };
    expect(err.code).toBe(-32601);
    expect(err.message).toContain("not found");
  });

  it("returns INVALID_PARAMS for tools/call with missing tool name", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { arguments: {} },
    });

    expect(res.id).toBe(4);
    const err = res.error as { code: number; message: string };
    expect(err.code).toBe(-32602);
  });

  it("returns error for tools/call with unknown tool", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "nonexistent_tool", arguments: {} },
    });

    expect(res.id).toBe(5);
    const err = res.error as { code: number; message: string };
    expect(err.code).toBe(-32601);
    expect(err.message).toContain("nonexistent_tool");
  });

  it("handles parse errors for invalid JSON", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "--mcp"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      cwd: import.meta.dir.replace("/tests/unit/mcp", ""),
    });

    proc.stdin.write("not valid json\n");
    proc.stdin.end();

    const text = await new Response(proc.stdout).text();
    proc.kill();

    const lines = text
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    const res = JSON.parse(lines[0]) as Record<string, unknown>;
    const err = res.error as { code: number };
    expect(err.code).toBe(-32700); // PARSE_ERROR
  });
});
