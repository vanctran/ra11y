/**
 * Unit tests for `runDoctor` — the handler backing `ra11y --doctor`.
 * Drives the handler directly against a tmpdir project so function
 * coverage is captured.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chdir, cwd } from "node:process";
import { runDoctor } from "../../../../src/cli/commands/doctor.ts";

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
  const dir = await mkdtemp(join(tmpdir(), "ra11y-doctor-"));
  scratchDirs.push(dir);
  return dir;
}

describe("runDoctor", () => {
  it("reports runtime and project details for an empty cwd", async () => {
    const dir = await scratch();
    chdir(dir);

    const r = runDoctor();

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("ra11y v");
    expect(r.stdout).toContain("runtime");
    expect(r.stdout).toContain("project");
    expect(r.stdout).toContain("loaded content");
  });

  it("surfaces the 'no config' hint when ra11y.config.ts is absent", async () => {
    const dir = await scratch();
    chdir(dir);

    const r = runDoctor();

    expect(r.stdout).toContain("config   (none");
    expect(r.stdout).toContain("ra11y --init");
  });

  it("reports the config file when ra11y.config.ts is present", async () => {
    const dir = await scratch();
    await writeFile(join(dir, "ra11y.config.ts"), "export default {};\n");
    chdir(dir);

    const r = runDoctor();

    expect(r.stdout).toContain("config   ra11y.config.ts");
  });

  it("reports tsconfig + git-repo presence accurately", async () => {
    const dir = await scratch();
    await writeFile(join(dir, "tsconfig.json"), "{}\n");
    await mkdir(join(dir, ".git"), { recursive: true });
    chdir(dir);

    const r = runDoctor();

    expect(r.stdout).toContain("tsconfig present");
    expect(r.stdout).toContain("git repo yes");
  });

  it("lists built-in standards and the total rule count", async () => {
    const dir = await scratch();
    chdir(dir);

    const r = runDoctor();

    expect(r.stdout).toContain("standards ");
    expect(r.stdout).toContain("wcag22");
    expect(r.stdout).toMatch(/rules\s+\d+/);
  });

  it("ends with the no-blocking-issues summary line on exit 0", async () => {
    const dir = await scratch();
    chdir(dir);

    const r = runDoctor();

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("doctor: no blocking issues");
  });
});
