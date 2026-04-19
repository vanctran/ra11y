/**
 * Unit tests for `scan_diff` hunks mode — the PR-review primitive that
 * filters findings to those whose line falls inside a
 * `git diff --unified=0 <ref>` hunk. Drives the handler in-process so
 * the hunks-mode branches get real line-coverage credit; the
 * subprocess-based integration test in
 * `tests/integration/mcp-scan-diff-hunks.test.ts` covers the same
 * surface but its coverage doesn't flow back to the instrumented
 * source.
 *
 * Scope: not-a-git-repo and unknown-ref error envelopes, happy path
 * against a real scratch git repo (only new-file finding surfaces),
 * no_hunks_in_comparison soft warning when the ref resolves but
 * yields no hunks, conditional-spread discipline on `resolved` (must
 * be absent, not `resolved: []`), default `comparisonRef` fallback,
 * and the zero-parseable-files branch that still surfaces the warning.
 */

import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpSession } from "../../../src/mcp/session.ts";
import { scanDiffTool } from "../../../src/mcp/tool-scan-diff.ts";

interface ErrorBody {
  readonly error: string;
  readonly code: string;
  readonly details?: Record<string, unknown>;
}

interface HunksBody {
  readonly mode: string;
  readonly newCount: number;
  readonly newViolations: Array<{
    readonly path: string;
    readonly findings: Array<{ readonly ruleId: string; readonly line: number }>;
  }>;
  readonly meta: Record<string, unknown>;
  readonly nextStep: string;
  readonly warnings?: readonly string[];
}

async function withScratch<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "ra11y-scan-diff-hunks-unit-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function callHandler(
  session: McpSession,
  params: Record<string, unknown>,
): Promise<{
  isError: boolean;
  body: HunksBody | ErrorBody;
  code: string | undefined;
  raw: Record<string, unknown>;
}> {
  const result = await scanDiffTool.handler(params, session);
  const text = result.content[0]?.text ?? "";
  const raw = JSON.parse(text) as Record<string, unknown>;
  const structuredCode = (result.structuredContent as { code?: string } | undefined)?.code;
  const rawCode = typeof raw["code"] === "string" ? (raw["code"] as string) : undefined;
  return {
    isError: result.isError === true,
    body: raw as unknown as HunksBody | ErrorBody,
    code: structuredCode ?? rawCode,
    raw,
  };
}

