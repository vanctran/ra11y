/**
 * Unit tests for `scan_diff` baseline mode — the default mode that
 * loads a baseline snapshot and returns the delta. Drives the handler
 * in-process so baseline-mode branches get real line-coverage credit;
 * the subprocess-based integration test in
 * `tests/integration/mcp-tool-scan-diff.test.ts` covers the same
 * surface but its coverage doesn't flow back to the instrumented
 * source.
 *
 * Scope: missing / malformed / version-mismatch error envelopes,
 * happy path with resolved surfacing, empty-baseline delta, stable
 * `findingId` across runs, `baselinePath` resolution (absolute + cwd-
 * relative), `changedOnly` + `since` scope selectors, empty-files
 * response when nothing parseable is scanned, `additionalPaths`
 * widening, and macOS /private symlink cwd normalization.
 */

import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeBaseline } from "../../../src/engine/baseline.ts";
import { McpSession } from "../../../src/mcp/session.ts";
import { scanDiffTool } from "../../../src/mcp/tool-scan-diff.ts";

interface ErrorBody {
  readonly error: string;
  readonly code: string;
  readonly details?: Record<string, unknown>;
}

interface BaselineBody {
  readonly mode: string;
  readonly baselinePath: string;
  readonly baselineCount: number;
  readonly baselineGeneratedAt: string;
  readonly newCount: number;
  readonly newViolations: Array<{
    readonly path: string;
    readonly findings: Array<{
      readonly findingId: string;
      readonly groupKey?: string;
      readonly ruleId: string;
      readonly line: number;
    }>;
  }>;
  readonly resolvedCount: number;
  readonly resolved: Array<{
    readonly filePath: string;
    readonly ruleId: string;
    readonly message: string;
  }>;
  readonly meta: Record<string, unknown>;
  readonly nextStep: string;
}

async function withScratch<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "ra11y-scan-diff-unit-"));
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
  body: BaselineBody | ErrorBody;
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
    body: raw as unknown as BaselineBody | ErrorBody,
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

async function writeEmptyBaseline(path: string): Promise<void> {
  await writeBaseline(path, {
    version: 1,
    generatedAt: new Date().toISOString(),
    ra11yVersion: "0.0.0",
    standards: ["wcag22"],
    violations: [],
  });
}

/**
 * Seed a baseline from the tool's own output. Starts with an empty
 * baseline so every finding surfaces as "new", extracts each
 * findingId, then rewrites the baseline with those hashes so a
 * follow-up call sees zero delta.
 */
async function seedBaseline(
  dir: string,
  baselineFile: string = join(dir, ".ra11y-baseline.json"),
): Promise<void> {
  await writeEmptyBaseline(baselineFile);
  const fresh = await callHandler(new McpSession(), { cwd: dir, baselinePath: baselineFile });
  const success = fresh.body as BaselineBody;
  const entries: Array<{ hash: string; ruleId: string; filePath: string; message: string }> = [];
  for (const file of success.newViolations) {
    for (const finding of file.findings) {
      const raw = finding as unknown as Record<string, unknown>;
      entries.push({
        hash: String(raw["findingId"]),
        ruleId: String(raw["ruleId"]),
        filePath: file.path,
        message: String(raw["message"] ?? ""),
      });
    }
  }
  await writeBaseline(baselineFile, {
    version: 1,
    generatedAt: new Date().toISOString(),
    ra11yVersion: "0.0.0",
    standards: ["wcag22"],
    violations: entries,
  });
}

