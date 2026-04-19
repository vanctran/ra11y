/**
 * Next-step builder for scan responses.
 *
 * Both `scan_project` and `scan_file` surface a `nextStep` string that
 * names the canonical next tool call for the agent — `suggest_fix` on a
 * concrete file:line when violations exist, `checklist` when the
 * automated half is clean but manual items remain, etc. Centralizing
 * the logic here keeps the two tools in exact lockstep (the whole
 * point of Track Q's parity fixes); a heuristic that diverges between
 * tools re-creates the shape-drift bug Track Q was opened to fix.
 *
 * The builder returns BOTH a prose `string` and a machine-readable
 * `structured` form `{ tool, args }` (P1-K). Agents that prefer
 * parse-free branching key off `structured`; weaker LLMs and human
 * log readers keep the prose. The two always describe the same call —
 * producing both from one pass guarantees they agree.
 *
 * When the prose degrades to a generic multi-option recommendation
 * (fallback branch, no concrete first finding to name), `structured`
 * is omitted per CLAUDE.md §1 "Ambiguous field shapes are dishonest"
 * — the caller conditional-spreads so the response shape carries
 * neither field rather than `nextStepStructured: null` or a fabricated
 * tool name.
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

/**
 * Machine-parseable next-call hint. `tool` is the canonical MCP tool
 * name (exactly what appears on `tools/list`); `args` uses the
 * canonical parameter names those tools accept — `file` not
 * `filePath` (per P2-R), `ruleId`, `line`. Never emit `args: {}` as a
 * sentinel for "missing args"; a tool that legitimately takes no
 * args (like `checklist` at its default paths) gets an empty object
 * honestly. Absence of a structured hint is signaled by omitting the
 * whole field at the response-assembly site, not by an empty value
 * here.
 */
export interface NextStepStructured {
  readonly tool: string;
  readonly args: Record<string, unknown>;
}

/**
 * Output of {@link buildNextStep}. `prose` is always present — it's
 * the English hint the response has carried since v0.1.0. `structured`
 * is the machine form naming the same call; omitted when the prose
 * falls back to generic multi-option advice (no concrete first
 * finding), so consumers conditional-spread it rather than ship an
 * ambiguous sentinel.
 */
export interface NextStepResult {
  readonly prose: string;
  readonly structured?: NextStepStructured;
}

interface NextStepInputs {
  readonly violations: number;
  readonly fixable: number;
  readonly actionableManual: number;
  readonly notes: number;
  readonly first: FirstFinding | null;
  readonly iterativeTip: string;
  readonly singleFilePath: string | null;
  /**
   * True when every violation-severity finding in `files` already
   * carries an inline `fixClass === "mechanical"` discriminator — i.e.
   * the rule emitted a mechanical primary rewrite with alternatives
   * and ambient snippet context at scan time. Under that condition,
   * re-nudging the agent to call `suggest_fix` is a redundant
   * round-trip (Q2R2-FIX-DEDUPE): the inline fix already has what
   * `suggest_fix` would return, so the violation branch drops the
   * `suggest_fix` tail from both `prose` and `structured`. Does NOT
   * fire when any violation's `fixClass` is `"guidance"`,
   * `"runtime-only"`, or `"verify-in-source"` — those still need the
   * round-trip. False when there are no violations at all (the flag
   * is irrelevant outside the violation branch).
   */
  readonly allViolationsMechanical: boolean;
}

interface FirstFinding {
  readonly path: string;
  readonly line: number;
  readonly ruleId: string;
}

/**
 * Builds the `nextStep` hint (prose + structured) for a scan
 * response. Branches on whether violations, notes, or neither are
 * present, then picks a concrete first call site from
 * `formatted.files` when applicable.
 *
 * Returns an object with:
 *   - `prose` — always present; the English recommendation agents
 *     and humans have been reading since v0.1.0.
 *   - `structured` — `{ tool, args }` form naming the same call.
 *     Omitted when the prose degrades to generic advice (no concrete
 *     first finding), so consumers conditional-spread it into the
 *     response rather than ship an ambiguous empty value.
 */
