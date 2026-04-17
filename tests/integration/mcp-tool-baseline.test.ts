/**
 * Integration tests for the `baseline` MCP tool. Spawns the ra11y MCP
 * subprocess, drives it through the three modes (create / check /
 * update) against a scratch directory containing a known-bad fixture,
 * and asserts the JSON payload shapes the engine promises — new
 * violations as the primary `check` payload, `addedCount` /
 * `removedCount` on `update`, error envelopes on missing/malformed
 * baseline files.
 *
 * These tests exercise the full JSON-RPC round-trip rather than calling
 * the handler directly because the baseline tool's value proposition is
 * "run it from a real MCP session against a real scan root" — unit
 * tests on the handler can't prove session + project config
 * propagation from inside a live stdio session.
 */

import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

/**
 * Writes a fixture directory with a known-bad HTML file that will
 * produce at least one violation. Returns the directory path.
 */
async function scratchDirWithBadFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ra11y-baseline-"));
  await writeFile(join(dir, "index.html"), '<html><body><img src="/logo.png"></body></html>\n');
  return dir;
}

/**
 * Adds a second known-bad file to a scratch directory so a subsequent
 * `check` surfaces new violations on top of the baseline.
 */
async function addSecondBadFile(dir: string): Promise<void> {
  await writeFile(join(dir, "page.html"), '<html><body><img src="/hero.jpg"></body></html>\n');
}

