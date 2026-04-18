/**
 * Unit tests for buildRuleCoverageDerivative — the top-level
 * `ruleCoverage.{confidentlyClean, lowConfidenceClean}` split on scan
 * responses.
 *
 * Shape invariants under test:
 *   - Split is honest: high-confidence 0-findings rules land in
 *     `confidentlyClean`; low-confidence 0-findings rules land in
 *     `lowConfidenceClean`.
 *   - A rule that produced violations is absent from both buckets
 *     (it's "already flagged"; the derivative is about the clean tail).
 *   - Empty-on-both-sides returns null so the caller can omit the
 *     field entirely — the CLAUDE.md §1 "Ambiguous field shapes are
 *     dishonest" contract.
 */

import { describe, expect, it } from "bun:test";
import { buildRuleCoverageDerivative } from "../../../src/mcp/rule-coverage-derivative.ts";
import type { PerRuleCoverage, Violation } from "../../../src/types/violation.ts";

function highRow(ruleId: string, eligible = 3): PerRuleCoverage {
  return { ruleId, filesEvaluated: eligible, filesEligible: eligible, coverageConfidence: "high" };
}

function lowRow(ruleId: string): PerRuleCoverage {
  return {
    ruleId,
    filesEvaluated: 0,
    filesEligible: 0,
    coverageConfidence: "low",
    reason: "no files matching .css were scanned",
    remediation: "add CSS sources to the scan path",
  };
}

function mkViolation(ruleId: string): Violation {
  return {
    ruleId,
    fixClass: "guidance",
    criteria: ["wcag22:1.4.3"],
    severity: "warning",
    location: { filePath: "a.tsx", line: 1, column: 1 },
    message: "test",
    findingId: "test",
    groupKey: "test",
  };
}

describe("buildRuleCoverageDerivative", () => {
  it("splits 0-findings rules by coverageConfidence", () => {
    const per: PerRuleCoverage[] = [
      highRow("media/alt-text-missing"),
      highRow("forms/labels-required"),
      lowRow("contrast/minimum"),
      lowRow("layout/text-spacing"),
    ];
    const result = buildRuleCoverageDerivative(per, []);
    expect(result).not.toBeNull();
    expect(result!.confidentlyClean).toEqual(["forms/labels-required", "media/alt-text-missing"]);
    expect(result!.lowConfidenceClean).toEqual(["contrast/minimum", "layout/text-spacing"]);
  });

  it("excludes rules that produced violations from both buckets", () => {
    const per: PerRuleCoverage[] = [highRow("media/alt-text-missing"), lowRow("contrast/minimum")];
    const violations = [mkViolation("media/alt-text-missing")];
    const result = buildRuleCoverageDerivative(per, violations);
    expect(result!.confidentlyClean).not.toContain("media/alt-text-missing");
    expect(result!.lowConfidenceClean).toEqual(["contrast/minimum"]);
  });

  it("returns null when every row produced findings (no clean tail to split)", () => {
    const per: PerRuleCoverage[] = [highRow("media/alt-text-missing")];
    const violations = [mkViolation("media/alt-text-missing")];
    const result = buildRuleCoverageDerivative(per, violations);
    expect(result).toBeNull();
  });

  it("returns null when the coverage array is empty", () => {
    const result = buildRuleCoverageDerivative([], []);
    expect(result).toBeNull();
  });

  it("surfaces low-confidence-clean even when confidentlyClean is empty", () => {
    const per: PerRuleCoverage[] = [lowRow("contrast/minimum")];
    const result = buildRuleCoverageDerivative(per, []);
    expect(result).not.toBeNull();
    expect(result!.confidentlyClean).toEqual([]);
    expect(result!.lowConfidenceClean).toEqual(["contrast/minimum"]);
  });
});
