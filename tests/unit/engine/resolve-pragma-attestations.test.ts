/**
 * Unit tests for resolvePragmaAttestations — the pragma-to-attestation
 * bridge that turns reason-bearing `ra11y-disable` comments into
 * AttestationRecords.
 *
 * Shapes under test:
 *   - A pragma without a reason produces no attestation (silence
 *     without assertion).
 *   - A pragma with a reason and a rule-ID token fans out to every
 *     criterion in the rule's `satisfies`, expanded through the
 *     criteria registry's equivalence closure.
 *   - A pragma with a reason and a criterion-ID token resolves the
 *     token directly and fans out through equivalence.
 *   - Wildcard tokens (`"*"`) produce no attestation — no concrete
 *     criterion to speak to.
 *   - Unknown rule-ID tokens are silently dropped.
 *   - Criterion IDs outside the enabled standards are dropped.
 *   - Every produced record carries scope: "line" plus the pragma's
 *     file+line location.
 *   - The `by` default is `"source-pragma"` and can be overridden.
 *   - Duplicates within a single declaration are coalesced (one
 *     record per unique criterionId).
 */

import { describe, expect, it } from "bun:test";
import type { SuppressionDeclaration } from "../../../src/config/inline-disables.ts";
import { CriteriaRegistry } from "../../../src/engine/registry/criteria.ts";
import {
  type FileDeclarations,
  resolvePragmaAttestations,
} from "../../../src/engine/resolve-pragma-attestations.ts";
import type { Rule } from "../../../src/types/rule.ts";
import type { Standard } from "../../../src/types/standard.ts";

const FIXED_TIMESTAMP = "2026-04-18T00:00:00.000Z";

function mkStandard(id: string, criteria: readonly MkCriterion[]): Standard {
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
      level: "A",
      description: "",
      url: `https://example.test/${id}/${c.localId}`,
      automatable: c.automatable ?? "full",
      ...(c.equivalentTo ? { equivalentTo: c.equivalentTo } : {}),
    })),
  };
}

interface MkCriterion {
  readonly localId: string;
  readonly automatable?: "full" | "partial" | "manual";
  readonly equivalentTo?: readonly string[];
}

function mkRule(id: string, satisfies: readonly string[]): Rule {
  return {
    id,
    satisfies,
    severity: "warning",
    scope: "node",
    fixClass: "guidance",
    docs: {
      description: "test",
      rationale: "test",
      goodExample: "",
      badExample: "",
      references: [],
    },
  };
}

function mkDecl(overrides: Partial<SuppressionDeclaration> = {}): SuppressionDeclaration {
  return {
    kind: "disable-next-line",
    line: 42,
    ruleIds: ["keyboard/handler-missing"],
    reason: "verified by manual keyboard test",
    tag: "ra11y-disable",
    ...overrides,
  };
}

function mkFile(
  declarations: readonly SuppressionDeclaration[],
  filePath = "src/f.tsx",
): FileDeclarations {
  return { filePath, declarations };
}

function mkCriteria(standards: readonly Standard[]): CriteriaRegistry {
  const reg = new CriteriaRegistry();
  reg.rebuild(standards);
  return reg;
}

