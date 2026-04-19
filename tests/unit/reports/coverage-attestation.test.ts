import { describe, expect, it } from "bun:test";
import {
  buildCoverageReport,
  mergeAttestationIntoCoverage,
  type PerStandardCoverage,
} from "../../../src/reports/coverage.ts";
import type { AttestationRecord } from "../../../src/types/evidence.ts";
import type { Standard } from "../../../src/types/standard.ts";
import type { ScanResult } from "../../../src/types/violation.ts";
import { withFindingIds } from "../../helpers/make-violation.ts";

/**
 * Minimal standard exercising every static verdict × attestation
 * combination the merge helper needs to cover:
 *   - 1.1.1 — automatable, clean static → static:"pass"
 *   - 1.2.1 — manual
 *   - 1.2.3 — manual
 *   - 1.4.3 — automatable, receives a failing violation → static:"fail"
 */
const STANDARD: Standard = {
  id: "wcag22",
  name: "WCAG 2.2",
  version: "2.2",
  publisher: "W3C",
  url: "https://www.w3.org/TR/WCAG22/",
  levels: ["A", "AA", "AAA"],
  criteria: [
    {
      id: "wcag22:1.1.1",
      standardId: "wcag22",
      localId: "1.1.1",
      title: "Non-text Content",
      level: "A",
      description: "alt text",
      url: "https://www.w3.org/TR/WCAG22/#non-text-content",
      automatable: "full",
      equivalentTo: [],
    },
    {
      id: "wcag22:1.2.1",
      standardId: "wcag22",
      localId: "1.2.1",
      title: "Audio-only and Video-only",
      level: "A",
      description: "media alternative",
      url: "https://www.w3.org/TR/WCAG22/#audio-only-and-video-only-prerecorded",
      automatable: "manual",
      equivalentTo: [],
    },
    {
      id: "wcag22:1.2.3",
      standardId: "wcag22",
      localId: "1.2.3",
      title: "Audio Description or Media Alternative",
      level: "A",
      description: "audio description",
      url: "https://www.w3.org/TR/WCAG22/#audio-description-or-media-alternative-prerecorded",
      automatable: "manual",
      equivalentTo: [],
    },
    {
      id: "wcag22:1.4.3",
      standardId: "wcag22",
      localId: "1.4.3",
      title: "Contrast (Minimum)",
      level: "AA",
      description: "contrast",
      url: "https://www.w3.org/TR/WCAG22/#contrast-minimum",
      automatable: "full",
      equivalentTo: [],
    },
  ],
};

const RESULT: ScanResult = {
  violations: withFindingIds([
    {
      ruleId: "contrast/minimum",
      fixClass: "mechanical",
      criteria: ["wcag22:1.4.3"],
      severity: "error",
      location: { filePath: "src/ui/Card.tsx", line: 12, column: 5 },
      message: "insufficient contrast",
      suggestion: "increase contrast",
    },
  ]),
  filesScanned: 1,
  durationMs: 1,
  enabledStandards: ["wcag22"],
  isTTY: false,
};

function makeAttestation(
  criterionId: string,
  verdict: "pass" | "fail" | "n/a" | undefined,
  overrides: Partial<AttestationRecord> = {},
): AttestationRecord {
  const base: AttestationRecord = {
    criterionId,
    by: "agent",
    reason: "verified in code review",
    attestedAt: "2026-04-10T00:00:00Z",
    ...(verdict === undefined ? {} : { verdict }),
  };
  return { ...base, ...overrides };
}

function findCriterion(
  entry: PerStandardCoverage,
  criterionId: string,
): PerStandardCoverage["criteria"][number] | undefined {
  return entry.criteria.find((c) => c.criterionId === criterionId);
}

describe("buildCoverageReport — per-criterion detail", () => {
  it("populates criteria with static verdicts and no attestation by default", () => {
    const [entry] = buildCoverageReport(RESULT, [STANDARD]);
    expect(entry).toBeDefined();
    if (entry === undefined) throw new Error("coverage missing");

    expect(entry.criteria).toHaveLength(4);
    expect(findCriterion(entry, "wcag22:1.1.1")?.static).toBe("pass");
    expect(findCriterion(entry, "wcag22:1.4.3")?.static).toBe("fail");
    expect(findCriterion(entry, "wcag22:1.2.1")?.static).toBe("manual");
    expect(findCriterion(entry, "wcag22:1.2.3")?.static).toBe("manual");

    for (const c of entry.criteria) expect(c.attested).toBeUndefined();
    expect(entry.coveredManual).toBeUndefined();
    expect(entry.coveredManualCriteria).toBeUndefined();
  });
});

