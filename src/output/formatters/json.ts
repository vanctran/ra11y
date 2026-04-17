/**
 * JSON formatter — machine-readable output.
 *
 * Emits a single JSON object with result + report. Deterministic:
 * JSON.stringify with a fixed 2-space indent and an explicit key order
 * (via an object shape, not a replacer — stable under repeated runs).
 */

import { defineFormatter } from "../../api/plugin.ts";
import type { ReportData, ScanResult } from "../../types/violation.ts";

export const jsonFormatter = defineFormatter({
  id: "json",
  format(result: ScanResult, report: ReportData): string {
    const payload = {
      ra11y: {
        version: "0.0.0",
      },
      result: {
        enabledStandards: result.enabledStandards,
        filesScanned: result.filesScanned,
        durationMs: Math.round(result.durationMs),
        violations: result.violations.map((v) => ({
          findingId: v.findingId,
          ruleId: v.ruleId,
          criteria: v.criteria,
          severity: v.severity,
          location: v.location,
          message: v.message,
          ...(v.suggestion !== undefined && { suggestion: v.suggestion }),
          ...(v.snippet !== undefined && { snippet: v.snippet }),
        })),
      },
      report: {
        coverage: report.coverage,
        manualReviewNeeded: report.manualReviewNeeded,
      },
    };
    return `${JSON.stringify(payload, null, 2)}\n`;
  },
});
