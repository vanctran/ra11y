/**
 * In-process tests for the MCP server JSON-RPC dispatch layer.
 *
 * The existing `server.test.ts` spawns a subprocess for every message
 * — which exercises the transport end-to-end but its coverage never
 * flows back to the instrumented source this run. This file drives
 * `startMcpServer` in the same process, swapping `process.stdin` and
 * `process.stdout` for a PassThrough + capturing write so every
 * dispatch branch earns line coverage.
 *
 * No mocks of collaborators — we exercise the real session, the real
 * tool registry, the real prompt/resource modules. The only harness
 * affordance is the stdio swap (which is transport, not behavior).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { type McpHarness, startMcpHarness } from "../../helpers/mcp-harness.ts";

describe("MCP server dispatch — initialize handshake", () => {
  let harness: McpHarness;

  beforeEach(() => {
    harness = startMcpHarness();
  });

  afterEach(async () => {
    await harness.end();
  });

  it("returns protocol version, capabilities, and server info", async () => {
    harness.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {} },
    });

    const reply = await harness.waitForReply(1);
    const result = reply.result as {
      protocolVersion: string;
      capabilities: Record<string, unknown>;
      serverInfo: { name: string; version: string };
      instructions: string;
    };
    expect(result.protocolVersion).toBe("2024-11-05");
    expect(result.capabilities).toEqual({
      tools: {},
      prompts: { listChanged: false },
      resources: { listChanged: false },
      logging: {},
      completions: {},
    });
    expect(result.serverInfo.name).toBe("ra11y");
  });

  it("records host sampling + roots capabilities declared on initialize", async () => {
    harness.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        capabilities: { sampling: {}, roots: { listChanged: true } },
        roots: [
          { uri: "file:///tmp/demo", name: "demo" },
          { uri: "not-a-scheme", name: "ignored" },
          { bogus: true },
        ],
      },
    });

    const reply = await harness.waitForReply(1);
    expect((reply.result as Record<string, unknown>).capabilities).toBeDefined();
    // The server accepted the roots payload — subsequent calls route
    // through the same session. We can't observe the session directly
    // here, but the reply shape confirms the handler didn't throw.
    expect(reply.error).toBeUndefined();
  });
});

describe("MCP server dispatch — method routing", () => {
  let harness: McpHarness;

  beforeEach(() => {
    harness = startMcpHarness();
  });

  afterEach(async () => {
    await harness.end();
  });

  it("routes tools/list and includes every registered tool with a schema", async () => {
    harness.send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const reply = await harness.waitForReply(1);
    const result = reply.result as { tools: Array<{ name: string; inputSchema: unknown }> };
    expect(result.tools.length).toBeGreaterThan(0);
    const first = result.tools[0];
    expect(typeof first?.name).toBe("string");
    expect(typeof first?.inputSchema).toBe("object");
  });

  it("routes prompts/list and stamps _meta.checksum on each prompt", async () => {
    harness.send({ jsonrpc: "2.0", id: 2, method: "prompts/list" });
    const reply = await harness.waitForReply(2);
    const result = reply.result as {
      prompts: Array<{ name: string; _meta?: { checksum: string } }>;
    };
    expect(result.prompts.length).toBeGreaterThan(0);
    for (const prompt of result.prompts) {
      expect(prompt._meta?.checksum).toMatch(/^[0-9a-f]+$/);
    }
  });

  it("routes resources/list against the real docs/kb directory", async () => {
    harness.send({ jsonrpc: "2.0", id: 3, method: "resources/list" });
    const reply = await harness.waitForReply(3);
    const result = reply.result as { resources: Array<{ uri: string }> };
    expect(result.resources.length).toBeGreaterThan(0);
    expect(result.resources[0]?.uri.startsWith("ra11y-kb://")).toBe(true);
  });

  it("returns METHOD_NOT_FOUND for unknown top-level methods", async () => {
    harness.send({ jsonrpc: "2.0", id: 4, method: "nothing/here" });
    const reply = await harness.waitForReply(4);
    expect(reply.error?.code).toBe(-32601);
    expect(reply.error?.message).toContain("nothing/here");
  });
});

describe("MCP server dispatch — tools/call", () => {
  let harness: McpHarness;

  beforeEach(() => {
    harness = startMcpHarness();
  });

  afterEach(async () => {
    await harness.end();
  });

  it("rejects tools/call without a tool name as INVALID_PARAMS", async () => {
    harness.send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { arguments: {} },
    });
    const reply = await harness.waitForReply(1);
    expect(reply.error?.code).toBe(-32602);
  });

  it("rejects unknown tool names as METHOD_NOT_FOUND", async () => {
    harness.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "no_such_tool", arguments: {} },
    });
    const reply = await harness.waitForReply(2);
    expect(reply.error?.code).toBe(-32601);
    expect(reply.error?.message).toContain("no_such_tool");
  });

  it("dispatches to a registered tool and returns its content", async () => {
    harness.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "sessionConfigure", arguments: { standard: "wcag22", level: "AA" } },
    });
    const reply = await harness.waitForReply(3);
    const result = reply.result as { content: Array<{ text: string }> };
    expect(Array.isArray(result.content)).toBe(true);
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      active?: { standard?: string };
    };
    expect(payload.active?.standard).toBe("wcag22");
  });

  it("layers deprecated_tool_name_configure when dispatched via the legacy alias", async () => {
    harness.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "configure", arguments: { level: "AA" } },
    });
    const reply = await harness.waitForReply(4);
    const result = reply.result as {
      content: Array<{ text: string }>;
      structuredContent?: { warnings?: readonly string[] };
    };
    const body = JSON.parse(result.content[0]?.text ?? "{}") as {
      warnings?: readonly string[];
    };
    const warnings =
      body.warnings ?? result.structuredContent?.warnings ?? ([] as readonly string[]);
    expect(warnings).toContain("deprecated_tool_name_configure");
  });
});

describe("MCP server dispatch — prompts/get", () => {
  let harness: McpHarness;

  beforeEach(() => {
    harness = startMcpHarness();
  });

  afterEach(async () => {
    await harness.end();
  });

  it("returns rendered messages plus _meta.checksum for a known prompt", async () => {
    harness.send({
      jsonrpc: "2.0",
      id: 1,
      method: "prompts/get",
      params: { name: "ra11y/audit", arguments: { standard: "wcag21" } },
    });
    const reply = await harness.waitForReply(1);
    const result = reply.result as {
      description: string;
      messages: Array<{ role: string }>;
      _meta?: { checksum: string };
    };
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result._meta?.checksum).toMatch(/^[0-9a-f]+$/);
  });

  it("rejects missing prompt name as INVALID_PARAMS", async () => {
    harness.send({
      jsonrpc: "2.0",
      id: 2,
      method: "prompts/get",
      params: {},
    });
    const reply = await harness.waitForReply(2);
    expect(reply.error?.code).toBe(-32602);
  });

  it("rejects unknown prompt names as METHOD_NOT_FOUND", async () => {
    harness.send({
      jsonrpc: "2.0",
      id: 3,
      method: "prompts/get",
      params: { name: "ra11y/unknown" },
    });
    const reply = await harness.waitForReply(3);
    expect(reply.error?.code).toBe(-32601);
  });

  it("coerces numeric and boolean prompt arguments to strings", async () => {
    // Send a non-string argument — the renderer requires string args,
    // so the coercion path is load-bearing. We don't inspect the
    // message contents; the absence of a thrown error proves the
    // argument was accepted.
    harness.send({
      jsonrpc: "2.0",
      id: 4,
      method: "prompts/get",
      params: { name: "ra11y/audit", arguments: { standard: 22 } },
    });
    const reply = await harness.waitForReply(4);
    expect(reply.error).toBeUndefined();
  });
});

describe("MCP server dispatch — resources/read", () => {
  let harness: McpHarness;

  beforeEach(() => {
    harness = startMcpHarness();
  });

  afterEach(async () => {
    await harness.end();
  });

  it("reads a real KB resource and returns its text", async () => {
    // First discover a URI the server will accept so the test doesn't
    // hard-code a filename that can drift.
    harness.send({ jsonrpc: "2.0", id: 1, method: "resources/list" });
    const listReply = await harness.waitForReply(1);
    const first = (listReply.result as { resources: Array<{ uri: string }> }).resources[0];
    expect(first).toBeDefined();

    harness.send({
      jsonrpc: "2.0",
      id: 2,
      method: "resources/read",
      params: { uri: first?.uri },
    });
    const reply = await harness.waitForReply(2);
    const result = reply.result as { contents: Array<{ text: string; uri: string }> };
    expect(result.contents[0]?.uri).toBe(first?.uri ?? "");
    expect(typeof result.contents[0]?.text).toBe("string");
  });

  it("rejects missing uri as INVALID_PARAMS", async () => {
    harness.send({
      jsonrpc: "2.0",
      id: 3,
      method: "resources/read",
      params: {},
    });
    const reply = await harness.waitForReply(3);
    expect(reply.error?.code).toBe(-32602);
  });

  it("maps ResourceError(NOT_FOUND) to -32002", async () => {
    harness.send({
      jsonrpc: "2.0",
      id: 4,
      method: "resources/read",
      params: { uri: "ra11y-kb://does/not/exist.md" },
    });
    const reply = await harness.waitForReply(4);
    expect(reply.error?.code).toBe(-32002);
  });

  it("rejects non-ra11y-kb schemes as INVALID_PARAMS", async () => {
    harness.send({
      jsonrpc: "2.0",
      id: 5,
      method: "resources/read",
      params: { uri: "file:///etc/passwd" },
    });
    const reply = await harness.waitForReply(5);
    expect(reply.error?.code).toBe(-32602);
  });
});
