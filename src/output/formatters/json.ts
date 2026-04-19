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
          // Stable group identity — see docs/adr/0008-violation-group-key.md.
          groupKey: v.groupKey,
          ruleId: v.ruleId,
          criteria: v.criteria,
          // Aligned index-for-index with `criteria`. Omitted when the
          // engine did not stamp titles (e.g. synthetic rule-crash
          // records with `criteria: []`).
          ...(v.criteriaTitles !== undefined && { criteriaTitles: v.criteriaTitles }),
          severity: v.severity,
          location: v.location,
          message: v.message,
          ...(v.suggestion !== undefined && { suggestion: v.suggestion }),
          ...(v.snippet !== undefined && { snippet: v.snippet }),
          // Scanner-level confidence — canonically `"inherited"` on
          // Q2R2-INHERITED findings synthesized from a wrapper
          // definition. Omit when unset so primary findings don't
          // carry a misleading default string.
          ...(v.confidence !== undefined && { confidence: v.confidence }),
          // Source-of-truth pointer for synthesized findings (wrapper
          // call sites inheriting from the definition). Omit on
          // primary findings per CLAUDE.md §1 "Ambiguous field shapes
          // are dishonest." See ADR 0012.
          ...(v.sourceOfFinding !== undefined && { sourceOfFinding: v.sourceOfFinding }),
          // Named reason codes for known escape hatches. Informational
          // only — consumers investigate; we never auto-suppress. Omit
          // when empty per docs/adr/0009-violation-could-be-wrong-
          // because.md and CLAUDE.md §1.
          ...(v.couldBeWrongBecause && v.couldBeWrongBecause.length > 0
            ? { couldBeWrongBecause: [...v.couldBeWrongBecause] }
            : {}),
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
