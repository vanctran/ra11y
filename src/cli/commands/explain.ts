/**
 * `ra11y --explain <rule-id>` — prints detailed metadata for a rule:
 * normative quote, rationale, good/bad examples, references.
 */

import { BUILTIN_RULES } from "../../rules/index.ts";
import type { ScanExit } from "./scan.ts";

export function runExplain(ruleId: string): ScanExit {
  const rule = BUILTIN_RULES.find((r) => r.id === ruleId);
  if (!rule) {
    return {
      stdout: "",
      stderr: `ra11y: rule '${ruleId}' not found. Use --list-rules to see loaded rules.\n`,
      exitCode: 2,
    };
  }

  const lines: string[] = [];
  lines.push("");
  lines.push(`  ${rule.id}  [${rule.severity}]`);
  lines.push("");
  lines.push(`  Satisfies: ${rule.satisfies.join(", ")}`);
  lines.push("");
  lines.push(`  Description`);
  lines.push(`    ${rule.docs.description}`);
  lines.push("");
  if (rule.docs.rationale) {
    lines.push(`  Rationale`);
    lines.push(`    ${rule.docs.rationale}`);
    lines.push("");
  }
  if (rule.docs.normativeQuote) {
    lines.push(`  Normative text (WCAG)`);
    lines.push(`    "${rule.docs.normativeQuote}"`);
    lines.push("");
  }
  if (rule.docs.goodExample) {
    lines.push(`  Good example`);
    lines.push(indent(rule.docs.goodExample, 4));
    lines.push("");
  }
  if (rule.docs.badExample) {
    lines.push(`  Bad example`);
    lines.push(indent(rule.docs.badExample, 4));
    lines.push("");
  }
  if (rule.docs.references.length > 0) {
    lines.push(`  References`);
    for (const ref of rule.docs.references) lines.push(`    - ${ref}`);
    lines.push("");
  }

  return { stdout: lines.join("\n"), stderr: "", exitCode: 0 };
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => `${pad}${line}`)
    .join("\n");
}