export function buildNextStep(
  formatted: ScanFormatted,
  options: NextStepOptions = {},
): NextStepResult {
  // After the P1-M + P1-H split, the plan no longer carries a
  // composite `fixSuggestionAvailable`. Sum the two honest top-level
  // counters (mechanical edits + prose-only guidance) so the prose
  // `(N with fix suggestions)` tail keeps reading correctly without
  // re-introducing the composite on the response.
  const inputs: NextStepInputs = {
    violations: numFromPlan(formatted.plan, "violations"),
    fixable:
      numFromPlan(formatted.plan, "mechanicalEditsAvailable") +
      numFromPlan(formatted.plan, "guidanceFixesAvailable"),
    actionableManual: numFromPlan(formatted.plan, "actionableManualItems"),
    notes: numFromPlan(formatted.plan, "notes"),
    first: firstCallableFinding(formatted.files),
    iterativeTip: options.iterativeTip ?? "",
    singleFilePath: options.singleFilePath ?? null,
    allViolationsMechanical: allViolationsMechanical(formatted.files),
  };
  if (inputs.violations === 0 && inputs.notes === 0) return cleanScanNextStep(inputs);
  if (inputs.violations > 0 && inputs.first !== null)
    return violationNextStep(inputs, inputs.first);
  if (inputs.notes > 0 && inputs.first !== null) return notesNextStep(inputs, inputs.first);
  // Fallback: the scan reports violations/notes but we couldn't pull
  // a concrete (file, line, ruleId) triple to name. The prose still
  // gives multi-option advice; the structured form is omitted because
  // picking any one of `explain_rule` / `suggest_fix` / `scan_file`
  // here would be a guess. Honest shape (CLAUDE.md §1): the caller
  // conditional-spreads and neither field ships.
  return {
    prose: `Use \`explain_rule\` on unclear findings, \`suggest_fix\` for a concrete patch, and \`scan_file\` to verify each file after editing.${inputs.iterativeTip}`,
  };
}

function cleanScanNextStep(inputs: NextStepInputs): NextStepResult {
  if (inputs.actionableManual > 0) {
    const pl = inputs.actionableManual === 1 ? "on has" : "a have";
    return {
      prose: `Automated checks clean; ${inputs.actionableManual} manual-review criteri${pl} grounded candidates. Call \`checklist\` next, then run the \`ra11y/triage\` prompt (via \`prompts/get\`) to batch-process the candidates.${inputs.iterativeTip}`,
      structured: { tool: "checklist", args: {} },
    };
  }
  return {
    prose: `Automated checks clean. Call \`checklist\` for the manual-review half (criteria + grounded candidates).${inputs.iterativeTip} Pair with axe-core in Playwright/Vitest for runtime checks (focus traps, live regions, ARIA state, post-render contrast); do not claim "a11y clean" from this result alone. For a full end-to-end conformance audit, use the \`ra11y/audit\` prompt (via \`prompts/get\`).`,
    structured: { tool: "checklist", args: {} },
  };
}

