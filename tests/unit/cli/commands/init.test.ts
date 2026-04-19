/**
 * Unit tests for `runInit` — the handler backing `ra11y --init`.
 * Drives the handler directly against a tmpdir project so function
 * coverage is captured. No fs mocking — every test writes real
 * files into a scratch directory that is torn down afterwards.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chdir, cwd } from "node:process";
import { parseCliArgs } from "../../../../src/cli/args.ts";
import { runInit } from "../../../../src/cli/commands/init.ts";

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
  const dir = await mkdtemp(join(tmpdir(), "ra11y-init-"));
  scratchDirs.push(dir);
  return dir;
}

describe("runInit", () => {
  it("writes ra11y.config.ts into an empty directory at exit 0", async () => {
    const dir = await scratch();
    chdir(dir);

    const r = runInit(parseCliArgs([]));

    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    expect(existsSync(join(dir, "ra11y.config.ts"))).toBe(true);
  });

  it("prints a confirmation with the relative path on success", async () => {
    const dir = await scratch();
    chdir(dir);

    const r = runInit(parseCliArgs([]));

    expect(r.stdout).toContain("wrote ra11y.config.ts");
  });

  it("prints next-step hints after writing the config", async () => {
    const dir = await scratch();
    chdir(dir);

    const r = runInit(parseCliArgs([]));

    expect(r.stdout).toContain("Next:");
    expect(r.stdout).toContain("ra11y src/");
    expect(r.stdout).toContain("--detect-native-wrappers");
  });

  it("emits a template that references defineConfig from @ra11y/core/plugin", async () => {
    const dir = await scratch();
    chdir(dir);

    runInit(parseCliArgs([]));
    const body = await readFile(join(dir, "ra11y.config.ts"), "utf8");

    expect(body).toContain('import { defineConfig } from "@ra11y/core/plugin"');
    expect(body).toContain("export default defineConfig(");
  });

  it("emits a template with the documented starter knobs", async () => {
    const dir = await scratch();
    chdir(dir);

    runInit(parseCliArgs([]));
    const body = await readFile(join(dir, "ra11y.config.ts"), "utf8");

    expect(body).toContain('standards: ["wcag22"]');
    expect(body).toContain('level: "AA"');
    expect(body).toContain("exclude: [");
    expect(body).toContain("nativeWrappers: [");
  });

  it("refuses to overwrite an existing ra11y.config.ts with exit 1", async () => {
    const dir = await scratch();
    const original = "// pre-existing\nexport default { marker: true };\n";
    await writeFile(join(dir, "ra11y.config.ts"), original);
    chdir(dir);

    const r = runInit(parseCliArgs([]));

    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
  });

  it("keeps the existing ra11y.config.ts untouched when refusing to overwrite", async () => {
    const dir = await scratch();
    const original = "// pre-existing\nexport default { marker: true };\n";
    await writeFile(join(dir, "ra11y.config.ts"), original);
    chdir(dir);

    runInit(parseCliArgs([]));
    const after = await readFile(join(dir, "ra11y.config.ts"), "utf8");

    expect(after).toBe(original);
  });

  it("routes the refusal message to stderr with the offending path", async () => {
    const dir = await scratch();
    await writeFile(join(dir, "ra11y.config.ts"), "export default {};\n");
    chdir(dir);

    const r = runInit(parseCliArgs([]));

    expect(r.stderr).toContain("ra11y.config.ts");
    expect(r.stderr).toContain("already exists");
    expect(r.stderr).toContain("not overwriting");
  });

  it("writes even when the directory has unrelated files alongside", async () => {
    const dir = await scratch();
    await writeFile(join(dir, "package.json"), '{"name":"x"}\n');
    await writeFile(join(dir, "README.md"), "# x\n");
    chdir(dir);

    const r = runInit(parseCliArgs([]));

    expect(r.exitCode).toBe(0);
    expect(existsSync(join(dir, "ra11y.config.ts"))).toBe(true);
  });

  it("terminates stderr with a newline when refusing to overwrite", async () => {
    const dir = await scratch();
    await writeFile(join(dir, "ra11y.config.ts"), "export default {};\n");
    chdir(dir);

    const r = runInit(parseCliArgs([]));

    expect(r.stderr.endsWith("\n")).toBe(true);
  });
});
