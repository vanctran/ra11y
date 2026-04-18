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
  /**
   * Resolved `LoadedConfig.nativeWrapperElements` passed through from the
   * scan-level config — wrapper component name → native element tag
   * (`{ Button: "button", Link: "a" }`). Empty or absent when the user
   * supplied only the string-array form or no `nativeWrappers` at all.
   * Per-rule access is via {@link RuleContext.wrappersForElement}, filtered
   * against the rule's `wrapperTreatsAsElement` target.
   */
  readonly nativeWrapperElements?: Readonly<Record<string, string>>;
}

/**
 * Builds a fresh RuleContext. The returned object's `emit` pushes into
 * the supplied array. `wrapperTreatsAsElement` is the per-rule opt-in
 * tag (`"a"`, `"img"`, `"input"`) — when set, the resulting context's
 * `wrappersForElement` carries the wrapper component names whose
 * `nativeWrapperElements` mapping targets that tag. When unset, the set
 * is always empty and the rule sees identical behaviour to pre-Q2-WRAPMAP-RULES.
 */
export function buildContext(
  input: ContextInput,
  violationSink: EmittedViolation[],
  wrapperTreatsAsElement?: string,
): RuleContext {
  const language = input.ast.language as Language;
  const wrappersForElement = resolveWrappersForElement(
    input.nativeWrapperElements,
    wrapperTreatsAsElement,
  );
  return {
    filePath: input.filePath,
    source: input.source,
    language,
    ast: input.ast.root,
    enabledStandards: input.enabledStandards,
    wrappersForElement,
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

/**
 * Filters the full `nativeWrapperElements` map down to wrapper component
 * names whose mapped native tag equals the rule's opted-in tag. Returns
 * an empty set when no opt-in was declared, no map was supplied, or no
 * entry matches — rules that don't opt in see the same shape as before
 * the mapping config was added.
 */
function resolveWrappersForElement(
  map: Readonly<Record<string, string>> | undefined,
  wrapperTreatsAsElement: string | undefined,
): ReadonlySet<string> {
  if (!(wrapperTreatsAsElement && map)) return EMPTY_WRAPPER_SET;
  const target = wrapperTreatsAsElement.toLowerCase();
  const matched = new Set<string>();
  for (const [name, element] of Object.entries(map)) {
    if (element.toLowerCase() === target) matched.add(name);
  }
  return matched.size === 0 ? EMPTY_WRAPPER_SET : matched;
}

/** Shared empty set — avoids allocating an unused `Set` per rule/file. */
const EMPTY_WRAPPER_SET: ReadonlySet<string> = new Set<string>();