describe("MCP baseline tool: create/check/update round-trips", () => {
  it("create writes a baseline file with the current violations", async () => {
    const dir = await scratchDirWithBadFixture();
    try {
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "baseline", { mode: "create", cwd: dir }),
      ]);
      const body = bodyOf(responses[1]) as {
        mode: string;
        baselinePath: string;
        entriesWritten: number;
        hadViolations: boolean;
        nextStep: string;
      };
      expect(body.mode).toBe("create");
      expect(body.baselinePath).toBe(join(dir, ".ra11y-baseline.json"));
      expect(body.entriesWritten).toBeGreaterThan(0);
      expect(body.hadViolations).toBe(true);
      expect(typeof body.nextStep).toBe("string");
      expect(existsSync(body.baselinePath)).toBe(true);

      const contents = JSON.parse(await readFile(body.baselinePath, "utf8")) as {
        version: number;
        violations: Array<{ ruleId: string; hash: string }>;
      };
      expect(contents.version).toBe(1);
      expect(contents.violations.length).toBe(body.entriesWritten);
      expect(contents.violations.every((v) => typeof v.hash === "string")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("check against a clean baseline returns zero new violations and isPassing: true", async () => {
    const dir = await scratchDirWithBadFixture();
    try {
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "baseline", { mode: "create", cwd: dir }),
        toolCall(3, "baseline", { mode: "check", cwd: dir }),
      ]);
      const body = bodyOf(responses[2]) as {
        mode: string;
        isPassing: boolean;
        newViolationCount: number;
        grandfatheredCount: number;
        resolvedCount: number;
        files: unknown[];
      };
      expect(body.mode).toBe("check");
      expect(body.isPassing).toBe(true);
      expect(body.newViolationCount).toBe(0);
      expect(body.grandfatheredCount).toBeGreaterThan(0);
      expect(body.resolvedCount).toBe(0);
      expect(body.files).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("check with new violations returns only the new ones, not grandfathered", async () => {
    const dir = await scratchDirWithBadFixture();
    try {
      const createResponses = await mcpSession([
        initMsg(1),
        toolCall(2, "baseline", { mode: "create", cwd: dir }),
      ]);
      const created = bodyOf(createResponses[1]) as { entriesWritten: number };
      const initialCount = created.entriesWritten;

      // Introduce a new violation in a new file — the engine fingerprints
      // by rule + normalized path + message, so a new file produces a
      // new hash that isn't in the baseline.
      await addSecondBadFile(dir);

      const checkResponses = await mcpSession([
        initMsg(1),
        toolCall(2, "baseline", { mode: "check", cwd: dir }),
      ]);
      const body = bodyOf(checkResponses[1]) as {
        isPassing: boolean;
        newViolationCount: number;
        grandfatheredCount: number;
        files: Array<{ path: string; findings: Array<{ ruleId: string }> }>;
      };
      expect(body.isPassing).toBe(false);
      expect(body.newViolationCount).toBeGreaterThan(0);
      expect(body.grandfatheredCount).toBe(initialCount);
      expect(body.files.some((f) => f.path.endsWith("page.html"))).toBe(true);
      // None of the new-violation entries should duplicate the baseline's
      // pre-existing index.html rows — the whole point of diff mode.
      expect(body.files.every((f) => !f.path.endsWith("index.html"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("update rewrites the file and reports removedCount for fixed violations", async () => {
    const dir = await scratchDirWithBadFixture();
    try {
      // Create a baseline with TWO files' worth of violations, then fix
      // one file and update — removedCount should reflect the fix.
      await addSecondBadFile(dir);
      const createResponses = await mcpSession([
        initMsg(1),
        toolCall(2, "baseline", { mode: "create", cwd: dir }),
      ]);
      const created = bodyOf(createResponses[1]) as { entriesWritten: number };
      expect(created.entriesWritten).toBeGreaterThanOrEqual(2);

      // Fix page.html — delete it outright so no violations remain.
      await rm(join(dir, "page.html"));

      const updateResponses = await mcpSession([
        initMsg(1),
        toolCall(2, "baseline", { mode: "update", cwd: dir }),
      ]);
      const body = bodyOf(updateResponses[1]) as {
        mode: string;
        entriesWritten: number;
        previousEntries: number;
        addedCount: number;
        removedCount: number;
      };
      expect(body.mode).toBe("update");
      expect(body.previousEntries).toBe(created.entriesWritten);
      expect(body.entriesWritten).toBeLessThan(body.previousEntries);
      expect(body.removedCount).toBeGreaterThan(0);
      expect(body.addedCount).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("check without an existing baseline file returns a tool-level error envelope", async () => {
    const dir = await scratchDirWithBadFixture();
    try {
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "baseline", { mode: "check", cwd: dir }),
      ]);
      expect(isError(responses[1])).toBe(true);
      const body = bodyOf(responses[1]) as { error: string };
      expect(body.error).toMatch(/baseline file not found/i);
      expect(body.error).toContain('mode: "create"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("check on a malformed baseline file surfaces the parse failure", async () => {
    const dir = await scratchDirWithBadFixture();
    try {
      await writeFile(join(dir, ".ra11y-baseline.json"), "{ not valid json");
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "baseline", { mode: "check", cwd: dir }),
      ]);
      expect(isError(responses[1])).toBe(true);
      const body = bodyOf(responses[1]) as { error: string };
      expect(body.error).toMatch(/failed to load baseline/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("check on a version-mismatched baseline surfaces the version error", async () => {
    const dir = await scratchDirWithBadFixture();
    try {
      // Version 999 is incompatible; the engine's loadBaseline throws a
      // specific message that the tool should propagate verbatim.
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
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "baseline", { mode: "check", cwd: dir }),
      ]);
      expect(isError(responses[1])).toBe(true);
      const body = bodyOf(responses[1]) as { error: string };
      expect(body.error).toMatch(/version 999 is incompatible/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("baselinePath is honored and resolves relative paths against cwd", async () => {
    const dir = await scratchDirWithBadFixture();
    try {
      await mkdir(join(dir, "sub"));
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "baseline", {
          mode: "create",
          cwd: dir,
          baselinePath: "sub/custom-baseline.json",
        }),
      ]);
      const body = bodyOf(responses[1]) as { baselinePath: string };
      expect(body.baselinePath).toBe(join(dir, "sub", "custom-baseline.json"));
      expect(existsSync(body.baselinePath)).toBe(true);
      // Default file must NOT have been written.
      expect(existsSync(join(dir, ".ra11y-baseline.json"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("session config propagates to baseline scans (standard override)", async () => {
    const dir = await scratchDirWithBadFixture();
    try {
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "configure", { standard: "wcag21", level: "AA" }),
        toolCall(3, "baseline", { mode: "create", cwd: dir }),
      ]);
      const body = bodyOf(responses[2]) as {
        meta: { standards: readonly string[] };
      };
      // `configure` set the session to wcag21; baseline should scan under
      // that standard rather than the default wcag22.
      expect(body.meta.standards).toContain("wcag21");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("mode parameter is required and rejects unknown values", async () => {
    const dir = await scratchDirWithBadFixture();
    try {
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "baseline", { cwd: dir }),
        toolCall(3, "baseline", { mode: "nonsense", cwd: dir }),
      ]);
      expect(isError(responses[1])).toBe(true);
      expect(isError(responses[2])).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
