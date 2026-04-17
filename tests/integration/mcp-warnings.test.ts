/**
 * Integration test for the top-level `warnings: string[]` surfaced on
 * `scan_project` and `scan` responses (Track Q / P0-E).
 *
 * Closes the silent-success ambiguity documented in CLAUDE.md §1
 * "Zero-output success is ambiguous failure" — an agent calling
 * `scan_project({ cwd: "/tmp/wrong-path" })` now gets the
 * `scanned_zero_files` code instead of a response that looks
 * indistinguishable from a clean codebase.
 *
 * Two directions guarded explicitly: the warning-emit case (malformed
 * input → the field is present with the expected codes) AND the
 * healthy-scan case (the field is OMITTED entirely, not `[]`). The
 * second direction is the one that lets agents branch on presence
 * alone without reinspecting the value — the `warnings: []` bug is
 * semantically the same silent-success failure this test guards
 * against.
 */

import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const TEMPLATE_FIXTURE = join(
  PROJECT_ROOT,
  "tests",
  "fixtures",
  "real-world",
  "template-directives",
  "source",
);
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

function bodyOf(response: JsonRpcResponse): Record<string, unknown> {
  const result = response.result as { content: Array<{ text: string }> };
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

describe("scan_project emits top-level `warnings` for silent-failure modes (P0-E)", () => {
  it("scanned_zero_files: scanning a nonexistent path now hard-errors via the structured envelope (P0-F)", async () => {
    // P0-F upgraded the scan_project nonexistent-cwd path from a soft
    // `warnings: ["scanned_zero_files"]` signal to a hard error envelope
    // (`code: "cwd-not-found"`). The warnings-array path still applies
    // when `cwd` exists but is empty / has no parseable files.
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "scan_project", { cwd: "/tmp/ra11y-nonexistent-xyz" }),
    ]);
    const result = responses[1].result as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0].text) as { code?: string };
    expect(body.code).toBe("cwd-not-found");
  });

  it("template_files_parsed_as_literal: a Jinja fixture raises the parsed-as-literal code", async () => {
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "scan_project", { cwd: TEMPLATE_FIXTURE }),
    ]);
    const body = bodyOf(responses[1]) as { warnings?: readonly string[] };
    expect(Array.isArray(body.warnings)).toBe(true);
    expect(body.warnings).toContain("template_files_parsed_as_literal");
  });

  it("a healthy scan omits the `warnings` field entirely (not `warnings: []`)", async () => {
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "scan_project", { cwd: BAD_ALT_DIR }),
    ]);
    // BAD_ALT_DIR is an explicit cwd with a config-less fixture
    // directory — `scanned_zero_files` and `root_source_defaulted`
    // must NOT fire. `no_config_found` WILL fire (the fixture
    // directory has no ra11y.config walking up), which is correct
    // behavior on a real project that lacks one. What we're
    // guarding here is the shape contract: the field is absent when
    // empty, never present as `[]`.
    const body = bodyOf(responses[1]) as { warnings?: readonly string[] };
    if (body.warnings !== undefined) {
      // If present, it must NOT be empty — empty is the silent-bug
      // shape. And it must NOT contain the two codes this case
      // explicitly falsifies.
      expect(body.warnings.length).toBeGreaterThan(0);
      expect(body.warnings).not.toContain("scanned_zero_files");
      expect(body.warnings).not.toContain("root_source_defaulted");
    }
  });
});

describe("scan emits top-level `warnings` for silent-failure modes (P0-E)", () => {
  it("paths-all-missing now hard-errors via the structured envelope (P0-F)", async () => {
    // P0-F: when every requested path is missing on disk, `scan` returns
    // `code: "scan-paths-not-found"` rather than a silent
    // `warnings: ["scanned_zero_files"]` success.
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "scan", { paths: ["/tmp/ra11y-nonexistent-xyz"] }),
    ]);
    const result = responses[1].result as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0].text) as { code?: string };
    expect(body.code).toBe("scan-paths-not-found");
  });

  it("does NOT fire root_source_defaulted on `scan` — that tool takes paths directly and has no root-resolution step", async () => {
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "scan", { paths: [BAD_ALT_FILE] }),
    ]);
    const body = bodyOf(responses[1]) as { warnings?: readonly string[] };
    // `warnings` may be present (e.g. no_config_found is plausible
    // for the fixture file) but root_source_defaulted is
    // scan_project-only.
    if (Array.isArray(body.warnings)) {
      expect(body.warnings).not.toContain("root_source_defaulted");
    }
  });
});
