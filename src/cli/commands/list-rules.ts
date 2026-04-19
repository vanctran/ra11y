/**
 * `ra11y --list-rules` — prints every registered rule with its ID,
 * severity, and the criteria it satisfies.
 */

import { BUILTIN_RULES } from "../../rules/index.ts";
import { ExitCode } from "../exit-codes.ts";
import type { ScanExit } from "./scan.ts";

export function runListRules(): ScanExit {
  const lines: string[] = [];
  lines.push("");
  lines.push("  Rules:");
  lines.push("");
  for (const rule of BUILTIN_RULES) {
    lines.push(`    ${rule.id}  [${rule.severity}]`);
    lines.push(`      satisfies: ${rule.satisfies.join(", ")}`);
    lines.push(`      ${rule.docs.description}`);
    lines.push("");
  }
  lines.push(`  ${BUILTIN_RULES.length} rule${BUILTIN_RULES.length === 1 ? "" : "s"} loaded.`);
  lines.push("");
  return { stdout: lines.join("\n"), stderr: "", exitCode: ExitCode.OK };
}