describe("scan_diff baseline mode: missing + malformed", () => {
  it("returns `baseline-not-found` when the default baseline path doesn't exist", async () => {
    await withScratch(async (dir) => {
      await writeBadImg(dir);
      const { isError, code, body } = await callHandler(new McpSession(), { cwd: dir });
      expect(isError).toBe(true);
      expect(code).toBe("baseline-not-found");
      expect((body as ErrorBody).error).toMatch(/baseline file not found/i);
    });
  });

  it("returns `baseline-load-failed` when the baseline JSON is malformed", async () => {
    await withScratch(async (dir) => {
      await writeBadImg(dir);
      await writeFile(join(dir, ".ra11y-baseline.json"), "{ not valid json");
      const { isError, code, body } = await callHandler(new McpSession(), { cwd: dir });
      expect(isError).toBe(true);
      expect(code).toBe("baseline-load-failed");
      expect((body as ErrorBody).error).toMatch(/failed to load baseline/i);
    });
  });

  it("returns `baseline-load-failed` on version mismatch", async () => {
    await withScratch(async (dir) => {
      await writeBadImg(dir);
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
      const { isError, code, body } = await callHandler(new McpSession(), { cwd: dir });
      expect(isError).toBe(true);
      expect(code).toBe("baseline-load-failed");
      expect((body as ErrorBody).error).toMatch(/version 999 is incompatible/i);
    });
  });

  it("resolves absolute `baselinePath` without rewriting it against cwd", async () => {
    await withScratch(async (dir) => {
      await writeBadImg(dir);
      const absolute = join(dir, "deep", "custom.json");
      const { code, body } = await callHandler(new McpSession(), {
        cwd: dir,
        baselinePath: absolute,
      });
      expect(code).toBe("baseline-not-found");
      expect((body as ErrorBody).details?.["baselinePath"]).toBe(absolute);
    });
  });
});

describe("scan_diff baseline mode: happy path + resolved", () => {
  it("returns zero new findings when the scan matches the baseline and emits `resolved: []` explicitly", async () => {
    await withScratch(async (dir) => {
      await writeBadImg(dir);
      await seedBaseline(dir);
      const { isError, body, raw } = await callHandler(new McpSession(), { cwd: dir });
      expect(isError).toBe(false);
      const success = body as BaselineBody;
      expect(success.newCount).toBe(0);
      expect(success.resolvedCount).toBe(0);
      // `resolved: []` is deliberately explicit — not conditionally
      // spread — because "zero resolved" is meaningful signal.
      expect(Array.isArray(raw["resolved"])).toBe(true);
      expect(success.resolved).toEqual([]);
    });
  });

  it("surfaces newly-added violations and omits baseline-grandfathered entries", async () => {
    await withScratch(async (dir) => {
      await writeBadImg(dir);
      await seedBaseline(dir);
      await writeBadImg(dir, "page.html");
      const { body } = await callHandler(new McpSession(), { cwd: dir });
      const success = body as BaselineBody;
      expect(success.newCount).toBeGreaterThan(0);
      expect(success.newViolations.some((f) => f.path.endsWith("page.html"))).toBe(true);
      expect(success.newViolations.every((f) => !f.path.endsWith("index.html"))).toBe(true);
    });
  });

  it("surfaces resolved baseline entries when a flagged file is removed", async () => {
    await withScratch(async (dir) => {
      await writeBadImg(dir);
      await writeBadImg(dir, "page.html");
      await seedBaseline(dir);
      await unlink(join(dir, "page.html"));
      const { body } = await callHandler(new McpSession(), { cwd: dir });
      const success = body as BaselineBody;
      expect(success.resolvedCount).toBeGreaterThan(0);
      expect(success.resolved.every((r) => r.filePath.endsWith("page.html"))).toBe(true);
      expect(success.nextStep).toMatch(/resolved/i);
    });
  });

  it("emits stable `findingId` across repeated baseline-mode scans", async () => {
    await withScratch(async (dir) => {
      await writeBadImg(dir);
      await writeEmptyBaseline(join(dir, ".ra11y-baseline.json"));
      const run1 = (await callHandler(new McpSession(), { cwd: dir })).body as BaselineBody;
      const run2 = (await callHandler(new McpSession(), { cwd: dir })).body as BaselineBody;
      const ids1 = run1.newViolations.flatMap((f) => f.findings.map((x) => x.findingId));
      const ids2 = run2.newViolations.flatMap((f) => f.findings.map((x) => x.findingId));
      expect(ids1.length).toBeGreaterThan(0);
      expect(ids1).toEqual(ids2);
    });
  });

  it("honors `baselinePath` relative to cwd", async () => {
    await withScratch(async (dir) => {
      await writeBadImg(dir);
      await seedBaseline(dir, join(dir, "custom-baseline.json"));
      const { body } = await callHandler(new McpSession(), {
        cwd: dir,
        baselinePath: "custom-baseline.json",
      });
      const success = body as BaselineBody;
      expect(success.baselinePath).toBe(join(dir, "custom-baseline.json"));
      expect(success.newCount).toBe(0);
    });
  });

  it("returns the empty-files response when nothing parseable is in scope", async () => {
    await withScratch(async (dir) => {
      await writeBaseline(join(dir, ".ra11y-baseline.json"), {
        version: 1,
        generatedAt: new Date().toISOString(),
        ra11yVersion: "0.0.0",
        standards: ["wcag22"],
        violations: [
          {
            hash: "doesnotexist",
            ruleId: "media/alt-text-missing",
            filePath: "gone.html",
            message: "img missing alt",
          },
        ],
      });
      const { isError, body, raw } = await callHandler(new McpSession(), { cwd: dir });
      expect(isError).toBe(false);
      const success = body as BaselineBody;
      expect(success.newCount).toBe(0);
      // Even with baseline entries, the zero-files branch emits
      // `resolved: []` rather than inferring every entry as resolved.
      expect(success.resolved).toEqual([]);
      expect((raw["meta"] as Record<string, unknown>)["filesScanned"]).toBe(0);
      expect(success.nextStep).toMatch(/no parseable files/i);
    });
  });
});

