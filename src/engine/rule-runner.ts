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

import type { Ast } from "../types/ast.ts";
import type { EmittedViolation, FixClass, Language, Rule } from "../types/rule.ts";
import type { Severity, Violation } from "../types/violation.ts";
import { computeFindingId } from "../utils/finding-id.ts";
import { computeGroupKey, UNKNOWN_SHAPE } from "../utils/group-key.ts";
import { extensionMatches } from "../utils/path.ts";
import { describeNodeShape, findTargetNodeAtLocation } from "./ast-helpers.ts";
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
        rule.fixClass,
        input.filePath,
        input.source,
        input.ast,
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
 *
 * Also stamps `findingId` (stable cross-run identity) and `groupKey`
 * (stable cross-finding grouping by rule + normalized AST shape — see
 * docs/adr/0008-violation-group-key.md). The AST root is threaded
 * through so the engine can resolve the target node at the emitted
 * location; rules never compute either token themselves.
 */
function stampViolation(
  emitted: EmittedViolation,
  ruleId: string,
  criteria: readonly string[],
  criteriaTitles: readonly string[],
  fixClass: FixClass,
  filePath: string,
  source: string,
  ast: Ast,
): Violation {
  const findingId = computeFindingId({ ruleId, filePath, source, line: emitted.location.line });
  const groupKey = computeGroupKey({
    ruleId,
    shape: shapeAtLocation(ast, emitted.location.line, emitted.location.column),
  });
  return {
    ruleId,
    fixClass,
    criteria,
    criteriaTitles,
    severity: emitted.severity,
    location: { ...emitted.location, filePath },
    message: emitted.message,
    findingId,
    groupKey,
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

/**
 * Resolves the target node at the given emitted `(line, column)` and
 * describes it. When no node covers the location (synthetic emits,
 * project-scope rules that point at a placeholder), returns
 * `UNKNOWN_SHAPE` so every such emission under a single rule groups
 * into one "un-groupable" bucket — honest, deterministic, and never
 * throws. See docs/adr/0008-violation-group-key.md.
 */
function shapeAtLocation(ast: Ast, line: number, column: number): string {
  const node = findTargetNodeAtLocation(ast.root, line, column);
  return node ? describeNodeShape(node) : UNKNOWN_SHAPE;
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
  // Synthetic crashes have no target node — group every crash record
  // per-ruleId into one bucket (the "un-groupable" shape) so agents
  // can still batch-triage "all crashes from rule X" if they want.
  const groupKey = computeGroupKey({ ruleId: "internal/rule-crash", shape: UNKNOWN_SHAPE });
  return {
    ruleId: "internal/rule-crash",
    // Synthetic crash reports route into the verify-in-source lane:
    // the agent reads the stack trace and the failing rule's source
    // to decide next steps. There is no deterministic edit, no prose
    // remediation, and no runtime harness that applies — this is a
    // ra11y bug, not a user a11y issue.
    fixClass: "verify-in-source",
    criteria: [],
    severity: errorSeverity,
    location: { filePath, line: 1, column: 1 },
    message: `Rule '${ruleId}' crashed: ${message}`,
    suggestion: `This is a ra11y bug in rule '${ruleId}', not a problem with your code. Please file an issue with the stack trace if you can reproduce it.`,
    findingId,
    groupKey,
  };
}
