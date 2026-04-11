/**
 * Plain formatter — accessible baseline.
 *
 * One violation per line in `<file>:<line>:<col>  <severity>  <ruleId>  <message>`
 * format. No ANSI, no box-drawing, no progress indicators. Triggered
 * automatically when VOICE_OVER / NVDA / ORCA / TERM=dumb is set, or
 * explicitly via `--format plain`.
 *
 * See ACCESSIBILITY.md — a tool helping people build accessible
 * software must itself be accessible.
 */

import { defineFormatter } from "../../api/plugin.ts";
import type { ReportData, ScanResult, Violation } from "../../types/violation.ts";

export const plainFormatter = defineFormatter({
  id: "plain",
  format(result: ScanResult, _report: ReportData): string {
    const lines: string[] = [];
    for (const v of result.violations) {
      lines.push(renderLine(v));
    }
    if (lines.length === 0) {
      return `0 violations in ${result.filesScanned} files (${Math.round(result.durationMs)}ms)\n`;
    }
    const summary = `${result.violations.length} violations in ${result.filesScanned} files (${Math.round(result.durationMs)}ms)`;
    return `${lines.join("\n")}\n${summary}\n`;
  },
});

function renderLine(v: Violation): string {
  const loc = `${v.location.filePath}:${v.location.line}:${v.location.column}`;
  const parts = [loc, v.severity, v.ruleId, v.message];
  if (v.suggestion) parts.push(`fix: ${v.suggestion}`);
  return parts.join("  ");
}
