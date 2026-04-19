/**
 * Coverage report scoped by a named conformance profile.
 *
 * The `profile` argument on `buildCoverageReport` is additive — when
 * `undefined` every enabled standard at `level` appears in the report
 * (the pre-profile behavior). When supplied the report narrows to the
 * profile's `standards` + `level` tuple so downstream VPAT / coverage
 * surfaces claim against the same scope an agent picked with
 * `--profile`.
 */

import { describe, expect, it } from "bun:test";
import type { ConformanceProfile } from "../../../src/config/profiles.ts";
import { buildCoverageReport } from "../../../src/reports/coverage.ts";
import type { Criterion, Standard } from "../../../src/types/standard.ts";
import type { ScanResult } from "../../../src/types/violation.ts";

function mkCriterion(id: string, level: Criterion["level"] = "A"): Criterion {
  const [standardId, localId] = id.split(":") as [string, string];
  return {
    id,
    standardId,
    localId,
    title: localId,
    level,
    description: "",
    url: `https://example.test/${standardId}/${localId}`,
    automatable: "full",
    equivalentTo: [],
  };
}

function mkStandard(id: string, criteria: readonly Criterion[]): Standard {
  return {
    id,
    name: id.toUpperCase(),
    version: "x",
    publisher: "test",
    url: `https://example.test/${id}`,
    levels: ["A", "AA", "AAA"],
    criteria,
  };
}

function mkResult(enabled: readonly string[]): ScanResult {
  return {
    violations: [],
    filesScanned: 0,
    durationMs: 0,
    enabledStandards: enabled,
    isTTY: false,
  };
}

const WCAG22 = mkStandard("wcag22", [
  mkCriterion("wcag22:1.4.3", "AA"),
  mkCriterion("wcag22:1.4.6", "AAA"),
]);
const WCAG21 = mkStandard("wcag21", [mkCriterion("wcag21:1.4.3", "AA")]);
const SECTION508 = mkStandard("section508", [mkCriterion("section508:1194.22.c", "A")]);
const EN301549 = mkStandard("en301549", [mkCriterion("en301549:9.1.4.3", "AA")]);
const LOADED = [WCAG22, WCAG21, SECTION508, EN301549];

describe("buildCoverageReport: profile filtering", () => {
  it("narrows to profile.standards when supplied", () => {
    const profile: ConformanceProfile = {
      name: "wcag22-aa",
      standards: ["wcag22"],
      level: "AA",
      description: "",
    };
    const report = buildCoverageReport(
      mkResult(["wcag22", "wcag21", "section508", "en301549"]),
      LOADED,
      "AAA",
      profile,
    );
    expect(report.map((r) => r.standardId)).toEqual(["wcag22"]);
  });

  it("profile.level overrides the level argument (AA profile drops AAA criteria)", () => {
    const profile: ConformanceProfile = {
      name: "wcag22-aa",
      standards: ["wcag22"],
      level: "AA",
      description: "",
    };
    const report = buildCoverageReport(mkResult(["wcag22"]), LOADED, "AAA", profile);
    const entry = report[0];
    expect(entry).toBeDefined();
    expect(entry?.standardId).toBe("wcag22");
    // wcag22:1.4.6 is AAA and must be excluded under a wcag22-aa profile.
    const criterionIds = entry?.criteria.map((c) => c.criterionId);
    expect(criterionIds).toEqual(["wcag22:1.4.3"]);
  });

  it("level-less profile (section508) falls through to the level argument", () => {
    const profile: ConformanceProfile = {
      name: "section508",
      standards: ["section508"],
      description: "",
    };
    const report = buildCoverageReport(mkResult(["section508"]), LOADED, "AA", profile);
    expect(report.map((r) => r.standardId)).toEqual(["section508"]);
    expect(report[0]?.total).toBe(1);
  });

  it("no profile = unchanged behavior (every enabled standard appears)", () => {
    const report = buildCoverageReport(
      mkResult(["wcag22", "wcag21", "section508", "en301549"]),
      LOADED,
      "AAA",
    );
    expect(report.map((r) => r.standardId)).toEqual(["wcag22", "wcag21", "section508", "en301549"]);
  });

  it("profile standard not present in loadedStandards yields an empty report", () => {
    const profile: ConformanceProfile = {
      name: "missing",
      standards: ["missing-standard"],
      level: "AA",
      description: "",
    };
    const report = buildCoverageReport(mkResult(["wcag22"]), LOADED, "AA", profile);
    expect(report).toEqual([]);
  });
});
