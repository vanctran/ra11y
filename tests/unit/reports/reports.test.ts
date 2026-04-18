import { describe, expect, it } from "bun:test";
import {
  buildCertificationScorecard,
  buildChecklist,
  buildCoverageReport,
  buildVpatReport,
  renderCertificationMarkdown,
  renderChecklistMarkdown,
  renderVpatMarkdown,
} from "../../../src/reports/index.ts";
import { BUILTIN_STANDARDS } from "../../../src/standards/index.ts";
import type { ScanResult } from "../../../src/types/violation.ts";
import { withFindingIds } from "../../helpers/make-violation.ts";

// Fixed synthetic ScanResult so the reports layer can be tested without
// parsing real files. Two violations targeting wcag22:1.1.1 (from a
// single rule declaration the alt-text-missing rule could produce).
const RESULT: ScanResult = {
  violations: withFindingIds([
    {
      ruleId: "media/alt-text-missing",
      fixClass: "mechanical",
      criteria: ["wcag22:1.1.1", "wcag21:1.1.1", "section508:1.1.1", "en301549:9.1.1.1"],
      severity: "error",
      location: { filePath: "src/ui/Card.tsx", line: 12, column: 5 },
      message: "<img> missing alt.",
      suggestion: "Add alt text.",
    },
    {
      ruleId: "media/alt-text-missing",
      fixClass: "mechanical",
      criteria: ["wcag22:1.1.1", "wcag21:1.1.1", "section508:1.1.1", "en301549:9.1.1.1"],
      severity: "error",
      location: { filePath: "src/ui/Header.tsx", line: 4, column: 3 },
      message: "<img> missing alt.",
      suggestion: "Add alt text.",
    },
  ]),
  filesScanned: 2,
  durationMs: 5,
  enabledStandards: ["wcag22", "wcag21", "section508", "en301549"],
  isTTY: false,
};

describe("buildCoverageReport", () => {
  it("returns one entry per enabled standard", () => {
    const coverage = buildCoverageReport(RESULT, BUILTIN_STANDARDS);
    const ids = coverage.map((c) => c.standardId).sort();
    expect(ids).toEqual(["en301549", "section508", "wcag21", "wcag22"]);
  });

  it("marks wcag22:1.1.1 as failing", () => {
    const coverage = buildCoverageReport(RESULT, BUILTIN_STANDARDS);
    const wcag22 = coverage.find((c) => c.standardId === "wcag22");
    expect(wcag22?.failingCriteria).toContain("wcag22:1.1.1");
    expect(wcag22?.failing).toBeGreaterThan(0);
  });

  it("computes automatedPassRate as 0-100", () => {
    const coverage = buildCoverageReport(RESULT, BUILTIN_STANDARDS);
    for (const c of coverage) {
      expect(c.automatedPassRate).toBeGreaterThanOrEqual(0);
      expect(c.automatedPassRate).toBeLessThanOrEqual(100);
    }
  });

  it("lists manual-only criteria per standard", () => {
    const coverage = buildCoverageReport(RESULT, BUILTIN_STANDARDS);
    const wcag22 = coverage.find((c) => c.standardId === "wcag22");
    // 1.2.1 Audio-only/Video-only is a known manual criterion.
    expect(wcag22?.manualCriteria).toContain("wcag22:1.2.1");
  });
});

describe("buildChecklist + renderChecklistMarkdown", () => {
  it("produces sections for each standard with manual criteria", () => {
    const coverage = buildCoverageReport(RESULT, BUILTIN_STANDARDS);
    const checklist = buildChecklist(coverage, BUILTIN_STANDARDS);
    expect(checklist.sections.length).toBeGreaterThan(0);
    expect(checklist.totalItems).toBeGreaterThan(0);
  });

  it("renders Markdown with checkboxes and spec URLs", () => {
    const coverage = buildCoverageReport(RESULT, BUILTIN_STANDARDS);
    const checklist = buildChecklist(coverage, BUILTIN_STANDARDS);
    const md = renderChecklistMarkdown(checklist);
    expect(md).toContain("# Manual review checklist");
    expect(md).toContain("- [ ]");
    expect(md).toContain("https://www.w3.org/TR/");
  });

  it("includes custom guidance for known SCs like 1.2.1", () => {
    const coverage = buildCoverageReport(RESULT, BUILTIN_STANDARDS);
    const checklist = buildChecklist(coverage, BUILTIN_STANDARDS);
    const md = renderChecklistMarkdown(checklist);
    expect(md).toContain("transcript"); // from the 1.2.1 guidance prompt
  });
});

