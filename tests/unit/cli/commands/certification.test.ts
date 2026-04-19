/**
 * Unit tests for `runCertification` — the handler backing
 * `ra11y --certification`. Tests drive the exported command function
 * directly against a tmpdir fixture so coverage is captured.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chdir, cwd } from "node:process";
import { parseCliArgs } from "../../../../src/cli/args.ts";
import { runCertification } from "../../../../src/cli/commands/certification.ts";

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
  const dir = await mkdtemp(join(tmpdir(), "ra11y-cert-"));
  scratchDirs.push(dir);
  return dir;
}

describe("runCertification", () => {
  it("emits a markdown scorecard for a clean project at exit 0", async () => {
    const dir = await scratch();
    await writeFile(
      join(dir, "page.html"),
      '<!doctype html><html lang="en"><head><title>Ok</title></head><body><p>hi</p></body></html>',
    );
    chdir(dir);

    const r = await runCertification(parseCliArgs([]));

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("# Certification Readiness Scorecard");
    expect(r.stdout).toContain("Readiness:");
  });

  it("reports blocking issues for a project with a failing criterion", async () => {
    const dir = await scratch();
    await writeFile(
      join(dir, "bad.html"),
      '<!doctype html><html><body><img src="x"></body></html>',
    );
    chdir(dir);

    const r = await runCertification(parseCliArgs([]));

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Blocking issues");
    expect(r.stdout).toContain("1.1.1");
  });

  it("credits manual reviews recorded in .ra11y-manual.json", async () => {
    const dir = await scratch();
    await writeFile(
      join(dir, "page.html"),
      '<!doctype html><html lang="en"><head><title>Ok</title></head><body><p>hi</p></body></html>',
    );
    await writeFile(
      join(dir, ".ra11y-manual.json"),
      JSON.stringify({ "wcag22:1.2.1": { reviewed: true, status: "supports" } }),
    );
    chdir(dir);

    const r = await runCertification(parseCliArgs([]));

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Manual review:");
    // At least one manual review should be credited — non-zero numerator.
    expect(r.stdout).not.toContain("Manual review: 0/");
  });

  it("tolerates a malformed .ra11y-manual.json without throwing", async () => {
    const dir = await scratch();
    await writeFile(
      join(dir, "page.html"),
      '<!doctype html><html lang="en"><head><title>Ok</title></head><body><p>hi</p></body></html>',
    );
    await writeFile(join(dir, ".ra11y-manual.json"), "{ not json");
    chdir(dir);

    const r = await runCertification(parseCliArgs([]));

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Certification Readiness");
  });

  it("respects --standard when filtering scorecard standards", async () => {
    const dir = await scratch();
    await writeFile(
      join(dir, "page.html"),
      '<!doctype html><html lang="en"><head><title>Ok</title></head><body><p>hi</p></body></html>',
    );
    chdir(dir);

    const r = await runCertification(parseCliArgs(["--standard", "wcag22"]));

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("WCAG 2.2");
  });

  it("respects --level AAA by widening the target criterion set", async () => {
    const dir = await scratch();
    await writeFile(
      join(dir, "page.html"),
      '<!doctype html><html lang="en"><head><title>Ok</title></head><body><p>hi</p></body></html>',
    );
    chdir(dir);

    const r = await runCertification(parseCliArgs(["--level", "AAA"]));

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("target Level AAA");
  });

  it("skips unparseable files without aborting the report", async () => {
    const dir = await scratch();
    await writeFile(join(dir, "notes.md"), "# not parseable as tsx or html");
    await writeFile(
      join(dir, "page.html"),
      '<!doctype html><html lang="en"><head><title>Ok</title></head><body><p>hi</p></body></html>',
    );
    chdir(dir);

    const r = await runCertification(parseCliArgs([]));

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Certification Readiness");
  });
});