function git(cwd: string, args: readonly string[]): void {
  const r = spawnSync("git", [...args], { cwd, stdio: "pipe", encoding: "utf8" });
  if (r.status !== 0 && args[0] !== "rev-parse") {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr ?? ""}`);
  }
}

async function writeBadImg(dir: string, name = "index.html"): Promise<void> {
  await writeFile(join(dir, name), '<html><body><img src="/logo.png"></body></html>\n');
}

function initRepo(dir: string): void {
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "t@example.com"]);
  git(dir, ["config", "user.name", "t"]);
}

describe("scan_diff hunks mode: errors", () => {
  it("returns `not-a-git-repo` when cwd is not inside a git checkout", async () => {
    await withScratch(async (dir) => {
      await writeBadImg(dir);
      const { isError, code, body } = await callHandler(new McpSession(), {
        cwd: dir,
        hunksOnly: true,
      });
      expect(isError).toBe(true);
      expect(code).toBe("not-a-git-repo");
      expect((body as ErrorBody).details?.["cwd"]).toBe(dir);
    });
  });

  it("returns `unknown-ref` when the comparison ref does not resolve", async () => {
    await withScratch(async (dir) => {
      await writeBadImg(dir);
      initRepo(dir);
      git(dir, ["add", "."]);
      git(dir, ["commit", "-q", "-m", "seed"]);
      const { isError, code, body } = await callHandler(new McpSession(), {
        cwd: dir,
        hunksOnly: true,
        comparisonRef: "refs/does-not-exist",
      });
      expect(isError).toBe(true);
      expect(code).toBe("unknown-ref");
      expect((body as ErrorBody).details?.["comparisonRef"]).toBe("refs/does-not-exist");
    });
  });
});

describe("scan_diff hunks mode: happy path + warnings", () => {
  it("surfaces only findings inside hunks for the comparison ref and omits `resolved` entirely", async () => {
    await withScratch(async (dir) => {
      initRepo(dir);
      await writeBadImg(dir, "old.html");
      git(dir, ["add", "."]);
      git(dir, ["commit", "-q", "-m", "seed"]);
      await writeBadImg(dir, "new.html");
      git(dir, ["add", "."]);
      git(dir, ["commit", "-q", "-m", "add"]);
      const { isError, body, raw } = await callHandler(new McpSession(), {
        cwd: dir,
        hunksOnly: true,
        comparisonRef: "HEAD~1",
      });
      expect(isError).toBe(false);
      const success = body as HunksBody;
      expect(success.newCount).toBeGreaterThan(0);
      expect(success.newViolations.every((f) => f.path.endsWith("new.html"))).toBe(true);
      // Conditional-spread discipline — `resolved` absent, not `[]`.
      expect("resolved" in raw).toBe(false);
      expect("resolvedCount" in raw).toBe(false);
    });
  });

  it("reports `scanMode: hunks` and threads `comparisonRef` back into meta", async () => {
    await withScratch(async (dir) => {
      initRepo(dir);
      await writeBadImg(dir, "old.html");
      git(dir, ["add", "."]);
      git(dir, ["commit", "-q", "-m", "seed"]);
      await writeBadImg(dir, "new.html");
      git(dir, ["add", "."]);
      git(dir, ["commit", "-q", "-m", "add"]);
      const { body } = await callHandler(new McpSession(), {
        cwd: dir,
        hunksOnly: true,
        comparisonRef: "HEAD~1",
      });
      const success = body as HunksBody;
      expect((success.meta as { scanMode: string }).scanMode).toBe("hunks");
      expect((success.meta as { comparisonRef: string }).comparisonRef).toBe("HEAD~1");
    });
  });

  it('emits `warnings: ["no_hunks_in_comparison"]` when the ref resolves but yields no hunks', async () => {
    await withScratch(async (dir) => {
      initRepo(dir);
      await writeBadImg(dir, "old.html");
      git(dir, ["add", "."]);
      git(dir, ["commit", "-q", "-m", "seed"]);
      const { body } = await callHandler(new McpSession(), {
        cwd: dir,
        hunksOnly: true,
        comparisonRef: "HEAD",
      });
      const success = body as HunksBody;
      expect(success.newCount).toBe(0);
      expect(success.warnings).toContain("no_hunks_in_comparison");
      expect(success.nextStep).toMatch(/no hunks|produced no hunks/i);
    });
  });

  it("defaults `comparisonRef` to HEAD when omitted", async () => {
    await withScratch(async (dir) => {
      initRepo(dir);
      await writeBadImg(dir);
      git(dir, ["add", "."]);
      git(dir, ["commit", "-q", "-m", "seed"]);
      const { body } = await callHandler(new McpSession(), { cwd: dir, hunksOnly: true });
      const success = body as HunksBody;
      expect((success.meta as { comparisonRef: string }).comparisonRef).toBe("HEAD");
    });
  });

  it("returns the empty-files hunks response with a warning when the ref has no hunks and no files parse", async () => {
    await withScratch(async (dir) => {
      initRepo(dir);
      await writeFile(join(dir, "README"), "not a parseable file\n");
      git(dir, ["add", "."]);
      git(dir, ["commit", "-q", "-m", "seed"]);
      const { body, raw } = await callHandler(new McpSession(), {
        cwd: dir,
        hunksOnly: true,
        comparisonRef: "HEAD",
      });
      const success = body as HunksBody;
      expect(success.newCount).toBe(0);
      expect(success.warnings).toContain("no_hunks_in_comparison");
      expect((raw["meta"] as Record<string, unknown>)["filesScanned"]).toBe(0);
      expect(success.nextStep).toMatch(/no parseable files/i);
      expect("resolved" in raw).toBe(false);
    });
  });
});