describe("buildVpatReport + renderVpatMarkdown", () => {
  it("builds a section per enabled standard with correct summary counts", () => {
    const report = buildVpatReport(RESULT, BUILTIN_STANDARDS, "2026-04-11T00:00:00Z");
    expect(report.standards).toHaveLength(4);
    for (const section of report.standards) {
      const sum =
        section.summary.supports +
        section.summary.partiallySupports +
        section.summary.doesNotSupport +
        section.summary.notApplicable +
        section.summary.notEvaluated;
      expect(sum).toBe(section.entries.length);
    }
  });

  it("marks wcag22:1.1.1 as 'Does Not Support'", () => {
    const report = buildVpatReport(RESULT, BUILTIN_STANDARDS, "2026-04-11T00:00:00Z");
    const wcag22 = report.standards.find((s) => s.standardId === "wcag22");
    const entry = wcag22?.entries.find((e) => e.criterionId === "wcag22:1.1.1");
    expect(entry?.conformance).toBe("Does Not Support");
    expect(entry?.violationCount).toBe(2);
  });

  it("marks manual-only criteria as 'Not Evaluated'", () => {
    const report = buildVpatReport(RESULT, BUILTIN_STANDARDS, "2026-04-11T00:00:00Z");
    const wcag22 = report.standards.find((s) => s.standardId === "wcag22");
    const entry = wcag22?.entries.find((e) => e.criterionId === "wcag22:1.2.1");
    expect(entry?.conformance).toBe("Not Evaluated");
  });

  it("marks clean automatable criteria as 'Supports' or 'Partially Supports'", () => {
    const report = buildVpatReport(RESULT, BUILTIN_STANDARDS, "2026-04-11T00:00:00Z");
    const wcag22 = report.standards.find((s) => s.standardId === "wcag22");
    // 2.4.2 Page Titled — clean in our synthetic result, automatable: "full"
    const entry = wcag22?.entries.find((e) => e.criterionId === "wcag22:2.4.2");
    expect(entry?.conformance).toBe("Supports");
  });

  it("renders Markdown with conformance table", () => {
    const report = buildVpatReport(RESULT, BUILTIN_STANDARDS, "2026-04-11T00:00:00Z");
    const md = renderVpatMarkdown(report);
    expect(md).toContain("# VPAT 2.4 Conformance Report");
    expect(md).toContain("| Criterion | Level | Conformance | Remarks |");
    expect(md).toContain("Does Not Support");
  });

  it("falls back to generic manual-review remark when no candidates supplied", () => {
    const report = buildVpatReport(RESULT, BUILTIN_STANDARDS, "2026-04-11T00:00:00Z");
    const wcag22 = report.standards.find((s) => s.standardId === "wcag22");
    const entry = wcag22?.entries.find((e) => e.criterionId === "wcag22:1.2.1");
    expect(entry?.remarks).toContain("Manual review required");
    expect(entry?.remarks).not.toContain("candidate location(s)");
  });

  it("injects candidate locations into the manual-review remark", () => {
    const candidates = [
      {
        criterionId: "wcag22:1.2.1",
        location: { filePath: "src/ui/Player.tsx", line: 42, column: 3 },
        reason: "video without transcript link",
        confidence: "medium" as const,
      },
      {
        criterionId: "wcag22:1.2.1",
        location: { filePath: "src/ui/Intro.tsx", line: 7, column: 1 },
        reason: "audio element detected",
        confidence: "medium" as const,
      },
    ];
    const report = buildVpatReport(RESULT, BUILTIN_STANDARDS, "2026-04-11T00:00:00Z", candidates);
    const wcag22 = report.standards.find((s) => s.standardId === "wcag22");
    const entry = wcag22?.entries.find((e) => e.criterionId === "wcag22:1.2.1");
    expect(entry?.remarks).toContain("2 candidate location(s)");
    expect(entry?.remarks).toContain("src/ui/Player.tsx:42");
    expect(entry?.remarks).toContain("src/ui/Intro.tsx:7");
  });

  it("caps remark preview and summarizes overflow", () => {
    const candidates = Array.from({ length: 8 }, (_, i) => ({
      criterionId: "wcag22:1.2.1",
      location: { filePath: `src/f${i}.tsx`, line: i + 1, column: 1 },
      reason: "x",
      confidence: "medium" as const,
    }));
    const report = buildVpatReport(RESULT, BUILTIN_STANDARDS, "2026-04-11T00:00:00Z", candidates);
    const wcag22 = report.standards.find((s) => s.standardId === "wcag22");
    const entry = wcag22?.entries.find((e) => e.criterionId === "wcag22:1.2.1");
    expect(entry?.remarks).toContain("8 candidate location(s)");
    expect(entry?.remarks).toContain("+5 more");
  });

  it("surfaces violations on a manual-classified criterion as 'Does Not Support'", () => {
    // Regression guard: document/meta-refresh is a real rule that can
    // fire on wcag22:2.2.1, classified "manual" in metadata. The VPAT
    // must not silently downgrade that to "Not Evaluated" just because
    // the criterion is tagged manual.
    const ruleHit: ScanResult = {
      ...RESULT,
      violations: withFindingIds([
        {
          ruleId: "document/meta-refresh",
          fixClass: "mechanical",
          criteria: ["wcag22:2.2.1"],
          severity: "error",
          location: { filePath: "src/page.html", line: 1, column: 1 },
          message: '<meta http-equiv="refresh">',
          suggestion: "Remove.",
        },
      ]),
    };
    const report = buildVpatReport(ruleHit, BUILTIN_STANDARDS, "2026-04-11T00:00:00Z");
    const wcag22 = report.standards.find((s) => s.standardId === "wcag22");
    const entry = wcag22?.entries.find((e) => e.criterionId === "wcag22:2.2.1");
    expect(entry?.conformance).toBe("Does Not Support");
    expect(entry?.violationCount).toBe(1);
    expect(entry?.remarks).toContain("document/meta-refresh");
  });

  it("leaves automated criteria remarks untouched when candidates attach", () => {
    // Candidates targeting the same criterion that already has violations
    // should not overwrite the violation-based remark, because the
    // criterion is "Does Not Support," not "Not Evaluated."
    const candidates = [
      {
        criterionId: "wcag22:1.1.1",
        location: { filePath: "src/weird.tsx", line: 1, column: 1 },
        reason: "should not appear",
        confidence: "medium" as const,
      },
    ];
    const report = buildVpatReport(RESULT, BUILTIN_STANDARDS, "2026-04-11T00:00:00Z", candidates);
    const wcag22 = report.standards.find((s) => s.standardId === "wcag22");
    const entry = wcag22?.entries.find((e) => e.criterionId === "wcag22:1.1.1");
    expect(entry?.remarks).not.toContain("candidate location(s)");
    expect(entry?.remarks).toContain("violation(s)");
  });
});

