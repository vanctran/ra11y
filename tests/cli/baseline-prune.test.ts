/**
 * CLI integration tests for `ra11y baseline prune`. Each test builds
 * a scratch baseline + tmp files, drives runCli (same entry point
 * the binary uses), and asserts the argv → disk round-trip.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chdir, cwd } from "node:process";
import { runCli } from "../../src/cli/run.ts";

const originalCwd = cwd();
const scratchDirs: string[] = [];

afterAll(async () => {
  chdir(originalCwd);
  for (const dir of scratchDirs) await rm(dir, { recursive: true, force: true });
});

async function makeScratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ra11y-baseline-prune-"));
  scratchDirs.push(dir);
  return dir;
}

async function writeBaselineFixture(
  dir: string,
  entries: Array<{ filePath: string; ruleId: string }>,
): Promise<string> {
  const baselinePath = join(dir, ".ra11y-baseline.json");
  const file = {
    version: 1,
    generatedAt: "2026-04-17T00:00:00Z",
    ra11yVersion: "0.0.0",
    standards: ["wcag22"],
    violations: entries.map((e, i) => ({
      hash: `hash-${i}`,
      ruleId: e.ruleId,
      filePath: e.filePath,
      message: `violation ${i}`,
    })),
  };
  await writeFile(baselinePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  return baselinePath;
}

describe("ra11y baseline prune", () => {
  it("removes dead entries and rewrites the baseline file", async () => {
    const dir = await makeScratch();
    await writeFile(join(dir, "alive.html"), "<html></html>\n");
    const baselinePath = await writeBaselineFixture(dir, [
      { filePath: "alive.html", ruleId: "media/alt-text-missing" },
      { filePath: "dead.html", ruleId: "aria/label-missing" },
    ]);

    chdir(dir);
    const r = await runCli(["baseline", "prune"]);
    chdir(originalCwd);

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("removed 1 dead entries");
    expect(r.stdout).toContain("1 still live");
    expect(r.stdout).toContain("dead.html");

    const parsed = JSON.parse(await readFile(baselinePath, "utf8")) as {
      violations: Array<{ filePath: string }>;
    };
    expect(parsed.violations).toHaveLength(1);
    expect(parsed.violations[0]?.filePath).toBe("alive.html");
  });

  it("reports zero removals when every entry's file still exists", async () => {
    const dir = await makeScratch();
    await writeFile(join(dir, "a.html"), "<html></html>\n");
    await writeFile(join(dir, "b.html"), "<html></html>\n");
    await writeBaselineFixture(dir, [
      { filePath: "a.html", ruleId: "media/alt-text-missing" },
      { filePath: "b.html", ruleId: "media/alt-text-missing" },
    ]);

    chdir(dir);
    const r = await runCli(["baseline", "prune"]);
    chdir(originalCwd);

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("removed 0 dead entries");
    expect(r.stdout).toContain("2 still live");
  });

  it("--dry-run reports what would be removed without mutating the file", async () => {
    const dir = await makeScratch();
    await writeFile(join(dir, "alive.html"), "<html></html>\n");
    const baselinePath = await writeBaselineFixture(dir, [
      { filePath: "alive.html", ruleId: "media/alt-text-missing" },
      { filePath: "dead.html", ruleId: "aria/label-missing" },
    ]);
    const before = await readFile(baselinePath, "utf8");

    chdir(dir);
    const r = await runCli(["baseline", "prune", "--dry-run"]);
    chdir(originalCwd);

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("dry-run");
    expect(r.stdout).toContain("would remove 1 dead entries");
    expect(await readFile(baselinePath, "utf8")).toBe(before);
  });

  it("errors non-zero when the baseline file is missing", async () => {
    const dir = await makeScratch();

    chdir(dir);
    const r = await runCli(["baseline", "prune"]);
    chdir(originalCwd);

    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("baseline file not found");
    expect(r.stderr).toContain("ra11y baseline create");
  });

  it("errors non-zero when the baseline file is malformed JSON", async () => {
    const dir = await makeScratch();
    await writeFile(join(dir, ".ra11y-baseline.json"), "{ this is not json", "utf8");

    chdir(dir);
    const r = await runCli(["baseline", "prune"]);
    chdir(originalCwd);

    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("failed to parse baseline");
  });
});
