/**
 * Next-step prose builder for scan responses.
 *
 * Both `scan_project` and `scan_file` surface a `nextStep` string that
 * names the canonical next tool call for the agent — `suggest_fix` on a
 * concrete file:line when violations exist, `checklist` when the
 * automated half is clean but manual items remain, etc. Centralizing
 * the logic here keeps the two tools in exact lockstep (the whole
 * point of Track Q's parity fixes); a heuristic that diverges between
 * tools re-creates the shape-drift bug Track Q was opened to fix.
 *
 * The builder consumes `ScanFormatted` (the shared shape produced by
 * `runScanAndFormat`) plus a small set of caller-scoped toggles:
 *
 *   - `iterativeTip`: scan_project appends the branch-iteration hint on
 *     full scans only; scan_file passes `""` because a file-level scan
 *     has no scope dimension.
 *   - `singleFilePath`: when set, the clean-scan and notes branches
 *     name the file directly instead of pointing at `scan_file <path>`.
 *     Callers that don't have a single-file anchor omit this.
 */

import type { ScanFormatted } from "./tools-helpers.ts";

export interface NextStepOptions {
  /**
   * Appended to every generated line. scan_project sets this to the
   * branch-iteration hint on full scans; scan_file leaves it empty.
   */
  readonly iterativeTip?: string;
  /**
   * When provided, scan_file-style framing is used: clean-scan and
   * notes branches read as "you just scanned `<path>`; next call is X"
   * rather than "open `scan_file <path>` on the first finding." Also
   * switches the violations branch from `suggest_fix <path>:<line>`
   * verbatim (already correct) to the same prose with a scan_file
   * verify-loop tail when no fix suggestion is available.
   */
  readonly singleFilePath?: string;
}

interface NextStepInputs {
  readonly violations: number;
  readonly fixable: number;
  readonly actionableManual: number;
  readonly notes: number;
  readonly first: FirstFinding | null;
  readonly iterativeTip: string;
  readonly singleFilePath: string | null;
}

interface FirstFinding {
  readonly path: string;
  readonly line: number;
  readonly ruleId: string;
}

/**
 * Builds the prose `nextStep` hint for a scan response. Branches on
 * whether violations, notes, or neither are present, then picks a
 * concrete first call site from `formatted.files` when applicable.
 */
export function buildNextStep(formatted: ScanFormatted, options: NextStepOptions = {}): string {
  const inputs: NextStepInputs = {
    violations: numFromPlan(formatted.plan, "violations"),
    fixable: numFromPlan(formatted.plan, "fixSuggestionAvailable"),
    actionableManual: numFromPlan(formatted.plan, "actionableManualItems"),
    notes: numFromPlan(formatted.plan, "notes"),
    first: firstCallableFinding(formatted.files),
    iterativeTip: options.iterativeTip ?? "",
    singleFilePath: options.singleFilePath ?? null,
  };
  if (inputs.violations === 0 && inputs.notes === 0) return cleanScanNextStep(inputs);
  if (inputs.violations > 0 && inputs.first !== null)
    return violationNextStep(inputs, inputs.first);
  if (inputs.notes > 0 && inputs.first !== null) return notesNextStep(inputs, inputs.first);
  return `Use \`explain_rule\` on unclear findings, \`suggest_fix\` for a concrete patch, and \`scan_file\` to verify each file after editing.${inputs.iterativeTip}`;
}

function cleanScanNextStep(inputs: NextStepInputs): string {
  if (inputs.actionableManual > 0) {
    const pl = inputs.actionableManual === 1 ? "on has" : "a have";
    return `Automated checks clean; ${inputs.actionableManual} manual-review criteri${pl} grounded candidates. Call \`checklist\` next.${inputs.iterativeTip}`;
  }
  return `Automated checks clean. Call \`checklist\` for the manual-review half (criteria + grounded candidates).${inputs.iterativeTip} Pair with axe-core in Playwright/Vitest for runtime checks (focus traps, live regions, ARIA state, post-render contrast); do not claim "a11y clean" from this result alone.`;
}

function violationNextStep(inputs: NextStepInputs, first: FirstFinding): string {
  const vPlural = inputs.violations === 1 ? "" : "s";
  if (inputs.fixable > 0) {
    const fPlural = inputs.fixable === 1 ? "" : "s";
    return `${inputs.violations} violation${vPlural} (${inputs.fixable} with fix suggestion${fPlural}). Start with \`suggest_fix\` on ${first.path}:${first.line} (rule \`${first.ruleId}\`).${manualTail(inputs)}${inputs.iterativeTip}`;
  }
  return `${inputs.violations} violation${vPlural} with no machine-generated fix. Call \`explain_rule\` on \`${first.ruleId}\` and apply manually; verify with \`scan_file ${first.path}\` after editing.${inputs.iterativeTip}`;
}

function notesNextStep(inputs: NextStepInputs, first: FirstFinding): string {
  const nPlural = inputs.notes === 1 ? "" : "s";
  return `No errors/warnings, ${inputs.notes} info-level note${nPlural} (scanner flagged things it can't fully verify). Open \`scan_file ${first.path}\` or read the source to resolve.${manualTail(inputs)}${inputs.iterativeTip}`;
}

function manualTail(inputs: NextStepInputs): string {
  if (inputs.actionableManual <= 0) return "";
  const plural = inputs.actionableManual === 1 ? "" : "s";
  return ` Then \`checklist\` for the ${inputs.actionableManual} grounded manual-review item${plural}.`;
}

function numFromPlan(plan: Record<string, unknown>, key: string): number {
  const raw = plan[key];
  return typeof raw === "number" ? raw : 0;
}

/**
 * Pulls the first finding's (file, line, ruleId) from the sorted
 * `files` entries so the next-step hint can name a concrete call site.
 * Falls back to null when the response has no findings or the shape
 * doesn't expose the fields we want — the caller degrades to generic
 * text in that case.
 */
function firstCallableFinding(
  files: readonly { readonly path: string; readonly findings: unknown[] }[],
): FirstFinding | null {
  for (const file of files) {
    for (const raw of file.findings) {
      const extracted = readFindingRuleIdAndLine(raw);
      if (extracted !== null) return { path: file.path, ...extracted };
    }
  }
  return null;
}

function readFindingRuleIdAndLine(
  raw: unknown,
): { readonly ruleId: string; readonly line: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const ruleId = f["ruleId"];
  const line = f["line"];
  if (typeof ruleId !== "string" || typeof line !== "number") return null;
  return { ruleId, line };
}
