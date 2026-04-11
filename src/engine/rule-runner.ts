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

import type { Language } from "../types/ast.ts";
import type { EmittedViolation, Rule } from "../types/rule.ts";
import type { Severity, Violation } from "../types/violation.ts";
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

    const citedCriteria = input.filter.citedCriteria(rule);
    const sink: EmittedViolation[] = [];
    const ctx = buildContext(input, sink);

    try {
      if (rule.beforeFile) {
        rule.beforeFile({ ...ctx, nodes: input.ast.root });
      }
      const nodeReturn = rule.check?.(ctx);
      if (Array.isArray(nodeReturn)) {
        for (const v of nodeReturn) sink.push(v);
      }
      const afterFileReturn = rule.afterFile?.({ ...ctx, nodes: input.ast.root });
      if (Array.isArray(afterFileReturn)) {
        for (const v of afterFileReturn) sink.push(v);
      }
    } catch (err) {
      out.push(ruleCrashViolation(rule.id, input.filePath, err));
      continue;
    }

    for (const emitted of sink) {
      // Respect inline disables before emission.
      if (ctx.isDisabled(emitted.location.line, rule.id)) continue;
      out.push({
        ruleId: rule.id,
        criteria: citedCriteria,
        severity: emitted.severity,
        location: emitted.location,
        message: emitted.message,
        ...(emitted.suggestion !== undefined && { suggestion: emitted.suggestion }),
        ...(emitted.fix !== undefined && { fix: emitted.fix }),
        ...(emitted.snippet !== undefined && { snippet: emitted.snippet }),
      });
    }
  }

  return out;
}

function extractExtension(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  return dot === -1 ? "" : filePath.slice(dot);
}

function applies(rule: Rule, fileExt: string, _language: Language): boolean {
  const extensions = rule.appliesTo?.fileExtensions;
  if (!extensions || extensions.length === 0) return true;
  return extensions.includes(fileExt);
}

function ruleCrashViolation(ruleId: string, filePath: string, err: unknown): Violation {
  const message = err instanceof Error ? err.message : String(err);
  const errorSeverity: Severity = "error";
  return {
    ruleId: "internal/rule-crash",
    criteria: [],
    severity: errorSeverity,
    location: { filePath, line: 1, column: 1 },
    message: `Rule '${ruleId}' crashed: ${message}`,
    suggestion: `This is a ra11y bug in rule '${ruleId}', not a problem with your code. Please file an issue with the stack trace if you can reproduce it.`,
  };
}