describe("scan_diff baseline mode: scope selectors", () => {
  it("reports `scanMode: changedOnly` and falls back to the full tree when nothing is staged", async () => {
    await withScratch(async (dir) => {
      await writeBadImg(dir);
      git(dir, ["init", "-q"]);
      git(dir, ["config", "user.email", "t@example.com"]);
      git(dir, ["config", "user.name", "t"]);
      git(dir, ["add", "."]);
      git(dir, ["commit", "-q", "-m", "seed"]);
      await seedBaseline(dir);
      const { body } = await callHandler(new McpSession(), { cwd: dir, changedOnly: true });
      const success = body as BaselineBody;
      expect((success.meta as { scanMode: string }).scanMode).toBe("changedOnly");
      expect(success.newCount).toBe(0);
    });
  });

  it("reports `scanMode: since:HEAD` when `since` is provided", async () => {
    await withScratch(async (dir) => {
      await writeBadImg(dir);
      git(dir, ["init", "-q"]);
      git(dir, ["config", "user.email", "t@example.com"]);
      git(dir, ["config", "user.name", "t"]);
      git(dir, ["add", "."]);
      git(dir, ["commit", "-q", "-m", "seed"]);
      await seedBaseline(dir);
      const { body } = await callHandler(new McpSession(), { cwd: dir, since: "HEAD" });
      const success = body as BaselineBody;
      expect((success.meta as { scanMode: string }).scanMode).toBe("since:HEAD");
    });
  });
});

describe("scan_diff baseline mode: additionalPaths widens scope", () => {
  it("scans paths listed under `additionalPaths` that the auto-discovery would skip", async () => {
    await withScratch(async (dir) => {
      const distDir = join(dir, "dist");
      await mkdir(distDir, { recursive: true });
      await writeFile(
        join(distDir, "built.html"),
        '<html><body><img src="/ship.png"></body></html>\n',
      );
      await writeEmptyBaseline(join(dir, ".ra11y-baseline.json"));
      const { body } = await callHandler(new McpSession(), {
        cwd: dir,
        additionalPaths: ["dist"],
      });
      const success = body as BaselineBody;
      expect(success.newCount).toBeGreaterThan(0);
      expect(success.newViolations.some((f) => f.path.includes("built.html"))).toBe(true);
    });
  });
});

describe("scan_diff baseline mode: macOS symlink cwd normalization", () => {
  it("produces a structured baseline-not-found error even when cwd is a /private-prefixed path on macOS", async () => {
    await withScratch(async (dir) => {
      await writeBadImg(dir);
      const alias = dir.startsWith("/private/") ? dir.slice("/private".length) : dir;
      const { code } = await callHandler(new McpSession(), { cwd: dir });
      expect(code).toBe("baseline-not-found");
      if (alias !== dir && existsSync(alias)) {
        const { code: aliasCode, body } = await callHandler(new McpSession(), { cwd: alias });
        expect(aliasCode).toBe("baseline-not-found");
        expect((body as ErrorBody).details?.["baselinePath"]).toContain(".ra11y-baseline.json");
      }
    });
  });
});
