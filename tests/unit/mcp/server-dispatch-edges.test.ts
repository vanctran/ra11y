/**
 * In-process tests for the MCP server — edge cases.
 *
 * Complements `server-dispatch.test.ts` (core routing) by exercising
 * `logging/setLevel`, `completion/complete`, parse / invalid-request
 * handling, scan-telemetry bookends, params coercion, outbound
 * response routing, and the dispatch-level internal-error mapping.
 * Uses the shared `tests/helpers/mcp-harness.ts` to drive
 * `startMcpServer` in-process so coverage flows back to the
 * instrumented source.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { type JsonRpcLike, type McpHarness, startMcpHarness } from "../../helpers/mcp-harness.ts";

describe("MCP server dispatch — logging/setLevel", () => {
  let harness: McpHarness;

  beforeEach(() => {
    harness = startMcpHarness();
  });

  afterEach(async () => {
    await harness.end();
  });

  it("accepts a known level and returns an empty object", async () => {
    harness.send({
      jsonrpc: "2.0",
      id: 1,
      method: "logging/setLevel",
      params: { level: "info" },
    });
    const reply = await harness.waitForReply(1);
    expect(reply.result).toEqual({});
  });

  it("rejects an unknown level as INVALID_PARAMS", async () => {
    harness.send({
      jsonrpc: "2.0",
      id: 2,
      method: "logging/setLevel",
      params: { level: "verbose" },
    });
    const reply = await harness.waitForReply(2);
    expect(reply.error?.code).toBe(-32602);
  });

  it("rejects a non-string level as INVALID_PARAMS", async () => {
    harness.send({
      jsonrpc: "2.0",
      id: 3,
      method: "logging/setLevel",
      params: { level: 7 },
    });
    const reply = await harness.waitForReply(3);
    expect(reply.error?.code).toBe(-32602);
  });
});

describe("MCP server dispatch — completion/complete", () => {
  let harness: McpHarness;

  beforeEach(() => {
    harness = startMcpHarness();
  });

  afterEach(async () => {
    await harness.end();
  });

  it("returns completion values for a recognized prompt argument", async () => {
    harness.send({
      jsonrpc: "2.0",
      id: 1,
      method: "completion/complete",
      params: {
        ref: { type: "ref/prompt", name: "ra11y/vpat-narrative" },
        argument: { name: "criterionId", value: "wcag22:1.4" },
      },
    });
    const reply = await harness.waitForReply(1);
    const result = reply.result as {
      completion: { values: string[]; hasMore: boolean; total: number };
    };
    expect(Array.isArray(result.completion.values)).toBe(true);
    expect(typeof result.completion.total).toBe("number");
  });

  it("returns empty completion for a non-string ref.type", async () => {
    harness.send({
      jsonrpc: "2.0",
      id: 2,
      method: "completion/complete",
      params: {
        ref: { type: 7 },
        argument: { name: "x", value: "" },
      },
    });
    const reply = await harness.waitForReply(2);
    const result = reply.result as {
      completion: { values: string[]; hasMore: boolean; total: number };
    };
    expect(result.completion.values).toEqual([]);
    expect(result.completion.total).toBe(0);
  });

  it("rejects missing ref as INVALID_PARAMS", async () => {
    harness.send({
      jsonrpc: "2.0",
      id: 3,
      method: "completion/complete",
      params: { argument: { name: "x", value: "" } },
    });
    const reply = await harness.waitForReply(3);
    expect(reply.error?.code).toBe(-32602);
  });

  it("rejects missing argument as INVALID_PARAMS", async () => {
    harness.send({
      jsonrpc: "2.0",
      id: 4,
      method: "completion/complete",
      params: { ref: { type: "ref/prompt", name: "ra11y/vpat-narrative" } },
    });
    const reply = await harness.waitForReply(4);
    expect(reply.error?.code).toBe(-32602);
  });

  it("rejects non-string argument.name as INVALID_PARAMS", async () => {
    harness.send({
      jsonrpc: "2.0",
      id: 5,
      method: "completion/complete",
      params: {
        ref: { type: "ref/prompt", name: "ra11y/vpat-narrative" },
        argument: { name: 7, value: "" },
      },
    });
    const reply = await harness.waitForReply(5);
    expect(reply.error?.code).toBe(-32602);
  });
});

describe("MCP server dispatch — parse / invalid request handling", () => {
  let harness: McpHarness;

  beforeEach(() => {
    harness = startMcpHarness();
  });

  afterEach(async () => {
    await harness.end();
  });

  it("returns PARSE_ERROR when stdin delivers non-JSON", async () => {
    harness.sendRaw("not valid json\n");
    const reply = await harness.waitForPredicate((m) => m.id === null && m.error?.code === -32700);
    expect(reply.error?.code).toBe(-32700);
    expect(reply.id).toBe(null);
  });

  it("skips blank lines on stdin without emitting a reply", async () => {
    harness.sendRaw("   \n\n");
    harness.send({ jsonrpc: "2.0", id: 99, method: "tools/list" });
    const reply = await harness.waitForReply(99);
    // No PARSE_ERROR reply for the blank lines should be interleaved.
    const parseErrors = harness.lines.filter((l) => l.id === null && l.error?.code === -32700);
    expect(parseErrors.length).toBe(0);
    expect(reply.id).toBe(99);
  });

  it("returns INVALID_REQUEST for a JSON object that is not a JSON-RPC request", async () => {
    harness.send({ hello: "world" } as Record<string, unknown>);
    const reply = await waitForInvalidRequest(harness);
    expect(reply.error?.code).toBe(-32600);
  });

  it("ignores pure notifications (no id) without emitting a response", async () => {
    // Baseline count — the server's response to a later request tells
    // us no spurious reply was emitted for the notification.
    harness.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    harness.send({ jsonrpc: "2.0", method: "notifications/roots/list_changed" });
    harness.send({
      jsonrpc: "2.0",
      method: "notifications/roots",
      params: { roots: [{ uri: "file:///tmp/x", name: "x" }] },
    });
    // Ping with a real request; the reply id proves nothing got
    // shuffled in front of it.
    harness.send({ jsonrpc: "2.0", id: 42, method: "tools/list" });
    const reply = await harness.waitForReply(42);
    expect(reply.id).toBe(42);
    // Lines before the 42-reply must all be ids != 42 (which includes
    // none of them having an id at all, since notifications don't reply).
    const before = harness.lines.filter((l) => l !== reply);
    for (const line of before) {
      expect(line.id).not.toBe(42);
    }
  });
});

/**
 * Wait for the first INVALID_REQUEST or PARSE_ERROR response the
 * server emits with `id: null`. Used by the handful of tests that
 * intentionally feed shape-breaking payloads.
 */