function violationNextStep(inputs: NextStepInputs, first: FirstFinding): NextStepResult {
  const vPlural = inputs.violations === 1 ? "" : "s";
  if (inputs.fixable > 0) {
    const fPlural = inputs.fixable === 1 ? "" : "s";
    // Q2R2-FIX-DEDUPE: when EVERY violation already carries
    // `fixClass === "mechanical"`, the inline fix on each finding has
    // the same payload `suggest_fix` would return (primary +
    // alternatives + source context). Re-nudging the agent to call
    // `suggest_fix` costs ~600 tokens per finding on tight fix loops
    // for no new signal. Trim both the prose and the structured hint
    // consistently — the pair is load-bearing (P1-K), so a
    // one-sided trim would re-create the exact drift P1-K closed.
    // The verify-after-fix surface (Q2-VERIFYCMD) is a separate
    // emission and stays. Mixed lanes (any non-mechanical violation)
    // keep the `suggest_fix` nudge — it's still useful for guidance /
    // verify-in-source / runtime-only findings that need the round-
    // trip.
    if (inputs.allViolationsMechanical) {
      return {
        prose: `${inputs.violations} violation${vPlural} (${inputs.fixable} with fix suggestion${fPlural}); every finding carries an inline mechanical fix — apply \`primary.edit\` directly from the finding. For the multi-finding fix workflow, use the \`ra11y/fix\` prompt (via \`prompts/get\`).${manualTail(inputs)}${inputs.iterativeTip}`,
      };
    }
    return {
      prose: `${inputs.violations} violation${vPlural} (${inputs.fixable} with fix suggestion${fPlural}). Start with \`suggest_fix\` on ${first.path}:${first.line} (rule \`${first.ruleId}\`). For the multi-finding fix workflow, use the \`ra11y/fix\` prompt (via \`prompts/get\`).${manualTail(inputs)}${inputs.iterativeTip}`,
      structured: {
        tool: "suggest_fix",
        args: { ruleId: first.ruleId, file: first.path, line: first.line },
      },
    };
  }
  return {
    prose: `${inputs.violations} violation${vPlural} with no machine-generated fix. Call \`explain_rule\` on \`${first.ruleId}\` and apply manually; verify with \`scan_file ${first.path}\` after editing.${inputs.iterativeTip}`,
    structured: { tool: "explain_rule", args: { ruleId: first.ruleId } },
  };
}

function notesNextStep(inputs: NextStepInputs, first: FirstFinding): NextStepResult {
  const nPlural = inputs.notes === 1 ? "" : "s";
  return {
    prose: `No errors/warnings, ${inputs.notes} info-level note${nPlural} (scanner flagged things it can't fully verify). Open \`scan_file ${first.path}\` or read the source to resolve.${manualTail(inputs)}${inputs.iterativeTip}`,
    structured: { tool: "scan_file", args: { file: first.path } },
  };
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

/**
 * Predicate for the Q2R2-FIX-DEDUPE trim: returns true when every
 * violation-severity finding (`severity === "error"` or `"warning"` —
 * info-level notes are excluded because they flow through a different
 * nextStep branch and `fixClass` isn't meaningful for them) already
 * carries `fixClass === "mechanical"`. Under that condition the inline
 * fix on every finding already has what `suggest_fix` would return
 * (primary + alternatives + ambient source context), so the "now call
 * `suggest_fix`" handoff in `nextStep`/`nextStepStructured` is a
 * redundant round-trip.
 *
 * Returns false when:
 *   - there are no violation-severity findings at all (the flag is
 *     irrelevant outside the violation branch — callers that reach it
 *     shouldn't act on the value);
 *   - ANY violation has a non-mechanical `fixClass` (`"guidance"`,
 *     `"runtime-only"`, `"verify-in-source"`) — those still need the
 *     `suggest_fix` round-trip, so the mixed case keeps the nudge;
 *   - a violation is missing `fixClass` entirely (synthetic / legacy
 *     shapes) — fail-closed so we never silently drop the nudge on a
 *     finding whose lane we can't confirm.
 */
function allViolationsMechanical(
  files: readonly { readonly path: string; readonly findings: unknown[] }[],
): boolean {
  let sawViolation = false;
  for (const file of files) {
    for (const raw of file.findings) {
      if (!raw || typeof raw !== "object") continue;
      const f = raw as Record<string, unknown>;
      const severity = f["severity"];
      if (severity !== "error" && severity !== "warning") continue;
      sawViolation = true;
      if (f["fixClass"] !== "mechanical") return false;
    }
  }
  return sawViolation;
}
