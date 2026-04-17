/**
 * Rule runner.
 *
 * Invokes the rules that apply to a given file, wraps each invocation in
 * a try/catch (a crashing rule never crashes the scanner — it produces a
 * synthetic `internal/rule-crash` violation and the scan continues), and
 * stamps each emitted violation with its ruleId and cited criteria.
 *
 * See docs/kb/architecture/rule-engine.md.
 */

import type { EmittedViolation, Language, Rule } from "../types/rule.ts";
import type { Severity, Violation } from "../types/violation.ts";
import { computeFindingId } from "../utils/finding-id.ts";
import { extensionMatches } from "../utils/path.ts";
import { buildContext, type ContextInput } from "./context-builder.ts";
import type { StandardFilter } from "./standard-filter.ts";

/** Per-file input to the rule runner. */
export interface RuleRunnerInput extends ContextInput {
  readonly rules: readonly Rule[];
  readonly filter: StandardFilter;
}

/** Runs every applicable rule against the given file and returns violations. */
export function runRulesForFile(input: RuleRunnerInput): readonly Violation[] {
  const out: Violation[] = [];
  const language = input.ast.language as Language;
  const fileExt = extractExtension(input.filePath);

  for (const rule of input.rules) {
    if (!input.filter.isRuleActive(rule)) continue;
    if (!applies(rule, fileExt, language)) continue;
    runOneRule(rule, input, out);
  }

  return out;
}

/**
 * Executes one rule's lifecycle against the current file and stamps its
 * emitted violations into `out`. Isolated so the top-level runner stays
 * under the cognitive-complexity budget — no nested try/catch, no
 * per-rule local state leaking into the loop.
 */
function runOneRule(rule: Rule, input: RuleRunnerInput, out: Violation[]): void {
  const citedCriteria = input.filter.citedCriteria(rule);
  const citedCriteriaTitles = input.filter.citedCriteriaTitles(rule);
  const sink: EmittedViolation[] = [];
  const ctx = buildContext(input, sink);

  try {
    invokeLifecycle(rule, ctx, input.ast.root, sink);
  } catch (err) {
    out.push(ruleCrashViolation(rule.id, input.filePath, input.source, err));
    return;
  }

  for (const emitted of sink) {
    if (ctx.isDisabled(emitted.location.line, rule.id)) continue;
    out.push(
      stampViolation(
        emitted,
        rule.id,
        citedCriteria,
        citedCriteriaTitles,
        input.filePath,
        input.source,
      ),
    );
  }
}

/** Calls beforeFile → check → afterFile, pushing any returned arrays into the sink. */
function invokeLifecycle(
  rule: Rule,
  ctx: ReturnType<typeof buildContext>,
  astRoot: unknown,
  sink: EmittedViolation[],
): void {
  const fileCtx = { ...ctx, nodes: astRoot };
  rule.beforeFile?.(fileCtx);
  collectReturn(rule.check?.(ctx), sink);
  collectReturn(rule.afterFile?.(fileCtx), sink);
}

function collectReturn(maybe: readonly Violation[] | undefined, sink: EmittedViolation[]): void {
  if (Array.isArray(maybe)) {
    for (const v of maybe) sink.push(v);
  }
}

/**
 * Builds the final Violation record from the rule's emitted form.
 * Rules don't know their own file path — the engine owns that fact —
 * so we stamp it here. This also lets a rule emit with `filePath: ""`
 * as a placeholder without the formatter losing the filename downstream.
 */
function stampViolation(
  emitted: EmittedViolation,
  ruleId: string,
  criteria: readonly string[],
  criteriaTitles: readonly string[],
  filePath: string,
  source: string,
): Violation {
  const findingId = computeFindingId({ ruleId, filePath, source, line: emitted.location.line });
  return {
    ruleId,
    criteria,
    criteriaTitles,
    severity: emitted.severity,
    location: { ...emitted.location, filePath },
    message: emitted.message,
    findingId,
    ...(emitted.suggestion !== undefined && { suggestion: emitted.suggestion }),
    ...(emitted.fix !== undefined && { fix: emitted.fix }),
    ...(emitted.fixPaths !== undefined && { fixPaths: emitted.fixPaths }),
    ...(emitted.snippet !== undefined && { snippet: emitted.snippet }),
  };
}

function extractExtension(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  return dot === -1 ? "" : filePath.slice(dot);
}

function applies(rule: Rule, fileExt: string, _language: Language): boolean {
  const extensions = rule.appliesTo?.fileExtensions;
  if (!extensions || extensions.length === 0) return true;
  return extensionMatches(fileExt, extensions);
}

function ruleCrashViolation(
  ruleId: string,
  filePath: string,
  source: string,
  err: unknown,
): Violation {
  const message = err instanceof Error ? err.message : String(err);
  const errorSeverity: Severity = "error";
  const findingId = computeFindingId({
    ruleId: "internal/rule-crash",
    filePath,
    source,
    line: 1,
  });
  return {
    ruleId: "internal/rule-crash",
    criteria: [],
    severity: errorSeverity,
    location: { filePath, line: 1, column: 1 },
    message: `Rule '${ruleId}' crashed: ${message}`,
    suggestion: `This is a ra11y bug in rule '${ruleId}', not a problem with your code. Please file an issue with the stack trace if you can reproduce it.`,
    findingId,
  };
}
