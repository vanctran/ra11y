/**
 * Integration test: MCP prompts/list + prompts/get round-trip.
 *
 * Exercises the same stdio path the real MCP host uses, so any drift
 * between the server's advertised capability and the shipped prompts
 * inventory surfaces here. Mirrors `mcp-protocol.test.ts`'s spawn model.
 */

import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");

// JSON-RPC error codes (mirrors src/mcp/server.ts).
const METHOD_NOT_FOUND = -32601;
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

function promptsList(id: number): Record<string, unknown> {
  return { jsonrpc: "2.0", id, method: "prompts/list" };
}

function promptsGet(
  id: number,
  name: string,
  args?: Record<string, unknown>,
): Record<string, unknown> {
  const params: Record<string, unknown> = { name };
  if (args) params["arguments"] = args;
  return { jsonrpc: "2.0", id, method: "prompts/get", params };
}

const EXPECTED_PROMPT_NAMES = ["ra11y/triage", "ra11y/fix", "ra11y/audit", "ra11y/vpat-narrative"];

interface PromptListEntry {
  readonly name: string;
  readonly description: string;
  readonly arguments: readonly { name: string; description: string; required: boolean }[];
}

interface PromptGetResult {
  readonly description: string;
  readonly messages: readonly {
    role: string;
    content: { type: string; text: string };
  }[];
}

describe("MCP prompts capability advertisement", () => {
  it("declares prompts capability on initialize with listChanged:false", async () => {
    const responses = await mcpSession([initMsg(1)]);
    const result = responses[0].result as {
      capabilities: { tools?: unknown; prompts?: { listChanged?: boolean } };
    };
    expect(result.capabilities.prompts).toBeDefined();
    expect(result.capabilities.prompts?.listChanged).toBe(false);
    // Tools capability remains — prompts is additive.
    expect(result.capabilities.tools).toBeDefined();
  });
});

describe("MCP prompts/list: inventory shape", () => {
  it("returns exactly the four built-in prompts by name", async () => {
    const responses = await mcpSession([initMsg(1), promptsList(2)]);
    const prompts = (responses[1].result as { prompts: PromptListEntry[] }).prompts;
    expect(prompts.length).toBe(EXPECTED_PROMPT_NAMES.length);
    const names = new Set(prompts.map((p) => p.name));
    for (const expected of EXPECTED_PROMPT_NAMES) {
      expect(names.has(expected)).toBe(true);
    }
  });

  it("each prompt has a non-empty description and a typed arguments array", async () => {
    const responses = await mcpSession([initMsg(1), promptsList(2)]);
    const prompts = (responses[1].result as { prompts: PromptListEntry[] }).prompts;
    for (const p of prompts) {
      expect(typeof p.description).toBe("string");
      expect(p.description.length).toBeGreaterThan(0);
      expect(Array.isArray(p.arguments)).toBe(true);
      for (const arg of p.arguments) {
        expect(typeof arg.name).toBe("string");
        expect(typeof arg.description).toBe("string");
        expect(typeof arg.required).toBe("boolean");
      }
    }
  });

  it("ra11y/vpat-narrative declares criterionId as required and tone as optional", async () => {
    const responses = await mcpSession([initMsg(1), promptsList(2)]);
    const prompts = (responses[1].result as { prompts: PromptListEntry[] }).prompts;
    const vpat = prompts.find((p) => p.name === "ra11y/vpat-narrative");
    expect(vpat).toBeDefined();
    const criterion = vpat?.arguments.find((a) => a.name === "criterionId");
    const tone = vpat?.arguments.find((a) => a.name === "tone");
    expect(criterion?.required).toBe(true);
    expect(tone?.required).toBe(false);
  });
});

