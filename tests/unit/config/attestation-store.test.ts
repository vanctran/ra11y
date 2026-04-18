/**
 * Unit tests for the `.ra11y/attestations.jsonl` store.
 *
 * Shapes under test:
 *   - Empty/missing store returns `[]` (both branches).
 *   - Valid JSONL parses into AttestationRecord[] with optional
 *     fields preserved when present, omitted when absent.
 *   - Malformed lines (bad JSON, missing fields, wrong types) are
 *     silently skipped at read time — an adjacent bad line does not
 *     poison the valid records around it.
 *   - `appendAttestation` creates `.ra11y/` and the empty file when
 *     neither exists.
 *   - Multiple appends accumulate; the file is append-only (existing
 *     lines are preserved byte-for-byte).
 *   - Write path is strict: appending an invalid record throws, so
 *     the sanctioned tool can't insert garbage.
 *   - Records with criterionId containing a `:` (the normal WCAG
 *     format) round-trip cleanly.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ATTESTATION_STORE_RELATIVE_PATH,
  appendAttestation,
  parseAttestationJsonl,
  readAttestations,
  resolveAttestationStorePath,
} from "../../../src/config/attestation-store.ts";
import type { AttestationRecord } from "../../../src/types/evidence.ts";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "ra11y-attest-"));
}

const BASE: AttestationRecord = {
  criterionId: "wcag22:2.4.5",
  by: "author@example.test",
  reason: "verified by manual keyboard traversal",
  attestedAt: "2026-04-18T00:00:00.000Z",
};

describe("attestation-store: paths", () => {
  it("resolves under <projectRoot>/.ra11y/attestations.jsonl", () => {
    const p = resolveAttestationStorePath("/tmp/project");
    expect(p.endsWith(ATTESTATION_STORE_RELATIVE_PATH)).toBe(true);
    expect(p.startsWith("/tmp/project")).toBe(true);
  });
});

describe("attestation-store: readAttestations", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns [] when the store does not exist", async () => {
    expect(await readAttestations(root)).toEqual([]);
  });

  it("returns [] for an empty store", async () => {
    await appendAttestation(root, BASE);
    const path = resolveAttestationStorePath(root);
    writeFileSync(path, "", "utf8");
    expect(await readAttestations(root)).toEqual([]);
  });

  it("round-trips a valid record with all optional fields", async () => {
    const record: AttestationRecord = {
      ...BASE,
      scope: "file",
      location: { filePath: "src/button.tsx", line: 42, column: 3 },
      verdict: "pass",
    };
    await appendAttestation(root, record);
    const read = await readAttestations(root);
    expect(read).toHaveLength(1);
    expect(read[0]).toEqual(record);
  });

  it("silently skips malformed lines around valid ones", () => {
    const raw = [
      "not json at all",
      JSON.stringify(BASE),
      JSON.stringify({ criterionId: "wcag22:1.4.3" }), // missing required
      JSON.stringify({ ...BASE, by: "" }), // empty by
      JSON.stringify({ ...BASE, criterionId: "wcag22:2.4.6" }),
      "",
      "  ",
    ].join("\n");
    const parsed = parseAttestationJsonl(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.criterionId).toBe("wcag22:2.4.5");
    expect(parsed[1]?.criterionId).toBe("wcag22:2.4.6");
  });
});

describe("attestation-store: appendAttestation", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("creates .ra11y/ and the file when neither exists", async () => {
    await appendAttestation(root, BASE);
    const path = resolveAttestationStorePath(root);
    const contents = readFileSync(path, "utf8");
    expect(contents).toBe(`${JSON.stringify(BASE)}\n`);
  });

  it("accumulates across multiple appends", async () => {
    const second: AttestationRecord = { ...BASE, criterionId: "wcag22:2.4.7" };
    await appendAttestation(root, BASE);
    await appendAttestation(root, second);
    const read = await readAttestations(root);
    expect(read.map((r) => r.criterionId)).toEqual([BASE.criterionId, second.criterionId]);
  });

  it("normalizes a missing trailing newline before appending", async () => {
    const path = resolveAttestationStorePath(root);
    await appendAttestation(root, BASE); // creates the file
    // Rewrite without the trailing newline to simulate an external
    // editor leaving the file un-terminated.
    const bare = JSON.stringify(BASE);
    writeFileSync(path, bare, "utf8");
    const second: AttestationRecord = { ...BASE, criterionId: "wcag22:2.4.7" };
    await appendAttestation(root, second);
    const contents = readFileSync(path, "utf8");
    expect(contents).toBe(`${bare}\n${JSON.stringify(second)}\n`);
  });

  it("throws on an invalid record (strict write path)", async () => {
    await expect(
      appendAttestation(root, { ...BASE, reason: "" } as AttestationRecord),
    ).rejects.toThrow(/invalid attestation record/);
  });
});
