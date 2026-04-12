/**
 * JUnit XML formatter for CI test-runner integration.
 *
 * Emits the classic Ant/Jenkins JUnit XML shape (testsuites → testsuite
 * → testcase, with `<failure>` children for violations). Most CI
 * servers and IDE test panels ingest this format natively, so
 * `ra11y --format junit > junit.xml` drops the accessibility results
 * into the same UI as unit-test failures.
 *
 * Mapping:
 *   - one <testsuite> per scanned file
 *   - one <testcase> per rule-id inside each file
 *   - <failure> child when that rule produced violations in the file
 *   - `tests`, `failures`, `errors` counts rolled up at both levels
 *
 * Zero runtime deps; XML is emitted as hand-written strings with
 * proper escaping (no external xmlbuilder).
 */

import { defineFormatter } from "../../api/plugin.ts";
import type { ReportData, ScanResult, Violation } from "../../types/violation.ts";

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';

export const junitFormatter = defineFormatter({
  id: "junit",
  format(result: ScanResult, _report: ReportData): string {
    const byFile = groupViolationsByFile(result.violations);
    const suites = [...byFile.entries()].map(([file, violations]) => renderSuite(file, violations));

    const totalTests = [...byFile.values()].reduce(
      (acc, violations) => acc + countUniqueRuleIds(violations),
      0,
    );
    const totalFailures = result.violations.filter((v) => v.severity === "error").length;
    const totalErrors = 0; // ra11y's "error" maps to JUnit "failure"; no runtime errors.

    const header = `<testsuites name="ra11y" tests="${totalTests}" failures="${totalFailures}" errors="${totalErrors}" time="${(result.durationMs / 1000).toFixed(3)}">`;
    const footer = `</testsuites>`;

    return `${XML_DECL}\n${header}\n${suites.join("\n")}\n${footer}\n`;
  },
});

function groupViolationsByFile(violations: readonly Violation[]): Map<string, Violation[]> {
  const map = new Map<string, Violation[]>();
  for (const v of violations) {
    const existing = map.get(v.location.filePath);
    if (existing) existing.push(v);
    else map.set(v.location.filePath, [v]);
  }
  return map;
}

function countUniqueRuleIds(violations: readonly Violation[]): number {
  return new Set(violations.map((v) => v.ruleId)).size;
}

function renderSuite(filePath: string, violations: readonly Violation[]): string {
  const byRule = new Map<string, Violation[]>();
  for (const v of violations) {
    const existing = byRule.get(v.ruleId);
    if (existing) existing.push(v);
    else byRule.set(v.ruleId, [v]);
  }

  const tests = byRule.size;
  const failures = [...byRule.values()].filter((list) =>
    list.some((v) => v.severity === "error"),
  ).length;

  const cases = [...byRule.entries()]
    .map(([ruleId, list]) => renderCase(filePath, ruleId, list))
    .join("\n");

  return (
    `  <testsuite name="${escapeXml(filePath)}" tests="${tests}" failures="${failures}" errors="0">\n` +
    `${cases}\n` +
    `  </testsuite>`
  );
}

function renderCase(filePath: string, ruleId: string, violations: readonly Violation[]): string {
  const head = `    <testcase classname="${escapeXml(filePath)}" name="${escapeXml(ruleId)}">`;
  const failures = violations.map((v) => renderFailure(v)).join("\n");
  const tail = `    </testcase>`;
  if (failures.length === 0) return `${head}${tail}`;
  return `${head}\n${failures}\n${tail}`;
}

function renderFailure(violation: Violation): string {
  const type = violation.severity === "error" ? "failure" : "warning";
  const message = escapeXml(violation.message);
  const body = escapeXml(renderFailureBody(violation));
  return `      <${type} type="${violation.ruleId}" message="${message}">${body}</${type}>`;
}

function renderFailureBody(violation: Violation): string {
  const lines = [
    `${violation.location.filePath}:${violation.location.line}:${violation.location.column}`,
    `Criteria: ${violation.criteria.join(", ")}`,
    `Message: ${violation.message}`,
  ];
  if (violation.suggestion) lines.push(`Fix: ${violation.suggestion}`);
  return lines.join("\n");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
