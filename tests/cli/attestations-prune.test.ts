/**
 * CLI integration tests for `ra11y attestations prune`. Mirrors the
 * shape of `tests/cli/baseline-prune.test.ts`: scratch dir + real
 * `.ra11y/attestations.jsonl`, drive through `runCli`, assert the
 * argv → disk round-trip.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { chdir, cwd } from "node:process";
import { runCli } from "../../src/cli/run.ts";
import type { AttestationRecord } from "../../src/types/evidence.ts";

const originalCwd = cwd();
const scratchDirs: string[] = [];

afterAll(async () => {
  chdir(originalCwd);
  for (const dir of scratchDirs) await rm(dir, { recursive: true, force: true });
});

async function makeScratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ra11y-attest-prune-"));
  scratchDirs.push(dir);
  return dir;
}

const BASE: AttestationRecord = {
  criterionId: "wcag22:2.4.5",
  by: "author@example.test",
  reason: "verified by manual keyboard traversal",
  attestedAt: "2026-04-18T00:00:00.000Z",
};

function writeStoreFixture(dir: string, records: readonly AttestationRecord[]): string {
  const path = join(dir, ".ra11y", "attestations.jsonl");
  mkdirSync(dirname(path), { recursive: true });
  const body = records.map((r) => JSON.stringify(r)).join("\n");
  writeFileSync(path, body.length > 0 ? `${body}\n` : "", "utf8");
  return path;
}

describe("ra11y attestations prune", () => {
  it("drops records pinned to deleted files and rewrites the store", async () => {
    const dir = await makeScratch();
    await writeFile(join(dir, "alive.tsx"), "export {};\n");
    const storePath = writeStoreFixture(dir, [
      {
        ...BASE,
        scope: "file",
        location: { filePath: join(dir, "alive.tsx"), line: 1, column: 1 },
      },
      {
        ...BASE,
        criterionId: "wcag22:2.4.7",
        scope: "file",
        location: { filePath: join(dir, "dead.tsx"), line: 1, column: 1 },
      },
    ]);

    chdir(dir);
    const r = await runCli(["attestations", "prune"]);
    chdir(originalCwd);

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("dropped 1 dead records");
    expect(r.stdout).toContain("1 still live");
    expect(r.stdout).toContain("dead.tsx");

    const parsed = (await readFile(storePath, "utf8"))
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as AttestationRecord);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.criterionId).toBe("wcag22:2.4.5");
  });

  it("reports zero drops when every pinned file still exists", async () => {
    const dir = await makeScratch();
    await writeFile(join(dir, "a.tsx"), "export {};\n");
    await writeFile(join(dir, "b.tsx"), "export {};\n");
    writeStoreFixture(dir, [
      {
        ...BASE,
        scope: "file",
        location: { filePath: join(dir, "a.tsx"), line: 1, column: 1 },
      },
      {
        ...BASE,
        criterionId: "wcag22:2.4.7",
        scope: "file",
        location: { filePath: join(dir, "b.tsx"), line: 1, column: 1 },
      },
    ]);

    chdir(dir);
    const r = await runCli(["attestations", "prune"]);
    chdir(originalCwd);

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("dropped 0 dead records");
    expect(r.stdout).toContain("2 still live");
  });

  it("--dry-run reports what would be dropped without mutating the file", async () => {
    const dir = await makeScratch();
    await writeFile(join(dir, "alive.tsx"), "export {};\n");
    const storePath = writeStoreFixture(dir, [
      {
        ...BASE,
        scope: "file",
        location: { filePath: join(dir, "alive.tsx"), line: 1, column: 1 },
      },
      {
        ...BASE,
        criterionId: "wcag22:2.4.7",
        scope: "file",
        location: { filePath: join(dir, "dead.tsx"), line: 1, column: 1 },
      },
    ]);
    const before = await readFile(storePath, "utf8");

    chdir(dir);
    const r = await runCli(["attestations", "prune", "--dry-run"]);
    chdir(originalCwd);

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("dry-run");
    expect(r.stdout).toContain("would drop 1 dead records");
    expect(await readFile(storePath, "utf8")).toBe(before);
  });

  it("errors non-zero when the store file is missing", async () => {
    const dir = await makeScratch();

    chdir(dir);
    const r = await runCli(["attestations", "prune"]);
    chdir(originalCwd);

    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("attestation store not found");
    expect(r.stderr).toContain("ra11y attest");
  });
});