describe("resolvePragmaAttestations", () => {
  it("produces no attestation for a pragma without a reason", () => {
    const wcag22 = mkStandard("wcag22", [{ localId: "2.1.1" }]);
    const rule = mkRule("keyboard/handler-missing", ["wcag22:2.1.1"]);
    const reasonless: SuppressionDeclaration = {
      kind: "disable-next-line",
      line: 42,
      ruleIds: ["keyboard/handler-missing"],
      tag: "ra11y-disable",
    };
    const records = resolvePragmaAttestations({
      files: [mkFile([reasonless])],
      rules: [rule],
      criteria: mkCriteria([wcag22]),
      enabled: new Set(["wcag22"]),
      attestedAt: FIXED_TIMESTAMP,
    });
    expect(records).toEqual([]);
  });

  it("fans out a rule-ID pragma through the rule's satisfies list", () => {
    const wcag22 = mkStandard("wcag22", [{ localId: "2.1.1" }, { localId: "2.1.3" }]);
    const rule = mkRule("keyboard/handler-missing", ["wcag22:2.1.1", "wcag22:2.1.3"]);
    const records = resolvePragmaAttestations({
      files: [mkFile([mkDecl()])],
      rules: [rule],
      criteria: mkCriteria([wcag22]),
      enabled: new Set(["wcag22"]),
      attestedAt: FIXED_TIMESTAMP,
    });
    expect(records.map((r) => r.criterionId).sort()).toEqual(["wcag22:2.1.1", "wcag22:2.1.3"]);
    for (const r of records) {
      expect(r.scope).toBe("line");
      expect(r.location).toEqual({ filePath: "src/f.tsx", line: 42, column: 1 });
      expect(r.reason).toBe("verified by manual keyboard test");
      expect(r.by).toBe("source-pragma");
      expect(r.ruleIds).toEqual(["keyboard/handler-missing"]);
    }
  });

  it("preserves rule identity on rule-ID pragmas (ADR 0013)", () => {
    // The single highest-leverage line in ADR 0013: the one seam that
    // already knew which rule the author named no longer drops it. A
    // later coverage check can tell "the author attested rule X" apart
    // from "the author attested the whole criterion."
    const wcag22 = mkStandard("wcag22", [{ localId: "2.1.1" }]);
    const rule = mkRule("keyboard/handler-missing", ["wcag22:2.1.1"]);
    const records = resolvePragmaAttestations({
      files: [mkFile([mkDecl({ ruleIds: ["keyboard/handler-missing"] })])],
      rules: [rule],
      criteria: mkCriteria([wcag22]),
      enabled: new Set(["wcag22"]),
      attestedAt: FIXED_TIMESTAMP,
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.ruleIds).toEqual(["keyboard/handler-missing"]);
  });

  it("emits no ruleIds for a criterion-ID pragma (criterion-wide claim)", () => {
    const wcag22 = mkStandard("wcag22", [{ localId: "2.1.1" }]);
    const records = resolvePragmaAttestations({
      files: [mkFile([mkDecl({ ruleIds: ["wcag22:2.1.1"] })])],
      rules: [],
      criteria: mkCriteria([wcag22]),
      enabled: new Set(["wcag22"]),
      attestedAt: FIXED_TIMESTAMP,
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.ruleIds).toBeUndefined();
  });

  it("fans out a criterion-ID token through equivalence closure", () => {
    const wcag22 = mkStandard("wcag22", [{ localId: "1.4.3" }]);
    const s508 = mkStandard("section508", [{ localId: "7.1.4.3", equivalentTo: ["wcag22:1.4.3"] }]);
    const records = resolvePragmaAttestations({
      files: [mkFile([mkDecl({ ruleIds: ["wcag22:1.4.3"] })])],
      rules: [],
      criteria: mkCriteria([wcag22, s508]),
      enabled: new Set(["wcag22", "section508"]),
      attestedAt: FIXED_TIMESTAMP,
    });
    expect(records.map((r) => r.criterionId).sort()).toEqual([
      "section508:7.1.4.3",
      "wcag22:1.4.3",
    ]);
  });

  it("skips wildcard tokens", () => {
    const wcag22 = mkStandard("wcag22", [{ localId: "2.1.1" }]);
    const records = resolvePragmaAttestations({
      files: [mkFile([mkDecl({ ruleIds: ["*"] })])],
      rules: [],
      criteria: mkCriteria([wcag22]),
      enabled: new Set(["wcag22"]),
      attestedAt: FIXED_TIMESTAMP,
    });
    expect(records).toEqual([]);
  });

  it("silently drops unknown rule-ID tokens", () => {
    const wcag22 = mkStandard("wcag22", [{ localId: "2.1.1" }]);
    const records = resolvePragmaAttestations({
      files: [mkFile([mkDecl({ ruleIds: ["nonexistent/rule"] })])],
      rules: [],
      criteria: mkCriteria([wcag22]),
      enabled: new Set(["wcag22"]),
      attestedAt: FIXED_TIMESTAMP,
    });
    expect(records).toEqual([]);
  });

  it("drops criterion IDs outside enabled standards", () => {
    const wcag22 = mkStandard("wcag22", [{ localId: "1.4.3" }]);
    const s508 = mkStandard("section508", [{ localId: "7.1.4.3" }]);
    const records = resolvePragmaAttestations({
      files: [mkFile([mkDecl({ ruleIds: ["section508:7.1.4.3"] })])],
      rules: [],
      criteria: mkCriteria([wcag22, s508]),
      enabled: new Set(["wcag22"]),
      attestedAt: FIXED_TIMESTAMP,
    });
    expect(records).toEqual([]);
  });

  it("honours a custom `by` override", () => {
    const wcag22 = mkStandard("wcag22", [{ localId: "2.1.1" }]);
    const rule = mkRule("keyboard/handler-missing", ["wcag22:2.1.1"]);
    const records = resolvePragmaAttestations({
      files: [mkFile([mkDecl()])],
      rules: [rule],
      criteria: mkCriteria([wcag22]),
      enabled: new Set(["wcag22"]),
      attestedAt: FIXED_TIMESTAMP,
      by: "ci-bot",
    });
    expect(records[0]?.by).toBe("ci-bot");
  });

  it("emits one record per (criterion, rule) pair when two rules target the same criterion", () => {
    // Two rules satisfy wcag22:2.1.1. A pragma that names both emits
    // two attestations — each carrying the rule ID it was derived from.
    // Criterion identity is the same; rule identity differs. Pre-ADR-0013
    // this coalesced to a single record because rule identity was
    // dropped at the boundary.
    const wcag22 = mkStandard("wcag22", [{ localId: "2.1.1" }]);
    const ruleA = mkRule("keyboard/handler-missing", ["wcag22:2.1.1"]);
    const ruleB = mkRule("keyboard/no-noninteractive-tabindex", ["wcag22:2.1.1"]);
    const records = resolvePragmaAttestations({
      files: [
        mkFile([
          mkDecl({ ruleIds: ["keyboard/handler-missing", "keyboard/no-noninteractive-tabindex"] }),
        ]),
      ],
      rules: [ruleA, ruleB],
      criteria: mkCriteria([wcag22]),
      enabled: new Set(["wcag22"]),
      attestedAt: FIXED_TIMESTAMP,
    });
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.criterionId)).toEqual(["wcag22:2.1.1", "wcag22:2.1.1"]);
    expect(records.map((r) => r.ruleIds?.[0]).sort()).toEqual([
      "keyboard/handler-missing",
      "keyboard/no-noninteractive-tabindex",
    ]);
  });

  it("coalesces repeated rule-ID tokens within one declaration", () => {
    // Same (criterion, rule) pair appearing twice collapses to one
    // record — the dedupe key is the pair, not the criterion alone.
    const wcag22 = mkStandard("wcag22", [{ localId: "2.1.1" }]);
    const rule = mkRule("keyboard/handler-missing", ["wcag22:2.1.1"]);
    const records = resolvePragmaAttestations({
      files: [
        mkFile([mkDecl({ ruleIds: ["keyboard/handler-missing", "keyboard/handler-missing"] })]),
      ],
      rules: [rule],
      criteria: mkCriteria([wcag22]),
      enabled: new Set(["wcag22"]),
      attestedAt: FIXED_TIMESTAMP,
    });
    expect(records).toHaveLength(1);
  });
});
