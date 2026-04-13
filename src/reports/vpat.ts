/**
 * VPAT 2.4 (Voluntary Product Accessibility Template) report builder.
 *
 * Given a ScanResult + loaded standards, produces a structured VpatReport
 * that VPAT-format templates consume. ra11y is not a legal document
 * producer — we emit the data; users paste it into their VPAT template
 * of choice (HTML, PDF, Word, Markdown).
 *
 * Conformance decision logic per criterion:
 *   - "Not Evaluated" — no rule satisfies this criterion (manual-only)
 *   - "Not Applicable" — the criterion doesn't apply to any scanned
 *     content (v0.0.x heuristic: we don't know what "applicable" means
 *     without running code, so we conservatively mark manual-only
 *     criteria as "Not Evaluated" and let the user override in their
 *     final VPAT)
 *   - "Does Not Support" — at least one `error` violation
 *   - "Partially Supports" — only `warning` violations, or the
 *     criterion is classified "partial" in the standard metadata
 *   - "Supports" — zero violations on an automatable criterion
 */

import type { ReviewCandidate } from "../types/review.ts";
import type { Criterion, Standard } from "../types/standard.ts";
import type { ScanResult, Violation } from "../types/violation.ts";

export type Conformance =
  | "Supports"
  | "Partially Supports"
  | "Does Not Support"
  | "Not Applicable"
  | "Not Evaluated";

export interface VpatEntry {
  readonly criterionId: string;
  readonly localId: string;
  readonly title: string;
  readonly level: string;
  readonly conformance: Conformance;
  readonly remarks: string;
  readonly violationCount: number;
  readonly automated: boolean;
}

export interface VpatStandardSection {
  readonly standardId: string;
  readonly standardName: string;
  readonly version: string;
  readonly entries: readonly VpatEntry[];
  readonly summary: {
    readonly supports: number;
    readonly partiallySupports: number;
    readonly doesNotSupport: number;
    readonly notApplicable: number;
    readonly notEvaluated: number;
  };
}

export interface VpatReport {
  readonly generatedAt: string;
  readonly evaluator: string;
  readonly standards: readonly VpatStandardSection[];
}

const EVALUATOR = "ra11y v0.0.0";

export function buildVpatReport(
  result: ScanResult,
  loadedStandards: readonly Standard[],
  generatedAt: string = new Date().toISOString(),
  candidates: readonly ReviewCandidate[] = [],
): VpatReport {
  const enabledSet = new Set(result.enabledStandards);
  const violationsByCriterion = indexViolationsByCriterion(result.violations);
  const candidatesByCriterion = indexCandidatesByCriterion(candidates);

  const standardSections: VpatStandardSection[] = [];
  for (const standard of loadedStandards) {
    if (!enabledSet.has(standard.id)) continue;
    standardSections.push(buildSection(standard, violationsByCriterion, candidatesByCriterion));
  }

  return {
    generatedAt,
    evaluator: EVALUATOR,
    standards: standardSections,
  };
}

function buildSection(
  standard: Standard,
  violationsByCriterion: ReadonlyMap<string, readonly Violation[]>,
  candidatesByCriterion: ReadonlyMap<string, readonly ReviewCandidate[]>,
): VpatStandardSection {
  const entries: VpatEntry[] = [];
  const summary = {
    supports: 0,
    partiallySupports: 0,
    doesNotSupport: 0,
    notApplicable: 0,
    notEvaluated: 0,
  };

  for (const criterion of standard.criteria) {
    const entry = buildEntry(
      criterion,
      violationsByCriterion.get(criterion.id) ?? [],
      candidatesByCriterion.get(criterion.id) ?? [],
    );
    entries.push(entry);
    switch (entry.conformance) {
      case "Supports":
        summary.supports += 1;
        break;
      case "Partially Supports":
        summary.partiallySupports += 1;
        break;
      case "Does Not Support":
        summary.doesNotSupport += 1;
        break;
      case "Not Applicable":
        summary.notApplicable += 1;
        break;
      case "Not Evaluated":
        summary.notEvaluated += 1;
        break;
    }
  }

  return {
    standardId: standard.id,
    standardName: standard.name,
    version: standard.version,
    entries,
    summary,
  };
}

