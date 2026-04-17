/**
 * Integration test: MCP resources/list + resources/read round-trip.
 *
 * Exercises the same stdio path the real MCP host uses. Uses `docs/kb/**`
 * as the resource source, so the lower-bound counts below are safe against
 * KB growth — they only pin "at least this many" and a handful of
 * canonical URIs every agent should be able to construct from a rule or
 * criterion ID without a lookup.
 */

import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");

// JSON-RPC error codes (mirrors src/mcp/server.ts + src/mcp/resources/index.ts).
const INVALID_PARAMS = -32602;
const RESOURCE_NOT_FOUND = -32002;

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

function resourcesList(id: number): Record<string, unknown> {
  return { jsonrpc: "2.0", id, method: "resources/list" };
}

function resourcesRead(id: number, uri: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id, method: "resources/read", params: { uri } };
}

interface ResourceEntry {
  readonly uri: string;
  readonly name: string;
  readonly mimeType: string;
  readonly description?: string;
}

interface ResourceReadResult {
  readonly contents: readonly {
    readonly uri: string;
    readonly mimeType: string;
    readonly text: string;
  }[];
}

describe("MCP resources capability advertisement", () => {
  it("declares resources capability on initialize with listChanged:false", async () => {
    const responses = await mcpSession([initMsg(1)]);
    const result = responses[0].result as {
      capabilities: {
        tools?: unknown;
        prompts?: unknown;
        resources?: { listChanged?: boolean };
      };
    };
    expect(result.capabilities.resources).toBeDefined();
    expect(result.capabilities.resources?.listChanged).toBe(false);
    // Existing capabilities remain — resources is additive.
    expect(result.capabilities.tools).toBeDefined();
    expect(result.capabilities.prompts).toBeDefined();
  });
});

describe("MCP resources/list: inventory shape", () => {
  it("returns the full docs/kb/** inventory with stable ordering and unique URIs", async () => {
    const responses = await mcpSession([initMsg(1), resourcesList(2)]);
    const resources = (responses[1].result as { resources: ResourceEntry[] }).resources;
    // Lower bound — KB grows, we don't pin exact count.
    expect(resources.length).toBeGreaterThanOrEqual(50);

    const uris = resources.map((r) => r.uri);
    expect(new Set(uris).size).toBe(uris.length);

    const sorted = [...uris].sort();
    expect(uris).toEqual(sorted);
  });

  it("uses the ra11y-kb:// scheme, text/markdown mime, and populated names", async () => {
    const responses = await mcpSession([initMsg(1), resourcesList(2)]);
    const resources = (responses[1].result as { resources: ResourceEntry[] }).resources;
    for (const r of resources) {
      expect(r.uri.startsWith("ra11y-kb://")).toBe(true);
      expect(r.mimeType).toBe("text/markdown");
      expect(typeof r.name).toBe("string");
      expect(r.name.length).toBeGreaterThan(0);
      if (r.description !== undefined) {
        expect(typeof r.description).toBe("string");
        expect(r.description.length).toBeGreaterThan(0);
      }
    }
  });

  it("exposes canonical WCAG, rule, standard, and glossary URIs agents can construct by convention", async () => {
    const responses = await mcpSession([initMsg(1), resourcesList(2)]);
    const resources = (responses[1].result as { resources: ResourceEntry[] }).resources;
    const uris = new Set(resources.map((r) => r.uri));
    // Spot-check URIs from each KB subtree an agent would address by ID.
    expect(uris.has("ra11y-kb://wcag/1-4-3.md")).toBe(true);
    expect(uris.has("ra11y-kb://standards/wcag22.md")).toBe(true);
    expect(uris.has("ra11y-kb://glossary.md")).toBe(true);
    expect(uris.has("ra11y-kb://architecture/mcp-server.md")).toBe(true);
  });
});

describe("MCP resources/read: content delivery", () => {
  it("returns the raw markdown text for a canonical WCAG URI", async () => {
    const responses = await mcpSession([initMsg(1), resourcesRead(2, "ra11y-kb://wcag/1-4-3.md")]);
    const result = responses[1].result as ResourceReadResult;
    expect(result.contents.length).toBe(1);
    const entry = result.contents[0];
    expect(entry?.uri).toBe("ra11y-kb://wcag/1-4-3.md");
    expect(entry?.mimeType).toBe("text/markdown");
    // The generator emits a `# 1.4.3 ...` heading — guard against silent content loss.
    expect(entry?.text).toContain("1.4.3");
    expect((entry?.text ?? "").length).toBeGreaterThan(50);
  });

  it("returns the glossary markdown with a stable anchor the agent can search", async () => {
    const responses = await mcpSession([initMsg(1), resourcesRead(2, "ra11y-kb://glossary.md")]);
    const result = responses[1].result as ResourceReadResult;
    const text = result.contents[0]?.text ?? "";
    expect(text).toContain("# Glossary");
  });
});

describe("MCP resources/read: error paths", () => {
  it("rejects a non-ra11y-kb scheme with invalid-params", async () => {
    const responses = await mcpSession([initMsg(1), resourcesRead(2, "file:///etc/passwd")]);
    const err = responses[1].error as { code: number; message: string };
    expect(err.code).toBe(INVALID_PARAMS);
    expect(err.message).toContain("scheme");
  });

  it("rejects a ..-traversal URI with invalid-params and does not read the file", async () => {
    const responses = await mcpSession([
      initMsg(1),
      resourcesRead(2, "ra11y-kb://../../../etc/hosts"),
    ]);
    const err = responses[1].error as { code: number; message: string };
    expect(err.code).toBe(INVALID_PARAMS);
    expect(err.message).toContain("traversal");
  });

  it("returns resource-not-found for a well-formed URI that points nowhere", async () => {
    const responses = await mcpSession([
      initMsg(1),
      resourcesRead(2, "ra11y-kb://unknown-file-that-does-not-exist.md"),
    ]);
    const err = responses[1].error as { code: number; message: string };
    expect(err.code).toBe(RESOURCE_NOT_FOUND);
    expect(err.message).toContain("unknown-file-that-does-not-exist.md");
  });

  it("returns invalid-params when uri is missing entirely", async () => {
    const responses = await mcpSession([
      initMsg(1),
      { jsonrpc: "2.0", id: 2, method: "resources/read", params: {} },
    ]);
    const err = responses[1].error as { code: number };
    expect(err.code).toBe(INVALID_PARAMS);
  });

  it("returns invalid-params when uri is not a string", async () => {
    const responses = await mcpSession([
      initMsg(1),
      { jsonrpc: "2.0", id: 2, method: "resources/read", params: { uri: 42 } },
    ]);
    const err = responses[1].error as { code: number };
    expect(err.code).toBe(INVALID_PARAMS);
  });
});
