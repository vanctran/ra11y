/**
 * Integration test: MCP `completions` capability plumbing.
 *
 * Spins up the server over real stdio and exercises
 * `completion/complete` on the two supported surfaces:
 *   - `ref/prompt` on `ra11y/vpat-narrative`, argument `criterionId`
 *   - `ref/resource` on any `ra11y-kb://` URI
 * Plus the empty-completion contract for unknown refs / unknown
 * prompt arguments, which the spec requires as the graceful
 * degradation path.
 */

import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");

// JSON-RPC error code (mirrors src/mcp/server.ts).
const INVALID_PARAMS = -32602;

type JsonRpcResponse = Record<string, unknown>;

async function mcpSession(
  messages: readonly Record<string, unknown>[],
): Promise<JsonRpcResponse[]> {
  const proc = Bun.spawn(["bun", "run", "src/cli.ts", "--mcp"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    cwd: PROJECT_ROOT,
  });

  const payload = `${messages.map((m) => JSON.stringify(m)).join("\n")}\n`;
  proc.stdin.write(payload);
  proc.stdin.end();

  const text = await new Response(proc.stdout).text();
  proc.kill();

  return text
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as JsonRpcResponse);
}

function initMsg(id: number): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-agent", version: "1.0" },
    },
  };
}

function completeMsg(
  id: number,
  ref: Record<string, unknown>,
  argument: Record<string, unknown>,
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    method: "completion/complete",
    params: { ref, argument },
  };
}

interface CompletionResult {
  readonly completion: {
    readonly values: readonly string[];
    readonly hasMore: boolean;
    readonly total: number;
  };
}

describe("MCP completions: capability advertisement", () => {
  it("initialize response advertises completions capability", async () => {
    const responses = await mcpSession([initMsg(1)]);
    const result = responses[0].result as {
      capabilities: { completions?: Record<string, unknown> };
    };
    expect(result.capabilities.completions).toBeDefined();
  });
});

describe("MCP completions: prompt criterion-ID prefix match", () => {
  it("returns wcag22:1.4.x criteria when value prefix is `wcag22:1.4`", async () => {
    const responses = await mcpSession([
      initMsg(1),
      completeMsg(
        2,
        { type: "ref/prompt", name: "ra11y/vpat-narrative" },
        { name: "criterionId", value: "wcag22:1.4" },
      ),
    ]);
    const result = responses[1].result as CompletionResult;
    expect(result.completion.values.length).toBeGreaterThan(5);
    for (const v of result.completion.values) {
      expect(v.startsWith("wcag22:1.4")).toBe(true);
    }
    // 1.4.3 (Contrast Minimum) must be in the list — canonical anchor.
    expect(result.completion.values).toContain("wcag22:1.4.3");
    expect(result.completion.total).toBe(result.completion.values.length);
  });

  it("returns every criterion ID when value is empty", async () => {
    const responses = await mcpSession([
      initMsg(1),
      completeMsg(
        2,
        { type: "ref/prompt", name: "ra11y/vpat-narrative" },
        { name: "criterionId", value: "" },
      ),
    ]);
    const result = responses[1].result as CompletionResult;
    // We load wcag22 + wcag21 + section508 + en301549 — comfortably >100 combined.
    expect(result.completion.total).toBeGreaterThan(100);
    // hasMore must be honest when results exceed the 100 cap.
    expect(result.completion.hasMore).toBe(true);
    expect(result.completion.values.length).toBe(100);
  });

  it("returns empty completion for an unknown prompt argument (spec contract)", async () => {
    const responses = await mcpSession([
      initMsg(1),
      completeMsg(
        2,
        { type: "ref/prompt", name: "ra11y/vpat-narrative" },
        { name: "unknownArg", value: "wcag" },
      ),
    ]);
    const result = responses[1].result as CompletionResult;
    expect(result).toEqual({ completion: { values: [], hasMore: false, total: 0 } });
  });

  it("returns empty completion for an unknown prompt name", async () => {
    const responses = await mcpSession([
      initMsg(1),
      completeMsg(
        2,
        { type: "ref/prompt", name: "ra11y/does-not-exist" },
        { name: "criterionId", value: "wcag" },
      ),
    ]);
    const result = responses[1].result as CompletionResult;
    expect(result.completion.values).toEqual([]);
    expect(result.completion.total).toBe(0);
  });
});

describe("MCP completions: KB resource URI match", () => {
  it("matches a partial slug against every KB URI", async () => {
    const responses = await mcpSession([
      initMsg(1),
      completeMsg(2, { type: "ref/resource", uri: "ra11y-kb://" }, { name: "uri", value: "1-4-3" }),
    ]);
    const result = responses[1].result as CompletionResult;
    expect(result.completion.values).toContain("ra11y-kb://wcag/1-4-3.md");
    for (const v of result.completion.values) {
      expect(v.includes("1-4-3")).toBe(true);
    }
  });

  it("returns empty completion for a non-ra11y-kb resource ref", async () => {
    const responses = await mcpSession([
      initMsg(1),
      completeMsg(
        2,
        { type: "ref/resource", uri: "file:///etc/passwd" },
        { name: "uri", value: "passwd" },
      ),
    ]);
    const result = responses[1].result as CompletionResult;
    expect(result.completion.values).toEqual([]);
  });
});

describe("MCP completions: unknown ref and malformed request", () => {
  it("returns empty completion for an unfamiliar ref type (spec contract)", async () => {
    const responses = await mcpSession([
      initMsg(1),
      completeMsg(2, { type: "ref/unknown" }, { name: "x", value: "y" }),
    ]);
    const result = responses[1].result as CompletionResult;
    expect(result).toEqual({ completion: { values: [], hasMore: false, total: 0 } });
  });

  it("returns invalid-params when `ref` is missing", async () => {
    const responses = await mcpSession([
      initMsg(1),
      {
        jsonrpc: "2.0",
        id: 2,
        method: "completion/complete",
        params: { argument: { name: "x", value: "y" } },
      },
    ]);
    const err = responses[1].error as { code: number };
    expect(err.code).toBe(INVALID_PARAMS);
  });

  it("returns invalid-params when `argument.name` is not a string", async () => {
    const responses = await mcpSession([
      initMsg(1),
      completeMsg(2, { type: "ref/prompt", name: "ra11y/vpat-narrative" }, { name: 42, value: "" }),
    ]);
    const err = responses[1].error as { code: number };
    expect(err.code).toBe(INVALID_PARAMS);
  });
});
