/**
 * Integration test: MCP `roots` capability plumbing.
 *
 * Spins up the server over real stdio and exercises the host-client
 * contract — roots declared on `initialize.params.roots`, roots
 * pushed later on `notifications/roots`, and the `scan_project`
 * fallback onto the first host-declared root when the caller omits
 * `cwd`. Explicit `cwd` must still win and the response must say so.
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");

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

function initWithRoots(
  id: number,
  roots: readonly { uri: string; name?: string }[],
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: { roots: { listChanged: true } },
      clientInfo: { name: "test-agent", version: "1.0" },
      roots,
    },
  };
}

function initNoRoots(id: number): Record<string, unknown> {
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

function scanProject(id: number, args: Record<string, unknown>): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: "scan_project", arguments: args },
  };
}

/**
 * Writes a minimal fixture tree into a temp dir so tests can declare
 * real file:// roots to the server. Returns the dir for cleanup /
 * URI construction by the caller.
 */
function makeFixtureRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "ra11y-roots-"));
  writeFileSync(
    join(dir, "ok.html"),
    `<!DOCTYPE html><html lang="en"><head><title>ok</title></head><body><h1>ok</h1></body></html>`,
    "utf8",
  );
  return dir;
}

function parseScanBody(response: JsonRpcResponse): Record<string, unknown> {
  const result = response.result as { content: Array<{ text: string }> };
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

describe("MCP roots: declared inline on initialize", () => {
  it("scan_project without cwd falls back onto the first host-declared root", async () => {
    const fixture = makeFixtureRoot();
    const responses = await mcpSession([
      initWithRoots(1, [{ uri: `file://${fixture}`, name: "fixture" }]),
      scanProject(2, {}),
    ]);
    const body = parseScanBody(responses[1]);
    const meta = body.meta as Record<string, unknown>;
    expect(meta.scannedRoot).toBe(fixture);
    expect(meta.rootSource).toBe("host-root");
    expect(meta.hostDeclaredRoots).toEqual([`file://${fixture}`]);
  });

  it("explicit cwd overrides host-declared roots and surfaces the overlap in meta", async () => {
    const hostFixture = makeFixtureRoot();
    const explicitFixture = makeFixtureRoot();
    const responses = await mcpSession([
      initWithRoots(1, [{ uri: `file://${hostFixture}` }]),
      scanProject(2, { cwd: explicitFixture }),
    ]);
    const body = parseScanBody(responses[1]);
    const meta = body.meta as Record<string, unknown>;
    expect(meta.scannedRoot).toBe(explicitFixture);
    expect(meta.rootSource).toBe("explicit");
    expect(meta.hostDeclaredRoots).toEqual([`file://${hostFixture}`]);
    // The overlap note names the host's first root so the agent can
    // decide whether to flip to it next call.
    expect(typeof meta.rootsOverlapNote).toBe("string");
    expect(String(meta.rootsOverlapNote)).toContain(hostFixture);
  });
});

describe("MCP roots: graceful degradation", () => {
  it("a session without declared roots scans normally (no hostDeclaredRoots field)", async () => {
    // Baseline: initialize without roots, scan should still succeed.
    const fixture = makeFixtureRoot();
    const responses = await mcpSession([initNoRoots(1), scanProject(2, { cwd: fixture })]);
    const body = parseScanBody(responses[1]);
    const meta = body.meta as Record<string, unknown>;
    expect(meta.scannedRoot).toBe(fixture);
    expect(meta.rootSource).toBe("explicit");
    // Empty-is-absent: no field rather than an empty list (see
    // CLAUDE.md "ambiguous field shapes are dishonest").
    expect(meta.hostDeclaredRoots).toBeUndefined();
    expect(meta.rootsOverlapNote).toBeUndefined();
  });

  it("non-file:// roots (e.g. opaque URIs) do not block scan_project falling through to spawn cwd", async () => {
    const responses = await mcpSession([
      initWithRoots(1, [{ uri: "opaque://project/my-app" }]),
      scanProject(2, {}),
    ]);
    const body = parseScanBody(responses[1]);
    const meta = body.meta as Record<string, unknown>;
    // The URI can't be scanned, so firstRootPath returns null and the
    // fallback chain continues to git-root / spawn-cwd. The declared
    // root still appears in meta as telemetry.
    expect(meta.hostDeclaredRoots).toEqual(["opaque://project/my-app"]);
    expect(meta.scannedRoot).toBe(PROJECT_ROOT);
  });
});

describe("MCP roots: notifications/roots push", () => {
  it("a host that pushes roots after initialize updates the next scan's scope", async () => {
    const fixture = makeFixtureRoot();
    const responses = await mcpSession([
      initNoRoots(1),
      {
        jsonrpc: "2.0",
        method: "notifications/roots",
        params: { roots: [{ uri: `file://${fixture}` }] },
      },
      scanProject(2, {}),
    ]);
    // Only the initialize + scan get responses; the notification is silent.
    const scanResp = responses.find((r) => r.id === 2);
    expect(scanResp).toBeDefined();
    if (!scanResp) return;
    const body = parseScanBody(scanResp);
    const meta = body.meta as Record<string, unknown>;
    expect(meta.scannedRoot).toBe(fixture);
    expect(meta.rootSource).toBe("host-root");
  });
});
