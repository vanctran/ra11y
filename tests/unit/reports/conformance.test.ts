/**
 * Unit tests for buildConformanceStatement — the refuse-or-emit gate
 * that turns an evidence ledger + profile into a conformance claim.
 *
 * Shapes under test:
 *   - Every in-scope criterion must have a non-candidate source with
 *     status pass or n/a for `conformant: true`.
 *   - Static findings produce a blocker with reason "failing".
 *   - Manual criteria with only candidate sources produce a blocker
 *     with reason "candidate-only".
 *   - Automatable criteria with no sources (pass-by-default) produce
 *     a blocker with reason "no-evidence".
 *   - n/a-by-attestation and pass-by-attestation clear blockers.
 *   - Profile level gates scope — wcag22 AA excludes AAA criteria.
 *   - "base" level includes every criterion regardless of level.
 *   - summary tallies reflect the ledger entries under scope.
 *   - renderConformanceMarkdown produces a minimal status line for
 *     both conformant and non-conformant cases.
 */

import { describe, expect, it } from "bun:test";
import { buildEvidenceLedger } from "../../../src/engine/evidence-ledger.ts";
import {
  buildConformanceStatement,
  type ConformanceProfile,
  renderConformanceMarkdown,
} from "../../../src/reports/conformance.ts";
import type { AttestationRecord, EvidenceLedger } from "../../../src/types/evidence.ts";
import type { ReviewCandidate } from "../../../src/types/review.ts";
import type { Standard } from "../../../src/types/standard.ts";
import type { Violation } from "../../../src/types/violation.ts";

const FIXED_TIMESTAMP = "2026-04-18T00:00:00.000Z";
const AA_PROFILE: ConformanceProfile = { standardId: "wcag22", level: "AA" };

function mkStandard(
  criteria: readonly {
    localId: string;
    level?: string;
    automatable?: "full" | "partial" | "manual";
  }[],
): Standard {
  return {
    id: "wcag22",
    name: "WCAG22",
    version: "2.2",
    publisher: "W3C",
    url: "https://www.w3.org/TR/WCAG22/",
    levels: ["A", "AA", "AAA"],
    criteria: criteria.map((c) => ({
      id: `wcag22:${c.localId}`,
      standardId: "wcag22",
      localId: c.localId,
      title: c.localId,
      level: c.level ?? "A",
      description: "",
      url: `https://example.test/wcag22/${c.localId}`,
      automatable: c.automatable ?? "full",
    })),
  };
}

function mkViolation(criterionId: string, findingId = "aaaa11112222"): Violation {
  return {
    ruleId: "test/rule",
    fixClass: "guidance",
    criteria: [criterionId],
    severity: "warning",
    location: { filePath: "f.tsx", line: 1, column: 1 },
    message: "x",
    findingId,
    groupKey: "gk0000000000",
  };
}

function mkCandidate(criterionId: string): ReviewCandidate {
  return {
    criterionId,
    location: { filePath: "f.tsx", line: 1, column: 1 },
    reason: "needs review",
    confidence: "medium",
  };
}

function mkAttestation(
  criterionId: string,
  verdict?: "pass" | "fail" | "n/a",
  ruleIds?: readonly string[],
): AttestationRecord {
  return {
    criterionId,
    by: "tester",
    reason: "confirmed",
    attestedAt: FIXED_TIMESTAMP,
    ...(verdict !== undefined && { verdict }),
    ...(ruleIds !== undefined && { ruleIds }),
  };
}

function buildLedger(
  standard: Standard,
  opts: {
    readonly violations?: readonly Violation[];
    readonly candidates?: readonly ReviewCandidate[];
    readonly attestations?: readonly AttestationRecord[];
    readonly rulesForCriterion?: (criterionId: string) => readonly string[];
  } = {},
): EvidenceLedger {
  return buildEvidenceLedger({
    result: {
      violations: opts.violations ?? [],
      filesScanned: 1,
      durationMs: 0,
      enabledStandards: [standard.id],
      isTTY: false,
    },
    report: {
      coverage: [],
      manualReviewNeeded: [],
      ...(opts.candidates && opts.candidates.length > 0 ? { candidates: opts.candidates } : {}),
    },
    standards: [standard],
    enabled: new Set([standard.id]),
    ...(opts.attestations ? { attestations: opts.attestations } : {}),
    ...(opts.rulesForCriterion ? { rulesForCriterion: opts.rulesForCriterion } : {}),
    generatedAt: FIXED_TIMESTAMP,
  });
}

