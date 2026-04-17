/**
 * Integration tests for the `scan_diff` MCP tool. Spawns the ra11y MCP
 * subprocess, creates a baseline via the `baseline` tool, then drives
 * `scan_diff` against a scratch fixture to verify:
 *
 *   - zero new findings against a clean-vs-baseline state
 *   - new findings surface with the same shape as `scan_project.files`
 *   - missing / malformed / version-mismatched baselines produce
 *     structured error envelopes that match the baseline tool's wording
 *   - session-config propagation (standard override) carries through
 *   - `changedOnly` narrows the scan scope correctly
 *
 * Tests go through the real JSON-RPC stdio transport rather than calling
 * the handler directly so session + project config propagation is
 * exercised end-to-end.
 */

import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
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

function isError(response: JsonRpcResponse): boolean {
  const result = response.result as { isError?: boolean } | undefined;
  return result?.isError === true;
}

async function scratchDirWithBadFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ra11y-scan-diff-"));
  await writeFile(join(dir, "index.html"), '<html><body><img src="/logo.png"></body></html>\n');
  return dir;
}

async function addSecondBadFile(dir: string): Promise<void> {
  await writeFile(join(dir, "page.html"), '<html><body><img src="/hero.jpg"></body></html>\n');
}

describe("MCP scan_diff tool: new-findings-only deltas", () => {
  it("returns zero new findings when the scan matches the baseline", async () => {
    const dir = await scratchDirWithBadFixture();
    try {
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "baseline", { mode: "create", cwd: dir }),
        toolCall(3, "scan_diff", { cwd: dir }),
      ]);
      const body = bodyOf(responses[2]) as {
        mode: string;
        newCount: number;
        baselineCount: number;
        newViolations: unknown[];
        meta: Record<string, unknown>;
        nextStep: string;
      };
      expect(body.mode).toBe("diff");
      expect(body.newCount).toBe(0);
      expect(body.baselineCount).toBeGreaterThan(0);
      expect(body.newViolations).toEqual([]);
      // Scan-confidence telemetry should still be present on a clean diff
      // so the agent can size scan coverage before acting on "0 new."
      expect(typeof body.meta.rulesEvaluated).toBe("number");
      expect(body.nextStep).toMatch(/no new violations/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("surfaces new violations and omits baseline-grandfathered ones", async () => {
    const dir = await scratchDirWithBadFixture();
    try {
      await mcpSession([initMsg(1), toolCall(2, "baseline", { mode: "create", cwd: dir })]);
      await addSecondBadFile(dir);
      const responses = await mcpSession([initMsg(1), toolCall(2, "scan_diff", { cwd: dir })]);
      const body = bodyOf(responses[1]) as {
        newCount: number;
        baselineCount: number;
        newViolations: Array<{ path: string; findings: Array<{ ruleId: string; line: number }> }>;
        nextStep: string;
      };
      expect(body.newCount).toBeGreaterThan(0);
      expect(body.baselineCount).toBeGreaterThan(0);
      expect(body.newViolations.some((f) => f.path.endsWith("page.html"))).toBe(true);
      // Grandfathered file must be absent from newViolations — the whole
      // point of diff mode.
      expect(body.newViolations.every((f) => !f.path.endsWith("index.html"))).toBe(true);
      expect(body.nextStep).toContain("page.html");
      expect(body.nextStep).toContain("suggest_fix");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns a structured error envelope when the baseline file is missing", async () => {
    const dir = await scratchDirWithBadFixture();
    try {
      const responses = await mcpSession([initMsg(1), toolCall(2, "scan_diff", { cwd: dir })]);
      expect(isError(responses[1])).toBe(true);
      const result = responses[1].result as {
        structuredContent?: { code?: string; details?: { baselinePath?: string } };
      };
      expect(result.structuredContent?.code).toBe("baseline-not-found");
      expect(typeof result.structuredContent?.details?.baselinePath).toBe("string");
      const body = bodyOf(responses[1]) as { error: string };
      expect(body.error).toMatch(/baseline file not found/i);
      expect(body.error).toContain('mode: "create"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns a structured error envelope for malformed JSON", async () => {
    const dir = await scratchDirWithBadFixture();
    try {
      await writeFile(join(dir, ".ra11y-baseline.json"), "{ not valid json");
      const responses = await mcpSession([initMsg(1), toolCall(2, "scan_diff", { cwd: dir })]);
      expect(isError(responses[1])).toBe(true);
      const result = responses[1].result as { structuredContent?: { code?: string } };
      expect(result.structuredContent?.code).toBe("baseline-load-failed");
      const body = bodyOf(responses[1]) as { error: string };
      expect(body.error).toMatch(/failed to load baseline/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns a structured error envelope for baseline version mismatch", async () => {
    const dir = await scratchDirWithBadFixture();
    try {
      await writeFile(
        join(dir, ".ra11y-baseline.json"),
        JSON.stringify({
          version: 999,
          generatedAt: new Date().toISOString(),
          ra11yVersion: "0.0.0",
          standards: ["wcag22"],
          violations: [],
        }),
      );
      const responses = await mcpSession([initMsg(1), toolCall(2, "scan_diff", { cwd: dir })]);
      expect(isError(responses[1])).toBe(true);
      const result = responses[1].result as { structuredContent?: { code?: string } };
      expect(result.structuredContent?.code).toBe("baseline-load-failed");
      const body = bodyOf(responses[1]) as { error: string };
      expect(body.error).toMatch(/version 999 is incompatible/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("honors baselinePath relative to cwd", async () => {
    const dir = await scratchDirWithBadFixture();
    try {
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "baseline", {
          mode: "create",
          cwd: dir,
          baselinePath: "custom-baseline.json",
        }),
        toolCall(3, "scan_diff", { cwd: dir, baselinePath: "custom-baseline.json" }),
      ]);
      const body = bodyOf(responses[2]) as {
        baselinePath: string;
        newCount: number;
      };
      expect(body.baselinePath).toBe(join(dir, "custom-baseline.json"));
      expect(body.newCount).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("session config propagates (standard override)", async () => {
    const dir = await scratchDirWithBadFixture();
    try {
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "configure", { standard: "wcag21", level: "AA" }),
        toolCall(3, "baseline", { mode: "create", cwd: dir }),
        toolCall(4, "scan_diff", { cwd: dir }),
      ]);
      const body = bodyOf(responses[3]) as {
        meta: { standards: readonly string[] };
      };
      expect(body.meta.standards).toContain("wcag21");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("changedOnly narrows scan scope in a git repo without crashing", async () => {
    const dir = await scratchDirWithBadFixture();
    try {
      // Initialize a git repo so `changedOnly` has something to work
      // against. Nothing is staged, so the scan should still fall back to
      // the full tree rather than silently scanning nothing.
      const git = (args: readonly string[]) =>
        spawnSync("git", [...args], { cwd: dir, stdio: "ignore" });
      git(["init"]);
      git(["config", "user.email", "test@example.com"]);
      git(["config", "user.name", "Test"]);
      git(["add", "."]);
      git(["commit", "-m", "initial"]);
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "baseline", { mode: "create", cwd: dir }),
        toolCall(3, "scan_diff", { cwd: dir, changedOnly: true }),
      ]);
      const body = bodyOf(responses[2]) as {
        mode: string;
        newCount: number;
        meta: { scanMode: string };
      };
      expect(body.mode).toBe("diff");
      expect(body.meta.scanMode).toBe("changedOnly");
      // Nothing staged on top of the initial commit, so no regressions.
      expect(body.newCount).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
