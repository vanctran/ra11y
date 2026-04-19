/**
 * Unit tests for `pruneAttestations` — the pure function half of the
 * `ra11y attestations prune` subcommand. Mirrors the shape of
 * `pruneBaseline` tests: injectable predicate, deterministic record
 * ordering, structural result.
 *
 * Invariants under test (not behavior rehearsal):
 *   - Records pinned to live files are always kept.
 *   - Records pinned to deleted files are always dropped.
 *   - Records with no `location` are never dropped (the prune has no
 *     file-identity for them).
 *   - Empty input yields empty output.
 *   - `rewriteAttestations` round-trips through the lenient read path.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  pruneAttestations,
  readAttestations,
  resolveAttestationStorePath,
  rewriteAttestations,
} from "../../../src/config/attestation-store.ts";
import type { AttestationRecord } from "../../../src/types/evidence.ts";

const BASE: AttestationRecord = {
  criterionId: "wcag22:2.4.5",
  by: "author@example.test",
  reason: "verified by manual keyboard traversal",
  attestedAt: "2026-04-18T00:00:00.000Z",
};

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "ra11y-prune-"));
}

describe("pruneAttestations: pure function", () => {
  it("returns empty kept and dropped for empty input", () => {
    const result = pruneAttestations([], () => true);
    expect(result.kept).toEqual([]);
    expect(result.dropped).toEqual([]);
  });

  it("keeps every record when all pinned files exist", () => {
    const records: AttestationRecord[] = [
      {
        ...BASE,
        scope: "file",
        location: { filePath: "src/button.tsx", line: 1, column: 1 },
      },
      {
        ...BASE,
        criterionId: "wcag22:2.4.7",
        scope: "line",
        location: { filePath: "src/menu.tsx", line: 42, column: 3 },
      },
    ];
    const result = pruneAttestations(records, () => true);
    expect(result.kept).toEqual(records);
    expect(result.dropped).toEqual([]);
  });

  it("drops records whose pinned file no longer exists", () => {
    const alive: AttestationRecord = {
      ...BASE,
      scope: "file",
      location: { filePath: "src/alive.tsx", line: 1, column: 1 },
    };
    const dead: AttestationRecord = {
      ...BASE,
      criterionId: "wcag22:2.4.7",
      scope: "file",
      location: { filePath: "src/dead.tsx", line: 1, column: 1 },
    };
    const existing = new Set(["src/alive.tsx"]);
    const result = pruneAttestations([alive, dead], (p) => existing.has(p));
    expect(result.kept).toEqual([alive]);
    expect(result.dropped).toEqual([dead]);
  });

  it("never drops project-scope records (no location pin)", () => {
    // Project-scope records carry no `location` — the prune has no
    // file-identity to test, so they must always survive. This is the
    // analogue of baseline's "always-live metadata" contract.
    const projectScoped: AttestationRecord = { ...BASE, scope: "project" };
    const noScope: AttestationRecord = { ...BASE, criterionId: "wcag22:1.1.1" };
    const result = pruneAttestations(
      [projectScoped, noScope],
      // Predicate always reports "missing" — project-scope records
      // should still be kept because they have nothing to test.
      () => false,
    );
    expect(result.kept).toEqual([projectScoped, noScope]);
    expect(result.dropped).toEqual([]);
  });

  it("drops a location-pinned record whose file is missing even when scope is 'project'", () => {
    // Defensive: if a record carries a `location` we test it, regardless
    // of scope. The scope defaults conceptually to "project" when
    // omitted, but the prune keys on location-presence, not scope.
    const pinnedDead: AttestationRecord = {
      ...BASE,
      location: { filePath: "src/gone.tsx", line: 7, column: 1 },
    };
    const result = pruneAttestations([pinnedDead], () => false);
    expect(result.kept).toEqual([]);
    expect(result.dropped).toEqual([pinnedDead]);
  });

  it("preserves input order across kept and dropped partitions", () => {
    const a: AttestationRecord = {
      ...BASE,
      criterionId: "wcag22:1.1.1",
      location: { filePath: "src/a.tsx", line: 1, column: 1 },
    };
    const b: AttestationRecord = {
      ...BASE,
      criterionId: "wcag22:1.1.2",
      location: { filePath: "src/b.tsx", line: 1, column: 1 },
    };
    const c: AttestationRecord = {
      ...BASE,
      criterionId: "wcag22:1.1.3",
      location: { filePath: "src/c.tsx", line: 1, column: 1 },
    };
    const alive = new Set(["src/a.tsx", "src/c.tsx"]);
    const result = pruneAttestations([a, b, c], (p) => alive.has(p));
    expect(result.kept.map((r) => r.criterionId)).toEqual(["wcag22:1.1.1", "wcag22:1.1.3"]);
    expect(result.dropped.map((r) => r.criterionId)).toEqual(["wcag22:1.1.2"]);
  });
});

describe("rewriteAttestations: store primitive", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("writes a JSONL store that round-trips through readAttestations", async () => {
    const records: AttestationRecord[] = [
      { ...BASE, criterionId: "wcag22:2.4.5" },
      { ...BASE, criterionId: "wcag22:2.4.7" },
    ];
    await rewriteAttestations(root, records);
    const read = await readAttestations(root);
    expect(read.map((r) => r.criterionId)).toEqual(records.map((r) => r.criterionId));
  });

  it("truncates existing content (not append)", async () => {
    await rewriteAttestations(root, [BASE, { ...BASE, criterionId: "wcag22:2.4.7" }]);
    await rewriteAttestations(root, [{ ...BASE, criterionId: "wcag22:1.1.1" }]);
    const read = await readAttestations(root);
    expect(read.map((r) => r.criterionId)).toEqual(["wcag22:1.1.1"]);
  });

  it("writes an empty file when given an empty record list", async () => {
    await rewriteAttestations(root, []);
    const path = resolveAttestationStorePath(root);
    expect(readFileSync(path, "utf8")).toBe("");
    expect(await readAttestations(root)).toEqual([]);
  });

  it("throws when any record is invalid (strict write path)", async () => {
    await expect(
      rewriteAttestations(root, [{ ...BASE, reason: "" } as AttestationRecord]),
    ).rejects.toThrow(/invalid attestation record/);
  });
});