describe("buildConformanceStatement", () => {
  it("refuses a non-manual criterion with no sources — no-evidence blocker", () => {
    const standard = mkStandard([{ localId: "1.4.3", level: "AA", automatable: "full" }]);
    const statement = buildConformanceStatement({
      ledger: buildLedger(standard),
      profile: AA_PROFILE,
      standards: [standard],
    });
    expect(statement.conformant).toBe(false);
    expect(statement.blockers).toHaveLength(1);
    expect(statement.blockers[0]).toMatchObject({
      criterionId: "wcag22:1.4.3",
      status: "pass",
      reason: "no-evidence",
    });
  });

  it("emits conformant when every criterion has an attestation", () => {
    const standard = mkStandard([{ localId: "1.4.3", level: "AA", automatable: "full" }]);
    const statement = buildConformanceStatement({
      ledger: buildLedger(standard, { attestations: [mkAttestation("wcag22:1.4.3")] }),
      profile: AA_PROFILE,
      standards: [standard],
    });
    expect(statement.conformant).toBe(true);
    expect(statement.blockers).toEqual([]);
    expect(statement.summary.pass).toBe(1);
  });

  it("blocks a failing criterion with reason failing", () => {
    const standard = mkStandard([{ localId: "1.4.3", level: "AA", automatable: "full" }]);
    const statement = buildConformanceStatement({
      ledger: buildLedger(standard, { violations: [mkViolation("wcag22:1.4.3")] }),
      profile: AA_PROFILE,
      standards: [standard],
    });
    expect(statement.conformant).toBe(false);
    expect(statement.blockers[0]?.reason).toBe("failing");
    expect(statement.blockers[0]?.staticSources).toBe(1);
  });

  it("blocks a manual criterion backed only by candidates", () => {
    const standard = mkStandard([{ localId: "2.4.5", level: "AA", automatable: "manual" }]);
    const statement = buildConformanceStatement({
      ledger: buildLedger(standard, { candidates: [mkCandidate("wcag22:2.4.5")] }),
      profile: AA_PROFILE,
      standards: [standard],
    });
    expect(statement.conformant).toBe(false);
    expect(statement.blockers[0]).toMatchObject({
      criterionId: "wcag22:2.4.5",
      status: "unknown",
      reason: "candidate-only",
      candidateSources: 1,
    });
  });

  it("n/a attestation clears the blocker and counts in summary.na", () => {
    const standard = mkStandard([{ localId: "1.2.1", level: "A", automatable: "manual" }]);
    const statement = buildConformanceStatement({
      ledger: buildLedger(standard, { attestations: [mkAttestation("wcag22:1.2.1", "n/a")] }),
      profile: AA_PROFILE,
      standards: [standard],
    });
    expect(statement.conformant).toBe(true);
    expect(statement.summary.na).toBe(1);
  });

  it("AA profile excludes AAA criteria from scope", () => {
    const standard = mkStandard([
      { localId: "1.4.3", level: "AA", automatable: "full" },
      { localId: "1.4.6", level: "AAA", automatable: "full" },
    ]);
    const statement = buildConformanceStatement({
      ledger: buildLedger(standard, { attestations: [mkAttestation("wcag22:1.4.3")] }),
      profile: AA_PROFILE,
      standards: [standard],
    });
    // Only wcag22:1.4.3 is in scope.
    expect(statement.criteriaInScope).toBe(1);
    expect(statement.conformant).toBe(true);
  });

  it("level=base includes every criterion regardless of level", () => {
    const standard = mkStandard([
      { localId: "1.4.3", level: "AA", automatable: "full" },
      { localId: "1.4.6", level: "AAA", automatable: "full" },
    ]);
    const statement = buildConformanceStatement({
      ledger: buildLedger(standard, {
        attestations: [mkAttestation("wcag22:1.4.3"), mkAttestation("wcag22:1.4.6")],
      }),
      profile: { standardId: "wcag22", level: "base" },
      standards: [standard],
    });
    expect(statement.criteriaInScope).toBe(2);
    expect(statement.conformant).toBe(true);
  });

  it("throws when the profile's standard is not loaded", () => {
    const standard = mkStandard([{ localId: "1.4.3", level: "AA" }]);
    expect(() =>
      buildConformanceStatement({
        ledger: buildLedger(standard),
        profile: { standardId: "nonexistent", level: "AA" },
        standards: [standard],
      }),
    ).toThrow(/is not loaded/);
  });
});