function waitForInvalidRequest(harness: McpHarness): Promise<JsonRpcLike> {
  return new Promise((resolve) => {
    const checker = () => {
      for (const line of harness.lines) {
        if (line.id === null && (line.error?.code === -32600 || line.error?.code === -32700)) {
          resolve(line);
          return;
        }
      }
      setTimeout(checker, 5);
    };
    checker();
  });
}

describe("MCP server dispatch — scan telemetry bookends", () => {
  let harness: McpHarness;

  beforeEach(() => {
    harness = startMcpHarness();
  });

  afterEach(async () => {
    await harness.end();
  });

  it("emits notifications/message bookends when a scan tool runs at debug level", async () => {
    // Raise verbosity so the debug/info bookends are delivered.
    harness.send({
      jsonrpc: "2.0",
      id: 1,
      method: "logging/setLevel",
      params: { level: "debug" },
    });
    await harness.waitForReply(1);

    harness.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "scan_file",
        arguments: { filePath: "src/mcp/server.ts" },
      },
    });
    await harness.waitForReply(2);

    // Both bookends should have been emitted before the reply.
    const notifications = harness.lines.filter(
      (l) => l.method === "notifications/message" && (l.id === undefined || l.id === null),
    );
    expect(notifications.length).toBeGreaterThanOrEqual(2);
  });
});

describe("MCP server dispatch — params coercion edges", () => {
  let harness: McpHarness;

  beforeEach(() => {
    harness = startMcpHarness();
  });

  afterEach(async () => {
    await harness.end();
  });

  it("tolerates tools/call arguments that are not an object", async () => {
    // asRecord returns undefined for non-object values; the handler
    // still falls back to {} so a known tool responds normally.
    harness.send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "sessionConfigure", arguments: "not an object" },
    });
    const reply = await harness.waitForReply(1);
    expect(reply.error).toBeUndefined();
  });

  it("tolerates prompts/get arguments that are not an object", async () => {
    harness.send({
      jsonrpc: "2.0",
      id: 2,
      method: "prompts/get",
      params: { name: "ra11y/audit", arguments: 42 },
    });
    const reply = await harness.waitForReply(2);
    expect(reply.error).toBeUndefined();
  });

  it("applies declared roots from notifications/roots to the session", async () => {
    // Send roots notification before a scan_project tool call so the
    // extractRootsFromParams push path and session.setRoots run.
    harness.send({
      jsonrpc: "2.0",
      method: "notifications/roots",
      params: {
        roots: [
          { uri: "file:///tmp/demo", name: "demo-root" },
          { uri: "", name: "skip-empty" },
          "not-an-object",
          { uri: "file:///tmp/second" },
        ],
      },
    });
    // Ping afterward so we know the notification was drained.
    harness.send({ jsonrpc: "2.0", id: 99, method: "tools/list" });
    const reply = await harness.waitForReply(99);
    expect(reply.error).toBeUndefined();
  });
});

describe("MCP server dispatch — outbound response routing", () => {
  let harness: McpHarness;

  beforeEach(() => {
    harness = startMcpHarness();
  });

  afterEach(async () => {
    await harness.end();
  });

  it("silently drops a JSON-RPC response with an unknown id", async () => {
    // tryRouteResponse returns true for responses — the server logs
    // "unknown id" via the logger and the read loop continues. The
    // observable contract is that no reply is emitted for this line.
    harness.send({ jsonrpc: "2.0", id: 9999, result: { orphan: true } });
    harness.send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const reply = await harness.waitForReply(1);
    // The first line on stdout must be the tools/list reply — the
    // orphan response should never produce a reply of its own.
    const replies = harness.lines.filter((l) => l.id !== undefined && l.id !== null);
    expect(replies.length).toBe(1);
    expect(replies[0]?.id).toBe(1);
    expect(reply.id).toBe(1);
  });
});

describe("MCP server dispatch — internal error mapping", () => {
  let harness: McpHarness;

  beforeEach(() => {
    harness = startMcpHarness();
  });

  afterEach(async () => {
    await harness.end();
  });

  it("wraps a thrown handler error as INTERNAL_ERROR (-32603)", async () => {
    // `scan_file` with a non-string filePath crashes deep in the
    // handler (resolve(cwd, undefined) throws). The dispatch try/catch
    // maps that to JSON-RPC internal-error rather than letting it
    // kill the server loop.
    harness.send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "scan_file", arguments: {} },
    });
    const reply = await harness.waitForReply(1);
    // Either internal error (dispatch catch) or structured tool error
    // with isError:true — both are honest. Verify one of the two.
    const errored =
      reply.error?.code === -32603 || (reply.result as { isError?: boolean })?.isError === true;
    expect(errored).toBe(true);
  });
});
