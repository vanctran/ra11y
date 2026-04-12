/**
 * Builds per-file RuleContext objects consumed by rules.
 *
 * The engine calls `buildContext()` once per parsed file, passing in the
 * file path, source, parsed AST, and enabled standards. Rules receive a
 * narrow, read-only view that lets them emit violations and check inline
 * disable pragmas. Cross-rule state is intentionally not exposed — rules
 * are pure functions that see exactly what they need.
 */

import type { Ast } from "../types/ast.ts";
import type { EmittedViolation, Language, RuleContext } from "../types/rule.ts";

export interface ContextInput {
  readonly filePath: string;
  readonly source: string;
  readonly ast: Ast;
  readonly enabledStandards: ReadonlySet<string>;
  readonly disableMap: ReadonlyMap<number, ReadonlySet<string>>;
}

/** Builds a fresh RuleContext. The returned object's `emit` pushes into the supplied array. */
export function buildContext(input: ContextInput, violationSink: EmittedViolation[]): RuleContext {
  const language = input.ast.language as Language;
  return {
    filePath: input.filePath,
    source: input.source,
    language,
    ast: input.ast.root,
    enabledStandards: input.enabledStandards,
    emit(violation: EmittedViolation): void {
      violationSink.push(violation);
    },
    isDisabled(line: number, ruleId: string): boolean {
      const disabled = input.disableMap.get(line);
      if (!disabled) return false;
      // Either an exact rule-id match or a wildcard entry for "disable all".
      return disabled.has(ruleId) || disabled.has("*");
    },
  };
}
