import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chdir, cwd } from "node:process";
import { join } from "node:path";
import { runCli } from "../../src/cli/run.ts";
import { setColorEnabled } from "../../src/utils/ansi.ts";

// CLI tests run in the fixture directory so --positional paths are
// relative to somewhere with predictable content.
const FIXTURES_ROOT = join(import.meta.dir, "..", "fixtures");
const originalCwd = cwd();

beforeAll(() => {
  // Ensure formatter output is deterministic across environments.
  setColorEnabled(false);
  chdir(FIXTURES_ROOT);
});

afterAll(() => {
  chdir(originalCwd);
});

describe("runCli", () => {
  it("--help prints usage and exits 0", async () => {
    const r = await runCli(["--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("ra11y");
    expect(r.stdout).toContain("USAGE");
    expect(r.stdout).toContain("--standard");
  });

  it("-h is an alias for --help", async () => {
    const r = await runCli(["-h"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("USAGE");
  });

  it("--version prints the version and exits 0", async () => {
    const r = await runCli(["--version"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/^ra11y v\d+\.\d+\.\d+/);
  });

  it("--list-rules includes media/alt-text-missing", async () => {
    const r = await runCli(["--list-rules"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("media/alt-text-missing");
    expect(r.stdout).toContain("wcag22:1.1.1");
  });

  it("--list-standards lists wcag22 with its metadata", async () => {
    const r = await runCli(["--list-standards"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("wcag22");
    expect(r.stdout).toContain("WCAG 2.2");
    expect(r.stdout).toContain("W3C");
    expect(r.stdout).toContain("87 total");
  });

  it("--explain <rule-id> prints detailed rule metadata", async () => {
    const r = await runCli(["--explain", "media/alt-text-missing"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("media/alt-text-missing");
    expect(r.stdout).toContain("Normative text");
    expect(r.stdout).toContain("Rationale");
    expect(r.stdout).toContain("References");
  });

  it("--explain with a missing rule errors with exit 2", async () => {
    const r = await runCli(["--explain", "nope/missing"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("not found");
  });

  it("scan over good fixtures returns exit 0", async () => {
    const r = await runCli(["good/alt-text-missing", "--format", "plain"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("0 violations");
  });

  it("scan over bad fixtures surfaces violations and exits 1", async () => {
    const r = await runCli(["bad/alt-text-missing", "--format", "plain"]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("media/alt-text-missing");
    expect(r.stdout).toContain("error");
  });

  it("--format json produces parseable JSON output", async () => {
    const r = await runCli(["bad/alt-text-missing", "--format", "json"]);
    expect(r.exitCode).toBe(1);
    // runCli appends a newline at the end via the scan command; trim.
    const parsed = JSON.parse(r.stdout) as {
      ra11y: { version: string };
      result: { violations: unknown[] };
    };
    expect(parsed.ra11y.version).toBeDefined();
    expect(Array.isArray(parsed.result.violations)).toBe(true);
    expect(parsed.result.violations.length).toBeGreaterThan(0);
  });

  it("--fail-on never forces exit 0 even with violations", async () => {
    const r = await runCli([
      "bad/alt-text-missing",
      "--format",
      "plain",
      "--fail-on",
      "never",
    ]);
    expect(r.exitCode).toBe(0);
    // Violations are still reported — just not failed on.
    expect(r.stdout).toContain("media/alt-text-missing");
  });

  it("--standard with an unknown standard exits 2 with a clear error", async () => {
    const r = await runCli(["good/alt-text-missing", "--standard", "nosuch"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("unknown standard");
  });

  it("--exclude skips matching files", async () => {
    const r = await runCli([
      "bad/alt-text-missing",
      "--format",
      "plain",
      "--exclude",
      "jsx-img",
    ]);
    expect(r.exitCode).toBe(1);
    // jsx file should be filtered out; still fails on HTML violations.
    expect(r.stdout).not.toContain("jsx-img-no-alt.tsx");
    expect(r.stdout).toContain("img-no-alt.html");
  });

  it("scan with no positionals uses the current directory", async () => {
    // cwd is tests/fixtures — walks good/ and bad/ together.
    const r = await runCli(["--format", "plain"]);
    // Has both good (zero violations locally) and bad (some violations).
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("media/alt-text-missing");
  });
});
