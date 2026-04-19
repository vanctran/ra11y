/**
 * Unit tests for buildEvidenceLedger — the per-criterion aggregator
 * the scanner folds over violations + review candidates at the end of
 * a scan.
 *
 * Shapes under test:
 *   - A criterion with a static source lands in `"fail"` regardless of
 *     its automatability.
 *   - A non-manual criterion with no sources lands in `"pass"`.
 *   - A manual criterion with no sources lands in `"unknown"`.
 *   - A manual criterion with candidate sources STAYS in `"unknown"` —
 *     candidates point, they don't assert.
 *   - Equivalence fan-out is honoured: a violation citing
 *     `wcag22:1.4.3` also lands on `section508:7.1.4.3` when the
 *     violation's `criteria[]` already lists both (the scanner expands
 *     equivalence upstream via StandardFilter; the ledger only indexes
 *     what it's given).
 *   - Entries are sorted by criterion ID; per-criterion sources are
 *     sorted stably (static by findingId).
 *   - `generatedAt` override is respected (determinism for tests).
 *   - Criteria from loaded-but-disabled standards are skipped.
 */

import { describe, expect, it } from "bun:test";
import { buildEvidenceLedger } from "../../../src/engine/evidence-ledger.ts";
import type { AttestationRecord, EvidenceSource } from "../../../src/types/evidence.ts";
import type { ReviewCandidate } from "../../../src/types/review.ts";
import type { Standard } from "../../../src/types/standard.ts";
import type { ReportData, ScanResult, Violation } from "../../../src/types/violation.ts";

const FIXED_TIMESTAMP = "2026-04-18T00:00:00.000Z";

function mkStandard(id: string, criteria: readonly MinimalCriterion[]): Standard {
  return {
    id,
    name: id.toUpperCase(),
    version: "1.0",
    publisher: "test",
    url: `https://example.test/${id}`,
    levels: ["A", "AA", "AAA"],
    criteria: criteria.map((c) => ({
      id: `${id}:${c.localId}`,
      standardId: id,
      localId: c.localId,
      title: c.localId,
      level: c.level ?? "A",
      description: "",
      url: `https://example.test/${id}/${c.localId}`,
      automatable: c.automatable,
      ...(c.equivalentTo ? { equivalentTo: c.equivalentTo } : {}),
    })),
  };
}

interface MinimalCriterion {
  readonly localId: string;
  readonly automatable: "full" | "partial" | "manual";
  readonly level?: string;
  readonly equivalentTo?: readonly string[];
}

function mkViolation(criteria: readonly string[], findingId = "aaaa11112222"): Violation {
  return {
    ruleId: "test/rule",
    fixClass: "guidance",
    criteria,
    severity: "warning",
    location: { filePath: "f.tsx", line: 1, column: 1 },
    message: "x",
    findingId,
    groupKey: "gk0000000000",
  };
}

function mkCandidate(
  criterionId: string,
  overrides: Partial<ReviewCandidate> = {},
): ReviewCandidate {
  return {
    criterionId,
    location: { filePath: "f.tsx", line: 1, column: 1 },
    reason: "needs review",
    confidence: "medium",
    ...overrides,
  };
}

function mkResult(violations: readonly Violation[]): ScanResult {
  return {
    violations,
    filesScanned: 1,
    durationMs: 0,
    enabledStandards: ["wcag22"],
    isTTY: false,
  };
}

function mkReport(candidates: readonly ReviewCandidate[]): ReportData {
  return {
    coverage: [],
    manualReviewNeeded: [],
    ...(candidates.length > 0 ? { candidates } : {}),
  };
}

