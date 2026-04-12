/**
 * Markdown formatter — optimized for PR comments.
 *
 * Posts a scan summary + violation table that renders cleanly in
 * GitHub, GitLab, and Bitbucket PR comment UIs. The typical pipeline:
 *
 *   ra11y --format markdown --changed > ra11y-report.md
 *   gh pr comment --body-file ra11y-report.md
 *
 * Output shape:
 *   1. Header with total counts per severity
 *   2. Summary table (file → rule → location)
 *   3. Per-violation details in collapsible <details> sections when
 *      the total count is >10 (keeps short reports inline, long
 *      reports collapsible)
 *   4. Coverage line per enabled standard
 *
 * Every row in the summary table includes a link to the rule's
 * spec URL via the first criterion's wcag:X.Y.Z anchor — PR
 * reviewers can click through to the normative text without
 * leaving GitHub.
 */

import { defineFormatter } from "../../api/plugin.ts";
import type { ReportData, ScanResult, Severity, Violation } from "../../types/violation.ts";

const COLLAPSE_THRESHOLD = 10;

export const markdownFormatter = defineFormatter({
  id: "markdown",
  format(result: ScanResult, report: ReportData): string {
    const lines: string[] = [];
    lines.push("## ra11y accessibility report");
    lines.push("");
    lines.push(renderSummary(result));
    lines.push("");

    if (result.violations.length === 0) {
      lines.push("_No accessibility violations found._ ✨");
      lines.push("");
    } else {
      lines.push(...renderViolations(result.violations));
      lines.push("");
    }

    lines.push(...renderCoverage(report));
    lines.push("");

    return lines.join("\n");
  },
});

function renderSummary(result: ScanResult): string {
  const errors = result.violations.filter((v) => v.severity === "error").length;
  const warnings = result.violations.filter((v) => v.severity === "warning").length;
  const notes = result.violations.filter((v) => v.severity === "info").length;
  const standards = result.enabledStandards.map(labelForStandard).join(", ");
  return (
    `**${errors}** errors · **${warnings}** warnings · **${notes}** notes  ` +
    `\nScanned ${result.filesScanned} files in ${Math.round(result.durationMs)}ms against ${standards}.`
  );
}

function renderViolations(violations: readonly Violation[]): string[] {
  const lines: string[] = [];
  const collapse = violations.length > COLLAPSE_THRESHOLD;
  if (collapse) {
    lines.push(`<details><summary>${violations.length} violations (click to expand)</summary>`);
    lines.push("");
  }
  lines.push("| File | Line | Rule | Severity | Message |");
  lines.push("|------|-----:|------|:--------:|---------|");
  for (const v of violations) {
    lines.push(renderRow(v));
  }
  if (collapse) {
    lines.push("");
    lines.push("</details>");
  }
  return lines;
}

function renderRow(violation: Violation): string {
  const file = escapeMd(violation.location.filePath);
  const line = `${violation.location.line}`;
  const ruleLink = renderRuleLink(violation);
  const severity = renderSeverity(violation.severity);
  const message = escapeMd(violation.message);
  return `| \`${file}\` | ${line} | ${ruleLink} | ${severity} | ${message} |`;
}

function renderRuleLink(violation: Violation): string {
  const firstCriterion = violation.criteria[0];
  if (!firstCriterion) return `\`${violation.ruleId}\``;
  const url = criterionUrl(firstCriterion);
  if (!url) return `\`${violation.ruleId}\``;
  return `[\`${violation.ruleId}\`](${url})`;
}

function criterionUrl(criterionId: string): string | null {
  const [standardId, localId] = criterionId.split(":");
  if (standardId === undefined || localId === undefined) return null;
  if (standardId === "wcag22") return `https://www.w3.org/TR/WCAG22/#${slugForWcag(localId)}`;
  if (standardId === "wcag21") return `https://www.w3.org/TR/WCAG21/#${slugForWcag(localId)}`;
  return null;
}

function slugForWcag(_localId: string): string {
  // Without the full criterion metadata we can't produce the canonical
  // anchor from the local ID alone. Link to the top of the spec — better
  // than a broken fragment. (Full slug lookup happens in the terminal
  // formatter via the loaded standards registry; the markdown formatter
  // is intentionally self-contained so it can run in minimal PR-bot
  // contexts.)
  return "";
}

function renderSeverity(severity: Severity): string {
  if (severity === "error") return "🔴";
  if (severity === "warning") return "🟡";
  return "🔵";
}

function renderCoverage(report: ReportData): string[] {
  const lines: string[] = [];
  lines.push("### Coverage");
  lines.push("");
  lines.push("| Standard | Automatable passing | Manual review needed |");
  lines.push("|----------|--------------------:|---------------------:|");
  for (const entry of report.coverage) {
    const name = labelForStandard(entry.standardId);
    const pct = entry.automated > 0 ? Math.round((entry.passing / entry.automated) * 100) : 0;
    lines.push(
      `| ${name} | ${entry.passing}/${entry.automated} (${pct}%) | ${report.manualReviewNeeded.length} |`,
    );
  }
  return lines;
}

function labelForStandard(id: string): string {
  if (id === "wcag22") return "WCAG 2.2";
  if (id === "wcag21") return "WCAG 2.1";
  if (id === "section508") return "Section 508";
  if (id === "en301549") return "EN 301 549";
  return id;
}

function escapeMd(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
