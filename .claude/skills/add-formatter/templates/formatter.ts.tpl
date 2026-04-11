/**
 * Formatter: {{name}}
 *
 * {{description}}
 *
 * Specification: {{specUrl}}
 */
import { defineFormatter } from "@/api/plugin";
import type { ReportData, ScanResult } from "@/types/violation";

export const formatter = defineFormatter({
  id: "{{name}}",
  format(result: ScanResult, report: ReportData): string {
    // TODO: render result.violations + report into the target format.
    // Remember:
    //   - Violations must already be sorted by (filePath, line, column, ruleId).
    //   - No I/O — the caller decides stdout vs. file.
    //   - Non-TTY mode: respect result.isTTY for terminal formatters.
    //   - Determinism: same input must always produce same output.
    return "";
  },
});