describe("MCP prompts/get: rendering", () => {
  it("returns a single user-role message for ra11y/triage with no arguments", async () => {
    const responses = await mcpSession([initMsg(1), promptsGet(2, "ra11y/triage")]);
    const result = responses[1].result as PromptGetResult;
    expect(typeof result.description).toBe("string");
    expect(result.messages.length).toBe(1);
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[0].content.type).toBe("text");
    expect(result.messages[0].content.text.length).toBeGreaterThan(0);
    // With no `focus` argument, the prompt uses its no-focus default phrasing.
    expect(result.messages[0].content.text).toContain("Triage every finding");
  });

  it("substitutes the focus argument into ra11y/triage", async () => {
    const responses = await mcpSession([
      initMsg(1),
      promptsGet(2, "ra11y/triage", { focus: "wcag22:1.4.3" }),
    ]);
    const text = (responses[1].result as PromptGetResult).messages[0].content.text;
    expect(text).toContain("wcag22:1.4.3");
    // The no-focus default must NOT appear when a focus is supplied.
    expect(text).not.toContain("Triage every finding");
  });

  it("substitutes the required criterionId into ra11y/vpat-narrative", async () => {
    const responses = await mcpSession([
      initMsg(1),
      promptsGet(2, "ra11y/vpat-narrative", { criterionId: "wcag22:2.4.5", tone: "plain" }),
    ]);
    const text = (responses[1].result as PromptGetResult).messages[0].content.text;
    expect(text).toContain("wcag22:2.4.5");
    expect(text).toContain("plain");
  });

  it("falls back to default tone for ra11y/vpat-narrative when tone is omitted", async () => {
    const responses = await mcpSession([
      initMsg(1),
      promptsGet(2, "ra11y/vpat-narrative", { criterionId: "wcag22:1.3.1" }),
    ]);
    const text = (responses[1].result as PromptGetResult).messages[0].content.text;
    expect(text).toContain("professional");
  });

  it("defaults ra11y/audit to wcag22 when standard is omitted", async () => {
    const responses = await mcpSession([initMsg(1), promptsGet(2, "ra11y/audit")]);
    const text = (responses[1].result as PromptGetResult).messages[0].content.text;
    expect(text).toContain("wcag22");
  });

  it("honors a custom standard on ra11y/audit", async () => {
    const responses = await mcpSession([
      initMsg(1),
      promptsGet(2, "ra11y/audit", { standard: "section508" }),
    ]);
    const text = (responses[1].result as PromptGetResult).messages[0].content.text;
    expect(text).toContain("section508");
  });

  it("renders ra11y/fix with and without findingId, switching the target-selection sentence", async () => {
    const [noArg, withArg] = await Promise.all([
      mcpSession([initMsg(1), promptsGet(2, "ra11y/fix")]),
      mcpSession([
        initMsg(1),
        promptsGet(2, "ra11y/fix", { findingId: "contrast/minimum@src/Button.tsx:42" }),
      ]),
    ]);
    const noArgText = (noArg[1].result as PromptGetResult).messages[0].content.text;
    const withArgText = (withArg[1].result as PromptGetResult).messages[0].content.text;
    expect(noArgText).toContain("`scan_project`");
    expect(withArgText).toContain("contrast/minimum@src/Button.tsx:42");
    // allowWrite guidance is present in both renderings — it's an invariant
    // of the fix workflow, not a rendered substitution.
    expect(noArgText).toContain("allowWrite");
    expect(withArgText).toContain("allowWrite");
  });
});

describe("MCP prompts/get: error paths", () => {
  it("returns method-not-found (-32601) for an unknown prompt name", async () => {
    const responses = await mcpSession([initMsg(1), promptsGet(2, "ra11y/does-not-exist")]);
    const err = responses[1].error as { code: number; message: string };
    expect(err.code).toBe(METHOD_NOT_FOUND);
    expect(err.message).toContain("ra11y/does-not-exist");
  });

  it("returns invalid-params (-32602) when prompt name is missing", async () => {
    const responses = await mcpSession([
      initMsg(1),
      { jsonrpc: "2.0", id: 2, method: "prompts/get", params: {} },
    ]);
    const err = responses[1].error as { code: number };
    expect(err.code).toBe(INVALID_PARAMS);
  });

  it("returns invalid-params (-32602) when prompt name is not a string", async () => {
    const responses = await mcpSession([
      initMsg(1),
      { jsonrpc: "2.0", id: 2, method: "prompts/get", params: { name: 42 } },
    ]);
    const err = responses[1].error as { code: number };
    expect(err.code).toBe(INVALID_PARAMS);
  });
});