describe("buildCertificationScorecard + renderCertificationMarkdown", () => {
  it("produces a score per enabled standard", () => {
    const coverage = buildCoverageReport(RESULT, BUILTIN_STANDARDS);
    const scores = buildCertificationScorecard(coverage, BUILTIN_STANDARDS, {}, "AA");
    expect(scores).toHaveLength(4);
  });

  it("readiness is 0-100", () => {
    const coverage = buildCoverageReport(RESULT, BUILTIN_STANDARDS);
    const scores = buildCertificationScorecard(coverage, BUILTIN_STANDARDS, {}, "AA");
    for (const s of scores) {
      expect(s.readiness).toBeGreaterThanOrEqual(0);
      expect(s.readiness).toBeLessThanOrEqual(100);
    }
  });

  it("manual completion increases readiness", () => {
    const coverage = buildCoverageReport(RESULT, BUILTIN_STANDARDS);
    const noManual = buildCertificationScorecard(coverage, BUILTIN_STANDARDS, {}, "AA");
    const withManual = buildCertificationScorecard(
      coverage,
      BUILTIN_STANDARDS,
      {
        "wcag22:1.2.1": { reviewed: true, status: "supports" },
        "wcag22:1.4.1": { reviewed: true, status: "supports" },
      },
      "AA",
    );
    const noWcag22 = noManual.find((s) => s.standardId === "wcag22");
    const withWcag22 = withManual.find((s) => s.standardId === "wcag22");
    expect(withWcag22?.manual.reviewed).toBeGreaterThan(noWcag22?.manual.reviewed ?? 0);
  });

  it("lists blocking issues capped at 10", () => {
    const coverage = buildCoverageReport(RESULT, BUILTIN_STANDARDS);
    const scores = buildCertificationScorecard(coverage, BUILTIN_STANDARDS, {}, "AA");
    for (const s of scores) {
      expect(s.blockingIssues.length).toBeLessThanOrEqual(10);
    }
  });

  it("renders Markdown with readiness number and next steps", () => {
    const coverage = buildCoverageReport(RESULT, BUILTIN_STANDARDS);
    const scores = buildCertificationScorecard(coverage, BUILTIN_STANDARDS, {}, "AA");
    const md = renderCertificationMarkdown(scores);
    expect(md).toContain("# Certification Readiness Scorecard");
    expect(md).toContain("Readiness:");
    expect(md).toContain("Next steps");
  });
});