function mkAttestation(
  criterionId: string,
  overrides: Partial<AttestationRecord> = {},
): AttestationRecord {
  return {
    criterionId,
    by: "author@example.test",
    reason: "verified by manual keyboard test",
    attestedAt: "2026-04-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildEvidenceLedger", () => {
  it("marks a non-manual criterion with no sources as pass", () => {
    const wcag22 = mkStandard("wcag22", [{ localId: "1.4.3", automatable: "full" }]);
    const ledger = buildEvidenceLedger({
      result: mkResult([]),
      report: mkReport([]),
      standards: [wcag22],
      enabled: new Set(["wcag22"]),
      generatedAt: FIXED_TIMESTAMP,
    });
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]?.status).toBe("pass");
    expect(ledger.entries[0]?.sources).toEqual([]);
  });

  it("marks a manual criterion with no sources as unknown", () => {
    const wcag22 = mkStandard("wcag22", [{ localId: "2.4.5", automatable: "manual" }]);
    const ledger = buildEvidenceLedger({
      result: mkResult([]),
      report: mkReport([]),
      standards: [wcag22],
      enabled: new Set(["wcag22"]),
      generatedAt: FIXED_TIMESTAMP,
    });
    expect(ledger.entries[0]?.status).toBe("unknown");
  });

  it("marks a criterion with any static source as fail, even when automatable is manual", () => {
    const wcag22 = mkStandard("wcag22", [
      { localId: "1.4.3", automatable: "full" },
      { localId: "2.4.5", automatable: "manual" },
    ]);
    const ledger = buildEvidenceLedger({
      result: mkResult([mkViolation(["wcag22:1.4.3", "wcag22:2.4.5"], "abcd11112222")]),
      report: mkReport([]),
      standards: [wcag22],
      enabled: new Set(["wcag22"]),
      generatedAt: FIXED_TIMESTAMP,
    });
    const byId = new Map(ledger.entries.map((e) => [e.criterionId, e]));
    expect(byId.get("wcag22:1.4.3")?.status).toBe("fail");
    expect(byId.get("wcag22:2.4.5")?.status).toBe("fail");
  });

  it("does NOT promote a manual criterion out of unknown when candidates exist", () => {
    const wcag22 = mkStandard("wcag22", [{ localId: "2.4.5", automatable: "manual" }]);
    const ledger = buildEvidenceLedger({
      result: mkResult([]),
      report: mkReport([mkCandidate("wcag22:2.4.5", { confidence: "high" })]),
      standards: [wcag22],
      enabled: new Set(["wcag22"]),
      generatedAt: FIXED_TIMESTAMP,
    });
    expect(ledger.entries[0]?.status).toBe("unknown");
    expect(ledger.entries[0]?.sources).toHaveLength(1);
    expect(ledger.entries[0]?.sources[0]).toMatchObject({ kind: "candidate", confidence: "high" });
  });

  it("fans out a violation across every criterion in v.criteria (equivalence precomputed upstream)", () => {
    const wcag22 = mkStandard("wcag22", [{ localId: "1.4.3", automatable: "full" }]);
    const s508 = mkStandard("section508", [
      { localId: "7.1.4.3", automatable: "full", equivalentTo: ["wcag22:1.4.3"] },
    ]);
    const ledger = buildEvidenceLedger({
      result: mkResult([mkViolation(["wcag22:1.4.3", "section508:7.1.4.3"], "cafebabe1234")]),
      report: mkReport([]),
      standards: [wcag22, s508],
      enabled: new Set(["wcag22", "section508"]),
      generatedAt: FIXED_TIMESTAMP,
    });
    const byId = new Map(ledger.entries.map((e) => [e.criterionId, e]));
    expect(byId.get("wcag22:1.4.3")?.status).toBe("fail");
    expect(byId.get("section508:7.1.4.3")?.status).toBe("fail");
  });

  it("skips criteria from loaded-but-disabled standards", () => {
    const wcag22 = mkStandard("wcag22", [{ localId: "1.4.3", automatable: "full" }]);
    const s508 = mkStandard("section508", [{ localId: "7.1.4.3", automatable: "full" }]);
    const ledger = buildEvidenceLedger({
      result: mkResult([]),
      report: mkReport([]),
      standards: [wcag22, s508],
      enabled: new Set(["wcag22"]),
      generatedAt: FIXED_TIMESTAMP,
    });
    expect(ledger.entries.map((e) => e.criterionId)).toEqual(["wcag22:1.4.3"]);
    expect(ledger.meta.enabledStandards).toEqual(["wcag22"]);
  });

  it("sorts entries by criterionId and sources by findingId", () => {
    const wcag22 = mkStandard("wcag22", [
      { localId: "2.4.5", automatable: "full" },
      { localId: "1.4.3", automatable: "full" },
    ]);
    const ledger = buildEvidenceLedger({
      result: mkResult([
        mkViolation(["wcag22:1.4.3"], "ffffffffffff"),
        mkViolation(["wcag22:1.4.3"], "000000000001"),
      ]),
      report: mkReport([]),
      standards: [wcag22],
      enabled: new Set(["wcag22"]),
      generatedAt: FIXED_TIMESTAMP,
    });
    expect(ledger.entries.map((e) => e.criterionId)).toEqual(["wcag22:1.4.3", "wcag22:2.4.5"]);
    const staticIds = ledger.entries[0]?.sources.map((s: EvidenceSource) =>
      s.kind === "static" ? s.findingId : "",
    );
    expect(staticIds).toEqual(["000000000001", "ffffffffffff"]);
  });

  it("propagates generatedAt override and enabledStandards into meta", () => {
    const wcag22 = mkStandard("wcag22", [{ localId: "1.4.3", automatable: "full" }]);
    const ledger = buildEvidenceLedger({
      result: mkResult([]),
      report: mkReport([]),
      standards: [wcag22],
      enabled: new Set(["wcag22"]),
      generatedAt: FIXED_TIMESTAMP,
    });
    expect(ledger.meta.generatedAt).toBe(FIXED_TIMESTAMP);
    expect(ledger.meta.enabledStandards).toEqual(["wcag22"]);
  });

  it("promotes a manual criterion from unknown to pass when attested pass", () => {
    const wcag22 = mkStandard("wcag22", [{ localId: "2.4.5", automatable: "manual" }]);
    const ledger = buildEvidenceLedger({
      result: mkResult([]),
      report: mkReport([]),
      standards: [wcag22],
      enabled: new Set(["wcag22"]),
      attestations: [mkAttestation("wcag22:2.4.5")],
      generatedAt: FIXED_TIMESTAMP,
    });
    expect(ledger.entries[0]?.status).toBe("pass");
    expect(ledger.entries[0]?.sources).toHaveLength(1);
    expect(ledger.entries[0]?.sources[0]).toMatchObject({ kind: "attested" });
  });

  it("marks a criterion as fail when attested verdict is fail (no static source)", () => {
    const wcag22 = mkStandard("wcag22", [{ localId: "1.4.3", automatable: "full" }]);
    const ledger = buildEvidenceLedger({
      result: mkResult([]),
      report: mkReport([]),
      standards: [wcag22],
      enabled: new Set(["wcag22"]),
      attestations: [mkAttestation("wcag22:1.4.3", { verdict: "fail" })],
      generatedAt: FIXED_TIMESTAMP,
    });
    expect(ledger.entries[0]?.status).toBe("fail");
  });

  it("keeps fail when static and attested pass collide — static wins", () => {
    const wcag22 = mkStandard("wcag22", [{ localId: "1.4.3", automatable: "full" }]);
    const ledger = buildEvidenceLedger({
      result: mkResult([mkViolation(["wcag22:1.4.3"], "abcd00000000")]),
      report: mkReport([]),
      standards: [wcag22],
      enabled: new Set(["wcag22"]),
      attestations: [mkAttestation("wcag22:1.4.3", { verdict: "pass" })],
      generatedAt: FIXED_TIMESTAMP,
    });
    expect(ledger.entries[0]?.status).toBe("fail");
  });

  it("marks a criterion as n/a when attested verdict is n/a", () => {
    const wcag22 = mkStandard("wcag22", [{ localId: "1.2.1", automatable: "manual" }]);
    const ledger = buildEvidenceLedger({
      result: mkResult([]),
      report: mkReport([]),
      standards: [wcag22],
      enabled: new Set(["wcag22"]),
      attestations: [
        mkAttestation("wcag22:1.2.1", {
          verdict: "n/a",
          reason: "application has no prerecorded media",
        }),
      ],
      generatedAt: FIXED_TIMESTAMP,
    });
    expect(ledger.entries[0]?.status).toBe("n/a");
  });

  it("silently skips attestations for criteria not in any enabled standard", () => {
    const wcag22 = mkStandard("wcag22", [{ localId: "1.4.3", automatable: "full" }]);
    const ledger = buildEvidenceLedger({
      result: mkResult([]),
      report: mkReport([]),
      standards: [wcag22],
      enabled: new Set(["wcag22"]),
      attestations: [mkAttestation("section508:7.1.4.3")],
      generatedAt: FIXED_TIMESTAMP,
    });
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]?.sources).toEqual([]);
  });

  it("defaults omitted attested verdict to pass", () => {
    const wcag22 = mkStandard("wcag22", [{ localId: "2.4.5", automatable: "manual" }]);
    const ledger = buildEvidenceLedger({
      result: mkResult([]),
      report: mkReport([]),
      standards: [wcag22],
      enabled: new Set(["wcag22"]),
      attestations: [
        {
          criterionId: "wcag22:2.4.5",
          by: "ci-bot",
          reason: "axe-core reports pass for link-name rule",
          attestedAt: FIXED_TIMESTAMP,
        },
      ],
      generatedAt: FIXED_TIMESTAMP,
    });
    expect(ledger.entries[0]?.status).toBe("pass");
  });

  it("covers the purely-manual vacuous case — S is empty, criterion-wide pass → pass", () => {
    // Manual criterion, no rules satisfy it. Coverage check is vacuous —
    // ⋃ ruleIds ⊇ ∅ is trivially true. Matches today's manual-attested-pass path.
    const wcag22 = mkStandard("wcag22", [{ localId: "1.2.1", automatable: "manual" }]);
    const ledger = buildEvidenceLedger({
      result: mkResult([]),
      report: mkReport([]),
      standards: [wcag22],
      enabled: new Set(["wcag22"]),
      attestations: [mkAttestation("wcag22:1.2.1")],
      rulesForCriterion: () => [],
      generatedAt: FIXED_TIMESTAMP,
    });
    expect(ledger.entries[0]?.status).toBe("pass");
  });

  it("treats a criterion-wide attestation (no ruleIds) as covering every satisfying rule → pass", () => {
    // Automatable criterion with 3 rules. A criterion-wide attestation fans
    // out to cover all three; the derivation emits pass.
    const wcag22 = mkStandard("wcag22", [{ localId: "4.1.2", automatable: "full" }]);
    const ledger = buildEvidenceLedger({
      result: mkResult([]),
      report: mkReport([]),
      standards: [wcag22],
      enabled: new Set(["wcag22"]),
      attestations: [mkAttestation("wcag22:4.1.2")],
      rulesForCriterion: (id) =>
        id === "wcag22:4.1.2"
          ? ["aria/role-invalid", "aria/required-attrs", "semantics/button-name"]
          : [],
      generatedAt: FIXED_TIMESTAMP,
    });
    expect(ledger.entries[0]?.status).toBe("pass");
  });

  it("marks a criterion as partial when attested ruleIds are a proper subset of satisfying rules", () => {
    // Worked example: 13 rules satisfy wcag22:4.1.2; agent attests only
    // one. The criterion is partially covered — not blocking on fail, but
    // not a clean pass either.
    const wcag22 = mkStandard("wcag22", [{ localId: "4.1.2", automatable: "full" }]);
    const rules = ["aria/role-invalid", "aria/required-attrs", "semantics/button-name"];
    const ledger = buildEvidenceLedger({
      result: mkResult([]),
      report: mkReport([]),
      standards: [wcag22],
      enabled: new Set(["wcag22"]),
      attestations: [mkAttestation("wcag22:4.1.2", { ruleIds: ["semantics/button-name"] })],
      rulesForCriterion: (id) => (id === "wcag22:4.1.2" ? rules : []),
      generatedAt: FIXED_TIMESTAMP,
    });
    expect(ledger.entries[0]?.status).toBe("partial");
  });

  it("promotes partial to pass once the attested ruleIds union covers every satisfying rule", () => {
    const wcag22 = mkStandard("wcag22", [{ localId: "4.1.2", automatable: "full" }]);
    const rules = ["aria/role-invalid", "aria/required-attrs", "semantics/button-name"];
    const ledger = buildEvidenceLedger({
      result: mkResult([]),
      report: mkReport([]),
      standards: [wcag22],
      enabled: new Set(["wcag22"]),
      attestations: [
        mkAttestation("wcag22:4.1.2", {
          by: "first",
          ruleIds: ["aria/role-invalid", "aria/required-attrs"],
        }),
        mkAttestation("wcag22:4.1.2", {
          by: "second",
          ruleIds: ["semantics/button-name"],
        }),
      ],
      rulesForCriterion: (id) => (id === "wcag22:4.1.2" ? rules : []),
      generatedAt: FIXED_TIMESTAMP,
    });
    expect(ledger.entries[0]?.status).toBe("pass");
  });

  it("rule-level attested fail dominates criterion-wide attested pass — fail wins", () => {
    // Conflict resolution rule from ADR 0013: fail is load-bearing, even
    // when a broader pass-attestation is also present.
    const wcag22 = mkStandard("wcag22", [{ localId: "4.1.2", automatable: "full" }]);
    const ledger = buildEvidenceLedger({
      result: mkResult([]),
      report: mkReport([]),
      standards: [wcag22],
      enabled: new Set(["wcag22"]),
      attestations: [
        mkAttestation("wcag22:4.1.2", { by: "reviewer", verdict: "pass" }),
        mkAttestation("wcag22:4.1.2", {
          by: "axe-runtime",
          verdict: "fail",
          ruleIds: ["aria/required-attrs"],
          reason: "axe-core flagged missing aria-required on one form",
        }),
      ],
      rulesForCriterion: (id) =>
        id === "wcag22:4.1.2" ? ["aria/role-invalid", "aria/required-attrs"] : [],
      generatedAt: FIXED_TIMESTAMP,
    });
    expect(ledger.entries[0]?.status).toBe("fail");
  });

  it("propagates attestation ruleIds onto the attested EvidenceSource", () => {
    const wcag22 = mkStandard("wcag22", [{ localId: "4.1.2", automatable: "full" }]);
    const ledger = buildEvidenceLedger({
      result: mkResult([]),
      report: mkReport([]),
      standards: [wcag22],
      enabled: new Set(["wcag22"]),
      attestations: [mkAttestation("wcag22:4.1.2", { ruleIds: ["aria/required-attrs"] })],
      rulesForCriterion: () => [],
      generatedAt: FIXED_TIMESTAMP,
    });
    const attested = ledger.entries[0]?.sources[0];
    expect(attested?.kind).toBe("attested");
    if (attested?.kind === "attested") {
      expect(attested.ruleIds).toEqual(["aria/required-attrs"]);
    }
  });

  it("sorts attested sources per criterion by (attestedAt, by, reason)", () => {
    const wcag22 = mkStandard("wcag22", [{ localId: "2.4.5", automatable: "manual" }]);
    const ledger = buildEvidenceLedger({
      result: mkResult([]),
      report: mkReport([]),
      standards: [wcag22],
      enabled: new Set(["wcag22"]),
      attestations: [
        mkAttestation("wcag22:2.4.5", {
          attestedAt: "2026-04-18T12:00:00.000Z",
          by: "second",
        }),
        mkAttestation("wcag22:2.4.5", {
          attestedAt: "2026-04-18T06:00:00.000Z",
          by: "first",
        }),
      ],
      generatedAt: FIXED_TIMESTAMP,
    });
    const byValues = ledger.entries[0]?.sources
      .filter(
        (s: EvidenceSource): s is Extract<EvidenceSource, { kind: "attested" }> =>
          s.kind === "attested",
      )
      .map((s) => s.by);
    expect(byValues).toEqual(["first", "second"]);
  });
});