describe("buildConformanceStatement: rule-scoped attestations (ADR 0013)", () => {
  const RULES = ["aria/role-invalid", "aria/required-attrs", "semantics/button-name"];
  const rulesForCriterion = (id: string): readonly string[] => (id === "wcag22:4.1.2" ? RULES : []);

  it("routes a partial-coverage attestation to a partially-attested blocker", () => {
    const standard = mkStandard([{ localId: "4.1.2", level: "A", automatable: "full" }]);
    const statement = buildConformanceStatement({
      ledger: buildLedger(standard, {
        attestations: [mkAttestation("wcag22:4.1.2", "pass", ["aria/role-invalid"])],
        rulesForCriterion,
      }),
      profile: AA_PROFILE,
      standards: [standard],
      rulesForCriterion,
    });
    expect(statement.conformant).toBe(false);
    expect(statement.blockers).toHaveLength(1);
    expect(statement.blockers[0]).toMatchObject({
      criterionId: "wcag22:4.1.2",
      status: "partial",
      reason: "partially-attested",
    });
    expect(statement.blockers[0]?.missingRuleIds).toEqual([
      "aria/required-attrs",
      "semantics/button-name",
    ]);
    expect(statement.summary.partial).toBe(1);
  });

  it("clears a partial blocker when remaining ruleIds get attested", () => {
    const standard = mkStandard([{ localId: "4.1.2", level: "A", automatable: "full" }]);
    const statement = buildConformanceStatement({
      ledger: buildLedger(standard, {
        attestations: [
          mkAttestation("wcag22:4.1.2", "pass", ["aria/role-invalid", "aria/required-attrs"]),
          mkAttestation("wcag22:4.1.2", "pass", ["semantics/button-name"]),
        ],
        rulesForCriterion,
      }),
      profile: AA_PROFILE,
      standards: [standard],
      rulesForCriterion,
    });
    expect(statement.conformant).toBe(true);
    expect(statement.blockers).toEqual([]);
  });

  it("a criterion-wide attestation fans out to cover every satisfying rule", () => {
    const standard = mkStandard([{ localId: "4.1.2", level: "A", automatable: "full" }]);
    const statement = buildConformanceStatement({
      ledger: buildLedger(standard, {
        attestations: [mkAttestation("wcag22:4.1.2", "pass")],
        rulesForCriterion,
      }),
      profile: AA_PROFILE,
      standards: [standard],
      rulesForCriterion,
    });
    expect(statement.conformant).toBe(true);
  });

  it("omits missingRuleIds when rulesForCriterion is not supplied", () => {
    const standard = mkStandard([{ localId: "4.1.2", level: "A", automatable: "full" }]);
    const statement = buildConformanceStatement({
      ledger: buildLedger(standard, {
        attestations: [mkAttestation("wcag22:4.1.2", "pass", ["aria/role-invalid"])],
        rulesForCriterion,
      }),
      profile: AA_PROFILE,
      standards: [standard],
    });
    // Partial status is still derived by the ledger, but the builder
    // has no rule set to compute missingRuleIds from.
    expect(statement.blockers[0]?.reason).toBe("partially-attested");
    expect(statement.blockers[0]?.missingRuleIds).toBeUndefined();
  });
});

describe("renderConformanceMarkdown", () => {
  it("emits a CONFORMANT status line when conformant", () => {
    const standard = mkStandard([{ localId: "1.4.3", level: "AA" }]);
    const statement = buildConformanceStatement({
      ledger: buildLedger(standard, { attestations: [mkAttestation("wcag22:1.4.3")] }),
      profile: AA_PROFILE,
      standards: [standard],
    });
    const md = renderConformanceMarkdown(statement);
    expect(md).toContain("**CONFORMANT**");
    expect(md).not.toContain("## Blockers");
  });

  it("emits a blocker table when not conformant", () => {
    const standard = mkStandard([{ localId: "1.4.3", level: "AA" }]);
    const statement = buildConformanceStatement({
      ledger: buildLedger(standard, { violations: [mkViolation("wcag22:1.4.3")] }),
      profile: AA_PROFILE,
      standards: [standard],
    });
    const md = renderConformanceMarkdown(statement);
    expect(md).toContain("**NOT CONFORMANT**");
    expect(md).toContain("## Blockers");
    expect(md).toContain("wcag22:1.4.3");
    expect(md).toContain("failing");
  });
});