describe("buildCoverageReport level filtering", () => {
  it("--level AA excludes AAA criteria from manual review", () => {
    const coverage = buildCoverageReport(RESULT, BUILTIN_STANDARDS, "AA");
    const wcag22 = coverage.find((c) => c.standardId === "wcag22");
    expect(wcag22).toBeDefined();
    for (const criterionId of wcag22?.manualCriteria ?? []) {
      // Look up the criterion in the standard to check its level
      const std = BUILTIN_STANDARDS.find((s) => s.id === "wcag22");
      const criterion = std?.criteria.find((c) => c.id === criterionId);
      expect(criterion?.level).not.toBe("AAA");
    }
  });

  it("--level AA produces fewer manual criteria than --level AAA", () => {
    const aa = buildCoverageReport(RESULT, BUILTIN_STANDARDS, "AA");
    const aaa = buildCoverageReport(RESULT, BUILTIN_STANDARDS, "AAA");
    const aaManual = aa.find((c) => c.standardId === "wcag22")?.manualCriteria.length ?? 0;
    const aaaManual = aaa.find((c) => c.standardId === "wcag22")?.manualCriteria.length ?? 0;
    expect(aaManual).toBeLessThan(aaaManual);
  });

  it("--level A excludes both AA and AAA criteria", () => {
    const coverage = buildCoverageReport(RESULT, BUILTIN_STANDARDS, "A");
    const wcag22 = coverage.find((c) => c.standardId === "wcag22");
    for (const criterionId of wcag22?.manualCriteria ?? []) {
      const std = BUILTIN_STANDARDS.find((s) => s.id === "wcag22");
      const criterion = std?.criteria.find((c) => c.id === criterionId);
      expect(criterion?.level).toBe("A");
    }
  });

  it("omitting level defaults to including all levels", () => {
    const all = buildCoverageReport(RESULT, BUILTIN_STANDARDS);
    const aaa = buildCoverageReport(RESULT, BUILTIN_STANDARDS, "AAA");
    const allManual = all.find((c) => c.standardId === "wcag22")?.manualCriteria.length ?? 0;
    const aaaManual = aaa.find((c) => c.standardId === "wcag22")?.manualCriteria.length ?? 0;
    expect(allManual).toBe(aaaManual);
  });
});