function buildEntry(
  criterion: Criterion,
  violations: readonly Violation[],
  candidates: readonly ReviewCandidate[],
): VpatEntry {
  const automated = criterion.automatable !== "manual";

  if (!automated) {
    return {
      criterionId: criterion.id,
      localId: criterion.localId,
      title: criterion.title,
      level: criterion.level,
      conformance: "Not Evaluated",
      remarks: buildManualRemarks(candidates),
      violationCount: 0,
      automated: false,
    };
  }

  if (violations.length === 0) {
    const remarks =
      criterion.automatable === "partial"
        ? "Automated checks passed. The `partial` classification means additional manual review is still recommended for full assurance."
        : "Automated checks passed.";
    return {
      criterionId: criterion.id,
      localId: criterion.localId,
      title: criterion.title,
      level: criterion.level,
      conformance: criterion.automatable === "partial" ? "Partially Supports" : "Supports",
      remarks,
      violationCount: 0,
      automated: true,
    };
  }

  const hasError = violations.some((v) => v.severity === "error");
  const conformance: Conformance = hasError ? "Does Not Support" : "Partially Supports";
  const ruleSet = new Set(violations.map((v) => v.ruleId));
  const ruleList = [...ruleSet].sort().join(", ");

  return {
    criterionId: criterion.id,
    localId: criterion.localId,
    title: criterion.title,
    level: criterion.level,
    conformance,
    remarks: `${violations.length} violation(s) from rule(s): ${ruleList}. See the terminal or JSON report for file locations and fix suggestions.`,
    violationCount: violations.length,
    automated: true,
  };
}

/**
 * Remark for a manual criterion. If finders have surfaced candidate
 * locations, point the reviewer at them with a count and top-level
 * file/line so the VPAT carries real evidence instead of boilerplate.
 *
 * Kept intentionally factual — no pass/fail language, since a candidate
 * is "go look here," not a violation.
 */
function buildManualRemarks(candidates: readonly ReviewCandidate[]): string {
  if (candidates.length === 0) {
    return "Manual review required — this criterion cannot be statically checked.";
  }
  const locations = new Set<string>();
  for (const c of candidates) locations.add(`${c.location.filePath}:${c.location.line}`);
  const preview: string[] = [];
  const MAX_PREVIEW = 3;
  for (const loc of locations) {
    if (preview.length >= MAX_PREVIEW) break;
    preview.push(loc);
  }
  const total = locations.size;
  const extra = total > preview.length ? ` (+${total - preview.length} more)` : "";
  return `Manual review required. ${total} candidate location(s) surfaced by finders: ${preview.join(
    ", ",
  )}${extra}. See --checklist output for the full list and review guidance.`;
}

function indexCandidatesByCriterion(
  candidates: readonly ReviewCandidate[],
): Map<string, ReviewCandidate[]> {
  const map = new Map<string, ReviewCandidate[]>();
  for (const c of candidates) {
    let list = map.get(c.criterionId);
    if (!list) {
      list = [];
      map.set(c.criterionId, list);
    }
    list.push(c);
  }
  return map;
}

function indexViolationsByCriterion(violations: readonly Violation[]): Map<string, Violation[]> {
  const map = new Map<string, Violation[]>();
  for (const v of violations) {
    for (const criterionId of v.criteria) {
      let list = map.get(criterionId);
      if (!list) {
        list = [];
        map.set(criterionId, list);
      }
      list.push(v);
    }
  }
  return map;
}

/** Renders a VPAT report as a Markdown table ready to paste into a VPAT template. */
export function renderVpatMarkdown(report: VpatReport): string {
  const lines: string[] = [];
  lines.push("# VPAT 2.4 Conformance Report");
  lines.push("");
  lines.push(`- **Evaluator**: ${report.evaluator}`);
  lines.push(`- **Generated**: ${report.generatedAt}`);
  lines.push("");

  for (const section of report.standards) {
    lines.push(`## ${section.standardName} ${section.version}`);
    lines.push("");
    lines.push(
      `Summary: **${section.summary.supports}** Supports · **${section.summary.partiallySupports}** Partially · **${section.summary.doesNotSupport}** Does Not Support · **${section.summary.notEvaluated}** Not Evaluated`,
    );
    lines.push("");
    lines.push("| Criterion | Level | Conformance | Remarks |");
    lines.push("|-----------|-------|-------------|---------|");
    for (const entry of section.entries) {
      const title = entry.title.replace(/\|/g, "\\|");
      const remarks = entry.remarks.replace(/\|/g, "\\|").replace(/\n/g, " ");
      lines.push(
        `| ${entry.localId} ${title} | ${entry.level} | ${entry.conformance} | ${remarks} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
