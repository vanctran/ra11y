/**
 * Integration test: MCP `logging` capability plumbing.
 *
 * Spins up the server over real stdio, exercises `logging/setLevel`,
 * and verifies that scan-family tools emit `notifications/message`
 * start/finish bookends once the threshold is lowered. Default
 * threshold (`warning`) must stay silent so existing hosts that
 * don't opt in never see the noise.
 */

import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");

// JSON-RPC error code (mirrors src/mcp/server.ts).
const INVALID_PARAMS = -32602;

type JsonRpcMessage = Record<string, unknown>;

async function mcpSession(messages: readonly Record<string, unknown>[]): Promise<JsonRpcMessage[]> {
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
    .map((l) => JSON.parse(l) as JsonRpcMessage);
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

function setLevel(id: number, level: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id, method: "logging/setLevel", params: { level } };
}

function scanFile(id: number, path: string): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: "scan_file", arguments: { path } },
  };
}

function isLogNotification(m: JsonRpcMessage): boolean {
  return m["method"] === "notifications/message" && !("id" in m);
}

describe("MCP logging: capability advertisement", () => {
  it("initialize response advertises logging capability", async () => {
    const responses = await mcpSession([initMsg(1)]);
    const result = responses[0].result as {
      capabilities: { logging?: Record<string, unknown> };
    };
    expect(result.capabilities.logging).toBeDefined();
  });
});

describe("MCP logging: setLevel handler", () => {
  it("accepts a valid level and returns an empty-object result", async () => {
    const responses = await mcpSession([initMsg(1), setLevel(2, "info")]);
    expect(responses[1].result).toEqual({});
    expect(responses[1].error).toBeUndefined();
  });

  it("rejects an unknown level with invalid-params", async () => {
    const responses = await mcpSession([initMsg(1), setLevel(2, "verbose")]);
    const err = responses[1].error as { code: number; message: string };
    expect(err.code).toBe(INVALID_PARAMS);
    expect(err.message.toLowerCase()).toContain("log level");
  });
});

describe("MCP logging: scan bookends", () => {
  const goodFixture = join(
    PROJECT_ROOT,
    "tests",
    "fixtures",
    "good",
    "alt-text-missing",
    "img-with-alt.html",
  );

  it("does NOT emit log notifications at the default threshold (warning)", async () => {
    const responses = await mcpSession([initMsg(1), scanFile(2, goodFixture)]);
    const logs = responses.filter(isLogNotification);
    expect(logs.length).toBe(0);
  });

  it("emits a start+finish bookend after setLevel(debug)", async () => {
    const responses = await mcpSession([
      initMsg(1),
      setLevel(2, "debug"),
      scanFile(3, goodFixture),
    ]);
    const logs = responses.filter(isLogNotification);
    // One `debug` on entry, one `info` on completion.
    expect(logs.length).toBe(2);
    const levels = logs.map((l) => (l["params"] as { level: string }).level);
    expect(levels).toEqual(["debug", "info"]);
    const finish = logs[1]["params"] as {
      level: string;
      logger: string;
      message: string;
      data: Record<string, unknown>;
    };
    expect(finish.logger).toBe("ra11y.scan");
    expect(finish.message).toContain("scan_file: complete");
    expect(typeof finish.data.elapsedMs).toBe("number");
    expect(finish.data.tool).toBe("scan_file");
  });

  it("emits only the info completion bookend at setLevel(info)", async () => {
    const responses = await mcpSession([initMsg(1), setLevel(2, "info"), scanFile(3, goodFixture)]);
    const logs = responses.filter(isLogNotification);
    expect(logs.length).toBe(1);
    const level = (logs[0]["params"] as { level: string }).level;
    expect(level).toBe("info");
  });

  it("sanitizes the absolute cwd out of log messages (compliance: no path leak)", async () => {
    const responses = await mcpSession([initMsg(1), setLevel(2, "info"), scanFile(3, goodFixture)]);
    const logs = responses.filter(isLogNotification);
    for (const log of logs) {
      const params = log["params"] as {
        message: string;
        data?: Record<string, unknown>;
      };
      expect(params.message).not.toContain(PROJECT_ROOT);
      if (params.data) {
        const serialized = JSON.stringify(params.data);
        expect(serialized).not.toContain(PROJECT_ROOT);
      }
    }
  });
});
