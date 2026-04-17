/**
 * Integration test for the `list_suppressions` MCP tool (Q2-LISTSUPP).
 *
 * Spawns the ra11y MCP subprocess and exercises the tool end-to-end
 * through JSON-RPC against a scratch fixture holding three pragmas
 * across two files: a bare rule-scoped pragma, a reasoned criterion-
 * scoped pragma, and a wildcard pragma. Guards the tool's response
 * shape as seen by a real agent (ordering, meta, nextStep, field
 * omission for bare pragmas).
 *
 * Unit-level assertions on the handler live in
 * `tests/unit/mcp/tool-list-suppressions.test.ts`; this file proves
 * the protocol hook-up is correct.
 */

import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
 * Writes a scratch directory holding three pragmas across two files:
 *   - `page.html`: bare rule-scoped + wildcard
 *   - `article.html`: reasoned criterion-scoped
 * Returns the dir path so tests can tear it down in `finally`.
 */
async function scratchWithThreePragmas(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ra11y-list-suppressions-int-"));
  await writeFile(
    join(dir, "page.html"),
    [
      "<!-- ra11y-disable-next-line media/alt-text-missing -->",
      '<img src="/bare.png">',
      "<!-- ra11y-disable-next-line -->",
      '<img src="/wildcard.png">',
      "",
    ].join("\n"),
  );
  await writeFile(
    join(dir, "article.html"),
    [
      "<!-- ra11y-disable-next-line wcag22:1.4.3: contrast verified by design system -->",
      '<p style="color:#666">Body text</p>',
      "",
    ].join("\n"),
  );
  return dir;
}

describe("MCP list_suppressions tool: end-to-end JSON-RPC round-trip", () => {
  it("enumerates every pragma and honors the field-omission contract", async () => {
    const dir = await scratchWithThreePragmas();
    try {
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "list_suppressions", { cwd: dir }),
      ]);
      const callResponse = responses.find((r) => r.id === 2);
      if (!callResponse) throw new Error("list_suppressions response missing");
      const body = bodyOf(callResponse) as {
        suppressions: Array<{
          file: string;
          line: number;
          ruleId: string | null;
          criterionId: string | null;
          reason?: string;
          wildcard: boolean;
        }>;
        meta: {
          cwd: string;
          configSource: string | null;
          filesScanned: number;
          rulesEvaluated: number;
        };
        nextStep: string;
      };

      // File ordering: `article.html` sorts before `page.html`.
      // Within page.html, bare first (line 1), wildcard second (line 3).
      expect(body.suppressions.length).toBe(3);
      expect(body.suppressions[0]?.file).toBe(join(dir, "article.html"));
      expect(body.suppressions[0]?.criterionId).toBe("wcag22:1.4.3");
      expect(body.suppressions[0]?.ruleId).toBeNull();
      expect(body.suppressions[0]?.reason).toBe("contrast verified by design system");
      expect(body.suppressions[0]?.wildcard).toBe(false);

      expect(body.suppressions[1]?.file).toBe(join(dir, "page.html"));
      expect(body.suppressions[1]?.line).toBe(1);
      expect(body.suppressions[1]?.ruleId).toBe("media/alt-text-missing");
      expect(body.suppressions[1]?.criterionId).toBeNull();
      expect(body.suppressions[1]?.wildcard).toBe(false);
      // Field-omission: bare pragma must omit `reason` entirely, not
      // emit `reason: ""` / `reason: null`.
      expect("reason" in body.suppressions[1]).toBe(false);

      expect(body.suppressions[2]?.file).toBe(join(dir, "page.html"));
      expect(body.suppressions[2]?.line).toBe(3);
      expect(body.suppressions[2]?.ruleId).toBeNull();
      expect(body.suppressions[2]?.criterionId).toBeNull();
      expect(body.suppressions[2]?.wildcard).toBe(true);
      expect("reason" in body.suppressions[2]).toBe(false);

      // Meta carries scan-confidence telemetry.
      expect(body.meta.cwd).toBe(dir);
      expect(body.meta.filesScanned).toBe(2);
      expect(body.meta.rulesEvaluated).toBeGreaterThan(0);

      // Two bare pragmas → nextStep routes to review_candidates.
      expect(body.nextStep).toContain("missing a reason");
      expect(body.nextStep).toContain("review_candidates");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
