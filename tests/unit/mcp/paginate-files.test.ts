/**
 * Unit tests for scan_project's P1-OVF pagination — the response-size
 * guard that caps files-with-findings lists so large monorepo scans
 * don't overflow MCP token limits. The scan itself still runs over
 * everything; the cap bounds only the emitted `files` array.
 *
 * Exercises the internal pagination helpers via scan_project's public
 * MCP surface so the contract the agent sees (truncated + nextOffset
 * + totalFilesWithFindings, or omitted pagination fields when the
 * whole result fits) stays guarded against drift.
 */

import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..", "..", "..");

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

/**
 * Builds a tempdir with N simple HTML files, each containing an
 * `<img>` without alt text so each file produces at least one
 * finding. Keeps per-file findings small so the file count drives
 * pagination.
 */
function buildFixture(fileCount: number): string {
  const root = mkdtempSync(join(tmpdir(), "ra11y-paginate-"));
  const src = join(root, "src");
  mkdirSync(src);
  for (let i = 0; i < fileCount; i += 1) {
    writeFileSync(
      join(src, `page-${i}.html`),
      `<html><body><img src="/p${i}.png"></body></html>\n`,
    );
  }
  return root;
}

describe("scan_project pagination (P1-OVF)", () => {
  it("omits pagination fields when every files-with-findings entry fits under the cap", async () => {
    const root = buildFixture(3);
    try {
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "scan_project", { cwd: root, limit: 200 }),
      ]);
      const body = bodyOf(responses[1]) as {
        files: unknown[];
        truncated?: unknown;
        nextOffset?: unknown;
        totalFilesWithFindings?: unknown;
      };
      // Honest shape: when the whole result fits, the pagination
      // fields are absent — not `truncated: false` with a totals
      // sentinel, which would read as "partial answer" when it isn't.
      expect(body.files.length).toBe(3);
      expect(body.truncated).toBeUndefined();
      expect(body.nextOffset).toBeUndefined();
      expect(body.totalFilesWithFindings).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("emits truncated + nextOffset + totalFilesWithFindings when the cap truncates", async () => {
    const root = buildFixture(6);
    try {
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "scan_project", { cwd: root, limit: 2 }),
      ]);
      const body = bodyOf(responses[1]) as {
        files: unknown[];
        truncated?: boolean;
        nextOffset?: number;
        totalFilesWithFindings?: number;
      };
      // Page 1: first 2 files, more available.
      expect(body.files.length).toBe(2);
      expect(body.truncated).toBe(true);
      expect(body.nextOffset).toBe(2);
      expect(body.totalFilesWithFindings).toBe(6);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("paging with offset returns the remaining slice and drops truncated on the last page", async () => {
    const root = buildFixture(5);
    try {
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "scan_project", { cwd: root, limit: 3, offset: 3 }),
      ]);
      const body = bodyOf(responses[1]) as {
        files: unknown[];
        truncated?: boolean;
        nextOffset?: number;
        totalFilesWithFindings?: number;
      };
      // Page 2 of 2: the remaining 2 files (5 total - offset 3).
      // `truncated` should be ABSENT (final page), but
      // `totalFilesWithFindings` stays so the agent can confirm it's
      // seen the whole inventory.
      expect(body.files.length).toBe(2);
      expect(body.truncated).toBeUndefined();
      expect(body.nextOffset).toBeUndefined();
      expect(body.totalFilesWithFindings).toBe(5);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("plan.totalFindings reports the full pre-truncation tally so page 1 doesn't mislead", async () => {
    const root = buildFixture(6);
    try {
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "scan_project", { cwd: root, limit: 2 }),
      ]);
      const body = bodyOf(responses[1]) as {
        plan: { totalFindings: number };
      };
      // Each fixture file has one <img> without alt; the alt-text
      // rule fires under multiple criteria (WCAG 2.2, 2.1, etc.), so
      // the total finding count is >= file count. What matters for
      // P1-OVF is that the plan reports the PRE-TRUNCATION tally —
      // limit:2 must not cut totalFindings down to the page-1 subset,
      // otherwise the agent reads "found 2" when there's more work.
      expect(body.plan.totalFindings).toBeGreaterThanOrEqual(6);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
