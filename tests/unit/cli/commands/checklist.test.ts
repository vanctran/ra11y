/**
 * Unit tests for `runChecklist` — the handler backing
 * `ra11y --checklist`. Invokes the handler directly against a tmpdir
 * fixture project so coverage is captured.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chdir, cwd } from "node:process";
import { parseCliArgs } from "../../../../src/cli/args.ts";
import { runChecklist } from "../../../../src/cli/commands/checklist.ts";
import { setColorEnabled } from "../../../../src/utils/ansi.ts";

setColorEnabled(false);

const originalCwd = cwd();
const scratchDirs: string[] = [];

afterEach(async () => {
  chdir(originalCwd);
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ra11y-checklist-"));
  scratchDirs.push(dir);
  return dir;
}

describe("runChecklist", () => {
  it("emits a combined violations report and manual review checklist", async () => {
    const dir = await scratch();
    await writeFile(
      join(dir, "page.html"),
      '<!doctype html><html lang="en"><head><title>Ok</title></head><body><p>hi</p></body></html>',
    );
    chdir(dir);

    const r = await runChecklist(parseCliArgs([]));

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("# Manual review checklist");
    expect(r.stdout).toContain("criteria need manual review");
  });

  it("includes at least one manual-review criterion from WCAG 2.2", async () => {
    const dir = await scratch();
    await writeFile(
      join(dir, "page.html"),
      '<!doctype html><html lang="en"><head><title>Ok</title></head><body><p>hi</p></body></html>',
    );
    chdir(dir);

    const r = await runChecklist(parseCliArgs([]));

    expect(r.exitCode).toBe(0);
    // WCAG 2.2 section header precedes the per-criterion checkbox rows.
    expect(r.stdout).toContain("## WCAG 2.2");
    expect(r.stdout).toMatch(/- \[ \] \*\*\d+\.\d+\.\d+\*\*/);
  });

  it("surfaces violation output before the manual checklist", async () => {
    const dir = await scratch();
    await writeFile(
      join(dir, "bad.html"),
      '<!doctype html><html><body><img src="x"></body></html>',
    );
    chdir(dir);

    const r = await runChecklist(parseCliArgs([]));

    const violationsIdx = r.stdout.indexOf("media/alt-text-missing");
    const checklistIdx = r.stdout.indexOf("# Manual review checklist");
    expect(violationsIdx).toBeGreaterThanOrEqual(0);
    expect(checklistIdx).toBeGreaterThan(violationsIdx);
  });

  it("renders violations using the requested --format", async () => {
    const dir = await scratch();
    await writeFile(
      join(dir, "bad.html"),
      '<!doctype html><html><body><img src="x"></body></html>',
    );
    chdir(dir);

    const r = await runChecklist(parseCliArgs(["--format", "json"]));

    // JSON object precedes the "---" separator and the checklist markdown.
    const sepIdx = r.stdout.indexOf("\n\n---\n\n");
    expect(sepIdx).toBeGreaterThan(0);
    const jsonPart = r.stdout.slice(0, sepIdx);
    const parsed = JSON.parse(jsonPart) as { result: { violations: readonly unknown[] } };
    expect(Array.isArray(parsed.result.violations)).toBe(true);
  });

  it("respects --standard wcag21 by titling the checklist section", async () => {
    const dir = await scratch();
    await writeFile(
      join(dir, "page.html"),
      '<!doctype html><html lang="en"><head><title>Ok</title></head><body><p>hi</p></body></html>',
    );
    chdir(dir);

    const r = await runChecklist(parseCliArgs(["--standard", "wcag21"]));

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("## WCAG 2.1");
  });

  it("skips files the parsers don't recognize (e.g. .md)", async () => {
    const dir = await scratch();
    await writeFile(join(dir, "README.md"), "# readme");
    await writeFile(
      join(dir, "page.html"),
      '<!doctype html><html lang="en"><head><title>Ok</title></head><body><p>hi</p></body></html>',
    );
    chdir(dir);

    const r = await runChecklist(parseCliArgs([]));

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Manual review checklist");
  });
});