describe("mergeAttestationIntoCoverage", () => {
  it("leaves criteria untouched when no attestations apply", () => {
    const coverage = buildCoverageReport(RESULT, [STANDARD]);
    const merged = mergeAttestationIntoCoverage(coverage, [], undefined);
    const [entry] = merged;
    expect(entry).toBeDefined();
    if (entry === undefined) throw new Error("coverage missing");
    for (const c of entry.criteria) expect(c.attested).toBeUndefined();
    expect(entry.coveredManual).toBeUndefined();
  });

  it("surfaces attestation on a criterion that has no matching record", () => {
    const coverage = buildCoverageReport(RESULT, [STANDARD]);
    // Attestation for an unrelated criterion should not decorate
    // anything — no "attested" on any of the standard's criteria.
    const merged = mergeAttestationIntoCoverage(
      coverage,
      [makeAttestation("wcag22:9.9.9", "pass")],
      undefined,
    );
    const [entry] = merged;
    if (entry === undefined) throw new Error("coverage missing");
    for (const c of entry.criteria) expect(c.attested).toBeUndefined();
  });

  it("counts a manual criterion with a fresh pass attestation as covered", () => {
    const coverage = buildCoverageReport(RESULT, [STANDARD]);
    const merged = mergeAttestationIntoCoverage(
      coverage,
      [makeAttestation("wcag22:1.2.1", "pass")],
      undefined, // no cwd → probe disabled → attestation cannot be stale
    );
    const [entry] = merged;
    if (entry === undefined) throw new Error("coverage missing");
    const c121 = findCriterion(entry, "wcag22:1.2.1");
    expect(c121?.static).toBe("manual");
    expect(c121?.attested).toEqual({ verdict: "pass" });
    expect(entry.coveredManual).toBe(1);
    expect(entry.coveredManualCriteria).toEqual(["wcag22:1.2.1"]);
  });

  it("treats an n/a attestation on a manual criterion as covered", () => {
    const coverage = buildCoverageReport(RESULT, [STANDARD]);
    const merged = mergeAttestationIntoCoverage(
      coverage,
      [makeAttestation("wcag22:1.2.1", "n/a")],
      undefined,
    );
    const [entry] = merged;
    if (entry === undefined) throw new Error("coverage missing");
    const c121 = findCriterion(entry, "wcag22:1.2.1");
    expect(c121?.attested).toEqual({ verdict: "n/a" });
    expect(entry.coveredManualCriteria).toEqual(["wcag22:1.2.1"]);
  });

  it("does NOT count a stale pass attestation toward coverage", () => {
    const coverage = buildCoverageReport(RESULT, [STANDARD]);
    const alwaysStale = { isStale: () => true as const };
    const merged = mergeAttestationIntoCoverage(
      coverage,
      [makeAttestation("wcag22:1.2.1", "pass")],
      { probe: alwaysStale },
    );
    const [entry] = merged;
    if (entry === undefined) throw new Error("coverage missing");
    const c121 = findCriterion(entry, "wcag22:1.2.1");
    expect(c121?.attested).toEqual({ verdict: "pass", stale: true });
    // Stale pass on a manual criterion must NOT be folded into
    // coverage — the agent explicitly needs to re-attest.
    expect(entry.coveredManual).toBeUndefined();
    expect(entry.coveredManualCriteria).toBeUndefined();
  });

  it("does NOT count a pending attestation as covered", () => {
    const coverage = buildCoverageReport(RESULT, [STANDARD]);
    // verdict omitted → surfaces as "pending"
    const merged = mergeAttestationIntoCoverage(
      coverage,
      [makeAttestation("wcag22:1.2.1", undefined)],
      undefined,
    );
    const [entry] = merged;
    if (entry === undefined) throw new Error("coverage missing");
    expect(findCriterion(entry, "wcag22:1.2.1")?.attested).toEqual({ verdict: "pending" });
    expect(entry.coveredManual).toBeUndefined();
    expect(entry.coveredManualCriteria).toBeUndefined();
  });

  it("does NOT count a fail attestation on a manual criterion as covered", () => {
    const coverage = buildCoverageReport(RESULT, [STANDARD]);
    const merged = mergeAttestationIntoCoverage(
      coverage,
      [makeAttestation("wcag22:1.2.1", "fail")],
      undefined,
    );
    const [entry] = merged;
    if (entry === undefined) throw new Error("coverage missing");
    expect(findCriterion(entry, "wcag22:1.2.1")?.attested).toEqual({ verdict: "fail" });
    expect(entry.coveredManual).toBeUndefined();
  });

  it("leaves a static:fail criterion failing even when a pass attestation exists", () => {
    const coverage = buildCoverageReport(RESULT, [STANDARD]);
    const merged = mergeAttestationIntoCoverage(
      coverage,
      [makeAttestation("wcag22:1.4.3", "pass")],
      undefined,
    );
    const [entry] = merged;
    if (entry === undefined) throw new Error("coverage missing");
    const c143 = findCriterion(entry, "wcag22:1.4.3");
    expect(c143?.static).toBe("fail");
    expect(c143?.attested).toEqual({ verdict: "pass" });
    // Static aggregate counters unchanged — 1 of 2 automatable passes.
    expect(entry.failing).toBe(1);
    expect(entry.failingCriteria).toContain("wcag22:1.4.3");
    expect(entry.passing).toBe(1);
    expect(entry.coveredManual).toBeUndefined();
  });

  it("surfaces a fail attestation on an automatable-pass criterion without flipping the verdict", () => {
    const coverage = buildCoverageReport(RESULT, [STANDARD]);
    const merged = mergeAttestationIntoCoverage(
      coverage,
      [makeAttestation("wcag22:1.1.1", "fail")],
      undefined,
    );
    const [entry] = merged;
    if (entry === undefined) throw new Error("coverage missing");
    const c111 = findCriterion(entry, "wcag22:1.1.1");
    expect(c111?.static).toBe("pass");
    expect(c111?.attested).toEqual({ verdict: "fail" });
    // Static aggregate: 1.1.1 still counted as passing.
    // (1 of 2 automatable passes — 1.4.3 fails statically.)
    expect(entry.passing).toBe(1);
    expect(entry.failingCriteria).not.toContain("wcag22:1.1.1");
  });

  it("picks the most recent attestation when multiple speak to one criterion", () => {
    const coverage = buildCoverageReport(RESULT, [STANDARD]);
    const older = makeAttestation("wcag22:1.2.1", "pass", {
      attestedAt: "2026-01-01T00:00:00Z",
      reason: "older",
    });
    const newer = makeAttestation("wcag22:1.2.1", "fail", {
      attestedAt: "2026-04-10T00:00:00Z",
      reason: "newer",
    });
    const merged = mergeAttestationIntoCoverage(coverage, [older, newer], undefined);
    const [entry] = merged;
    if (entry === undefined) throw new Error("coverage missing");
    expect(findCriterion(entry, "wcag22:1.2.1")?.attested?.verdict).toBe("fail");
    expect(entry.coveredManual).toBeUndefined();
  });

  it("omits stale when the probe returns null (indeterminate) and still counts coverage", () => {
    const coverage = buildCoverageReport(RESULT, [STANDARD]);
    const indeterminate = { isStale: () => null };
    const merged = mergeAttestationIntoCoverage(
      coverage,
      [makeAttestation("wcag22:1.2.1", "pass")],
      { probe: indeterminate },
    );
    const [entry] = merged;
    if (entry === undefined) throw new Error("coverage missing");
    const c121 = findCriterion(entry, "wcag22:1.2.1");
    // Probe couldn't answer → stale omitted (not guessed) and the
    // attestation still lands as covered (it's not stale until
    // proven stale).
    expect(c121?.attested).toEqual({ verdict: "pass" });
    expect(entry.coveredManual).toBe(1);
  });

  it("is a pure transformation — does not mutate the input coverage array", () => {
    const coverage = buildCoverageReport(RESULT, [STANDARD]);
    const before = JSON.stringify(coverage);
    mergeAttestationIntoCoverage(coverage, [makeAttestation("wcag22:1.2.1", "pass")], undefined);
    expect(JSON.stringify(coverage)).toBe(before);
  });
});
