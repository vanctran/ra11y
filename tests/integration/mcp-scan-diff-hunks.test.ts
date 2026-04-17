/**
 * Integration tests for `scan_diff` hunksOnly mode — the PR-review
 * primitive that filters findings to those whose line falls inside a
 * `git diff --unified=0 <ref>` hunk.
 *
 * Covers the happy path (only the modified-line finding surfaces), the
 * hard-error envelopes (unknown ref, not a git repo), and the soft-
 * warning path when the comparison ref resolves but produces no hunks.
 * Also confirms the baseline-mode default is untouched by omitting
 * `hunksOnly`.
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

function runGit(cwd: string, args: readonly string[]) {
  const r = spawnSync("git", [...args], { cwd, stdio: "pipe", encoding: "utf8" });
  if (r.status !== 0 && args[0] !== "rev-parse") {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr ?? ""}`);
  }
  return r;
}

/**
 * Sets up a scratch git repo with:
 *   - seed commit: `old.html` with one a11y violation
 *   - second commit: `old.html` unchanged, `new.html` added with its own
 *     violation
 * so a hunks-mode diff against HEAD~1 should surface ONLY the finding in
 * `new.html` (the seed file's finding is outside any hunk).
 */
async function seedRepoWithTwoCommits(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ra11y-hunks-"));
  runGit(dir, ["init", "-q", "-b", "main"]);
  runGit(dir, ["config", "user.email", "test@example.com"]);
  runGit(dir, ["config", "user.name", "Test"]);
  await writeFile(join(dir, "old.html"), '<html><body><img src="/a.png"></body></html>\n');
  runGit(dir, ["add", "."]);
  runGit(dir, ["commit", "-q", "-m", "test: seed"]);
  await writeFile(join(dir, "new.html"), '<html><body><img src="/b.png"></body></html>\n');
  runGit(dir, ["add", "."]);
  runGit(dir, ["commit", "-q", "-m", "test: add new"]);
  return dir;
}

describe("MCP scan_diff hunksOnly: PR-review primitive", () => {
  it("surfaces only findings inside hunks for the comparison ref", async () => {
    const dir = await seedRepoWithTwoCommits();
    try {
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "scan_diff", {
          cwd: dir,
          hunksOnly: true,
          comparisonRef: "HEAD~1",
        }),
      ]);
      const body = bodyOf(responses[1]) as {
        mode: string;
        newCount: number;
        newViolations: Array<{ path: string; findings: Array<{ line: number }> }>;
        meta: { scanMode: string; comparisonRef: string };
      };
      expect(body.mode).toBe("diff");
      expect(body.meta.scanMode).toBe("hunks");
      expect(body.meta.comparisonRef).toBe("HEAD~1");
      expect(body.newCount).toBeGreaterThan(0);
      // Only the new-file finding should surface — the seed-file finding
      // (old.html) was already in place before HEAD~1 so its line is
      // outside any hunk.
      expect(body.newViolations.every((f) => f.path.endsWith("new.html"))).toBe(true);
      expect(body.newViolations.some((f) => f.path.endsWith("old.html"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns a structured error envelope for an unknown comparison ref", async () => {
    const dir = await seedRepoWithTwoCommits();
    try {
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "scan_diff", {
          cwd: dir,
          hunksOnly: true,
          comparisonRef: "refs/does-not-exist",
        }),
      ]);
      expect(isError(responses[1])).toBe(true);
      const result = responses[1].result as {
        structuredContent?: { code?: string; details?: Record<string, unknown> };
      };
      expect(result.structuredContent?.code).toBe("unknown-ref");
      expect(result.structuredContent?.details?.["comparisonRef"]).toBe("refs/does-not-exist");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns a structured error envelope when cwd is not a git repo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ra11y-hunks-nongit-"));
    try {
      await writeFile(join(dir, "index.html"), '<html><body><img src="/a.png"></body></html>\n');
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "scan_diff", {
          cwd: dir,
          hunksOnly: true,
        }),
      ]);
      expect(isError(responses[1])).toBe(true);
      const result = responses[1].result as { structuredContent?: { code?: string } };
      expect(result.structuredContent?.code).toBe("not-a-git-repo");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("emits a soft warning (no_hunks_in_comparison) when the ref resolves but yields no hunks", async () => {
    const dir = await seedRepoWithTwoCommits();
    try {
      // Clean working tree against HEAD — nothing has changed vs HEAD so
      // git diff --unified=0 HEAD is empty. Findings still shouldn't
      // surface (they're not in a hunk), and the response must flag the
      // no-op with a warning code so zero findings isn't mistaken for a
      // clean scan.
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "scan_diff", {
          cwd: dir,
          hunksOnly: true,
          comparisonRef: "HEAD",
        }),
      ]);
      const body = bodyOf(responses[1]) as {
        newCount: number;
        warnings?: readonly string[];
        meta: { scanMode: string };
      };
      expect(body.newCount).toBe(0);
      expect(body.warnings).toContain("no_hunks_in_comparison");
      expect(body.meta.scanMode).toBe("hunks");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("omits the hunksOnly flag — baseline mode stays the default (unchanged behavior)", async () => {
    const dir = await seedRepoWithTwoCommits();
    try {
      // No baseline file, no hunksOnly — baseline-mode's missing-file
      // error envelope should still fire, proving the default path is
      // untouched by the new mode.
      const responses = await mcpSession([initMsg(1), toolCall(2, "scan_diff", { cwd: dir })]);
      expect(isError(responses[1])).toBe(true);
      const result = responses[1].result as { structuredContent?: { code?: string } };
      expect(result.structuredContent?.code).toBe("baseline-not-found");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
