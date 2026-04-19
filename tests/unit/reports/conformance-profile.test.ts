/**
 * Conformance statement scoped by a named conformance profile.
 *
 * The `scope` input on `buildConformanceStatement` is additive — when
 * `undefined` every criterion under `inputs.profile.standardId` up to
 * `inputs.profile.level` is in scope (the pre-profile behavior). When
 * supplied, the builder filters the in-scope criterion set (and therefore
 * the blockers list + summary tallies) to the profile's `standards` +
 * `level?` tuple, and overrides the output `profile.level` to match the
 * scope's level when set. Level-less profiles (Section 508, EN 301 549)
 * fall through to the caller-supplied `profile.level`.
 */

import { describe, expect, it } from "bun:test";
import type { ConformanceProfile as ConfigProfile } from "../../../src/config/profiles.ts";
import { buildEvidenceLedger } from "../../../src/engine/evidence-ledger.ts";
import { buildConformanceStatement } from "../../../src/reports/conformance.ts";
import type { AttestationRecord, EvidenceLedger } from "../../../src/types/evidence.ts";
import type { Standard } from "../../../src/types/standard.ts";
import type { Violation } from "../../../src/types/violation.ts";

const FIXED_TIMESTAMP = "2026-04-18T00:00:00.000Z";

function mkStandard(
  id: string,
  criteria: readonly {
    localId: string;
    level?: string;
    automatable?: "full" | "partial" | "manual";
  }[],
): Standard {
  return {
    id,
    name: id.toUpperCase(),
    version: "x",
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

function buildLedger(
  standards: readonly Standard[],
  opts: {
    readonly violations?: readonly Violation[];
    readonly attestations?: readonly AttestationRecord[];
  } = {},
): EvidenceLedger {
  const enabled = new Set(standards.map((s) => s.id));
  return buildEvidenceLedger({
    result: {
      violations: opts.violations ?? [],
      filesScanned: 1,
      durationMs: 0,
      enabledStandards: [...enabled],
      isTTY: false,
    },
    report: { coverage: [], manualReviewNeeded: [] },
    standards,
    enabled,
    ...(opts.attestations ? { attestations: opts.attestations } : {}),
    generatedAt: FIXED_TIMESTAMP,
  });
}

const WCAG22 = mkStandard("wcag22", [
  { localId: "1.4.3", level: "AA" },
  { localId: "1.4.6", level: "AAA" },
]);
const WCAG21 = mkStandard("wcag21", [{ localId: "1.4.3", level: "AA" }]);
const SECTION508 = mkStandard("section508", [{ localId: "1194.22.c", level: "A" }]);

describe("buildConformanceStatement: profile scope filtering", () => {
  it("profile: wcag22-aa narrows blockers to wcag22 criteria only when scanning wcag22 + wcag21", () => {
    const scope: ConfigProfile = {
      name: "wcag22-aa",
      standards: ["wcag22"],
      level: "AA",
      description: "",
    };
    // Findings exist against both wcag22 and wcag21 — a profile pinned to
    // wcag22 must drop the wcag21 criterion from the in-scope set, so the
    // claim only stands on wcag22's evidence.
    const ledger = buildLedger([WCAG22, WCAG21], {
      violations: [mkViolation("wcag22:1.4.3"), mkViolation("wcag21:1.4.3", "bbbb22223333")],
    });
    const statement = buildConformanceStatement({
      ledger,
      profile: { standardId: "wcag22", level: "AA" },
      standards: [WCAG22, WCAG21],
      scope,
    });
    expect(statement.blockers).toHaveLength(1);
    expect(statement.blockers[0]?.criterionId).toBe("wcag22:1.4.3");
    expect(statement.criteriaInScope).toBe(1);
  });

  it("profile: wcag21-aa narrows to wcag21 only when building a wcag21 claim", () => {
    const scope: ConfigProfile = {
      name: "wcag21-aa",
      standards: ["wcag21"],
      level: "AA",
      description: "",
    };
    const ledger = buildLedger([WCAG22, WCAG21], {
      violations: [mkViolation("wcag22:1.4.3"), mkViolation("wcag21:1.4.3", "bbbb22223333")],
    });
    const statement = buildConformanceStatement({
      ledger,
      profile: { standardId: "wcag21", level: "AA" },
      standards: [WCAG22, WCAG21],
      scope,
    });
    expect(statement.blockers).toHaveLength(1);
    expect(statement.blockers[0]?.criterionId).toBe("wcag21:1.4.3");
    expect(statement.criteriaInScope).toBe(1);
  });

  it("profile.level=AA drops AAA criteria from scope + blockers + summary", () => {
    const scope: ConfigProfile = {
      name: "wcag22-aa",
      standards: ["wcag22"],
      level: "AA",
      description: "",
    };
    // Both 1.4.3 (AA) and 1.4.6 (AAA) are violated; a wcag22-aa profile
    // must exclude the AAA criterion entirely — not report it as a blocker.
    const ledger = buildLedger([WCAG22], {
      violations: [mkViolation("wcag22:1.4.3"), mkViolation("wcag22:1.4.6", "cccc33334444")],
    });
    const statement = buildConformanceStatement({
      ledger,
      profile: { standardId: "wcag22", level: "AAA" },
      standards: [WCAG22],
      scope,
    });
    expect(statement.criteriaInScope).toBe(1);
    expect(statement.blockers.map((b) => b.criterionId)).toEqual(["wcag22:1.4.3"]);
    // profile.level in the emitted statement is the effective (scope) level,
    // not the caller-supplied AAA — downstream renderers key off this.
    expect(statement.profile.level).toBe("AA");
  });

  it("level-less profile (section508) falls through to profile.level", () => {
    const scope: ConfigProfile = {
      name: "section508",
      standards: ["section508"],
      description: "",
    };
    const ledger = buildLedger([SECTION508], {
      violations: [mkViolation("section508:1194.22.c")],
    });
    const statement = buildConformanceStatement({
      ledger,
      profile: { standardId: "section508", level: "base" },
      standards: [SECTION508],
      scope,
    });
    expect(statement.criteriaInScope).toBe(1);
    expect(statement.blockers.map((b) => b.criterionId)).toEqual(["section508:1194.22.c"]);
    // Effective level stays at the caller-supplied `base` since the
    // profile has no level dimension to override.
    expect(statement.profile.level).toBe("base");
  });

  it("target standard outside scope.standards yields an empty in-scope set (no blockers, no claim)", () => {
    const scope: ConfigProfile = {
      name: "wcag22-aa",
      standards: ["wcag22"],
      level: "AA",
      description: "",
    };
    const ledger = buildLedger([WCAG21], {
      violations: [mkViolation("wcag21:1.4.3")],
    });
    const statement = buildConformanceStatement({
      ledger,
      profile: { standardId: "wcag21", level: "AA" },
      standards: [WCAG21],
      scope,
    });
    expect(statement.criteriaInScope).toBe(0);
    expect(statement.blockers).toEqual([]);
  });

  it("no scope = unchanged behavior (regression-guard)", () => {
    // Two criteria, one violation; the pre-existing behavior is that the
    // AAA criterion stays in scope at profile.level=AAA and the violation
    // produces a single blocker.
    const ledger = buildLedger([WCAG22], {
      violations: [mkViolation("wcag22:1.4.6")],
    });
    const statement = buildConformanceStatement({
      ledger,
      profile: { standardId: "wcag22", level: "AAA" },
      standards: [WCAG22],
    });
    expect(statement.criteriaInScope).toBe(2);
    expect(statement.blockers.map((b) => b.criterionId)).toContain("wcag22:1.4.6");
    expect(statement.profile.level).toBe("AAA");
  });
});
