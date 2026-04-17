/**
 * Integration tests for the hard-error envelope on nonexistent scan
 * targets (Track Q / P0-F). The soft-signal `warnings: [...]` path
 * (Track Q / P0-E) covers valid-but-empty scan targets; this test
 * covers the discriminator — "does the path even exist?" — and asserts
 * each scan tool emits the structured `errorResult` envelope for
 * malformed input instead of a successful empty response.
 *
 * CLAUDE.md §1 "Zero-output success is ambiguous failure" is the rule
 * these envelopes enforce: an agent that typos a cwd or `paths` entry
 * gets `code: "cwd-not-found"` / `code: "scan-paths-not-found"` /
 * `code: "file-unsupported"` back with `isError: true`, not an empty
 * plan that reads the same as a clean codebase.
 *
 * Three directions guarded per tool:
 *
 *   - nonexistent path → `errorResult` with the expected code + details
 *   - valid path, zero parseable files → unchanged (success + warnings)
 *   - valid path with parseable content → unchanged (normal scan)
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const BAD_ALT_DIR = join(PROJECT_ROOT, "tests", "fixtures", "bad", "alt-text-missing");
const BAD_ALT_FILE = join(BAD_ALT_DIR, "img-no-alt.html");

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

function toolCall(
  id: number,
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

interface ToolResult {
  readonly content: Array<{ readonly text: string }>;
  readonly structuredContent?: {
    readonly code?: string;
    readonly details?: Record<string, unknown>;
    readonly remediation?: string;
    readonly message?: string;
  };
  readonly isError?: boolean;
}

function resultOf(response: JsonRpcResponse): ToolResult {
  return response.result as ToolResult;
}

const NONEXISTENT_DIR = "/tmp/ra11y-definitely-not-here-p0f-xyz";
const NONEXISTENT_FILE = "/tmp/ra11y-definitely-not-here-p0f-xyz.tsx";

describe("scan_project hard-errors when cwd does not exist (P0-F)", () => {
  it("emits `cwd-not-found` envelope with the absent path in details", async () => {
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "scan_project", { cwd: NONEXISTENT_DIR }),
    ]);
    const result = resultOf(responses[1]);
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.code).toBe("cwd-not-found");
    const details = result.structuredContent?.details as { cwd?: string } | undefined;
    expect(details?.cwd).toBe(NONEXISTENT_DIR);
    expect(typeof result.structuredContent?.remediation).toBe("string");
  });

  it("still succeeds (warnings path) on a valid empty directory", async () => {
    const empty = mkdtempSync(join(tmpdir(), "ra11y-p0f-empty-"));
    try {
      const responses = await mcpSession([initMsg(1), toolCall(2, "scan_project", { cwd: empty })]);
      const result = resultOf(responses[1]);
      expect(result.isError).toBeUndefined();
      const body = JSON.parse(result.content[0].text) as { warnings?: readonly string[] };
      expect(body.warnings).toContain("scanned_zero_files");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("still succeeds on a valid directory with parseable files", async () => {
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "scan_project", { cwd: BAD_ALT_DIR }),
    ]);
    const result = resultOf(responses[1]);
    expect(result.isError).toBeUndefined();
    const body = JSON.parse(result.content[0].text) as {
      plan?: { totalFindings?: number };
    };
    expect(typeof body.plan?.totalFindings).toBe("number");
  });
});

describe("scan hard-errors when every path is missing (P0-F)", () => {
  it("emits `scan-paths-not-found` envelope with the missing paths in details", async () => {
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "scan", { paths: [NONEXISTENT_DIR, NONEXISTENT_FILE] }),
    ]);
    const result = resultOf(responses[1]);
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.code).toBe("scan-paths-not-found");
    const details = result.structuredContent?.details as
      | { paths?: readonly string[]; missing?: readonly string[] }
      | undefined;
    expect(details?.paths).toEqual([NONEXISTENT_DIR, NONEXISTENT_FILE]);
    expect(details?.missing).toEqual([NONEXISTENT_DIR, NONEXISTENT_FILE]);
  });

  it("does NOT error when at least one path exists — the existing scan flow runs", async () => {
    // Mix one missing path with one real file. The existing `scan` flow
    // should proceed and skip the missing one silently (discovery already
    // swallows bad paths). P0-F's envelope only fires when EVERY path
    // is bad — a partial-miss is a soft signal, not malformed input.
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "scan", { paths: [NONEXISTENT_DIR, BAD_ALT_FILE] }),
    ]);
    const result = resultOf(responses[1]);
    expect(result.isError).toBeUndefined();
    const body = JSON.parse(result.content[0].text) as {
      plan?: { totalFindings?: number };
    };
    expect(typeof body.plan?.totalFindings).toBe("number");
  });

  it("still emits the warnings envelope on a valid-but-empty directory", async () => {
    const empty = mkdtempSync(join(tmpdir(), "ra11y-p0f-scan-empty-"));
    try {
      const responses = await mcpSession([initMsg(1), toolCall(2, "scan", { paths: [empty] })]);
      const result = resultOf(responses[1]);
      expect(result.isError).toBeUndefined();
      const body = JSON.parse(result.content[0].text) as { warnings?: readonly string[] };
      expect(body.warnings).toContain("scanned_zero_files");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("scan_file envelope parity on missing files (P0-F verify)", () => {
  it("emits the `file-unsupported` envelope (structuredContent + isError) when the file does not exist", async () => {
    // Pre-P0-F this threw ENOENT out of `session.parseFile` and
    // degraded to a JSON-RPC protocol error the caller couldn't
    // `isError`-branch on. Post-P0-F the shape matches the existing
    // unsupported-extension path exactly: structuredContent.code +
    // details.filePath + remediation, isError: true.
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "scan_file", { path: NONEXISTENT_FILE }),
    ]);
    const result = resultOf(responses[1]);
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.code).toBe("file-unsupported");
    const details = result.structuredContent?.details as { filePath?: string } | undefined;
    expect(details?.filePath).toBe(NONEXISTENT_FILE);
    expect(typeof result.structuredContent?.remediation).toBe("string");
  });

  it("still succeeds on an existing parseable file", async () => {
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "scan_file", { path: BAD_ALT_FILE }),
    ]);
    const result = resultOf(responses[1]);
    expect(result.isError).toBeUndefined();
    const body = JSON.parse(result.content[0].text) as { findings?: readonly unknown[] };
    expect(Array.isArray(body.findings)).toBe(true);
  });
});
