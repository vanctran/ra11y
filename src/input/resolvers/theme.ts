/**
 * Tailwind theme resolver — maps a parsed `TailwindToken` to a concrete
 * CSS declaration (`property`, `value`) that downstream a11y rules
 * (contrast, reflow, target-size, focus-visibility) can reason about
 * without running Tailwind at build time.
 *
 * Ships with Tailwind's **default theme** inlined; no `tailwindcss`
 * dependency, no config file read. Canonical source for the default
 * theme values: https://tailwindcss.com/docs/theme and the published
 * `tailwindcss/stubs/defaultConfig.stub` — transcribed here verbatim
 * to preserve the zero-dep invariant.
 *
 * Scope is deliberately narrow: only utilities that affect automated
 * WCAG checks (sizing, color, spacing, typography, borders, opacity).
 * Unknown utilities return `null`; rules must handle the "unknown"
 * case rather than assuming resolution succeeded.
 *
 * TODO(phase-future): honour a user-supplied `tailwind.config.js` /
 * `tailwind.config.ts` via a separate loader that feeds a custom
 * theme into this resolver. For now, the default theme is the whole
 * world.
 */

import { parseTailwind, type TailwindToken } from "../parsers/tailwind.ts";

/** A resolved CSS declaration. `value` is always a string for uniformity. */
export interface ResolvedDeclaration {
  readonly property: string;
  readonly value: string;
}

/**
 * Resolve a single Tailwind token to a concrete CSS declaration.
 * Returns `null` when the utility is unknown, malformed, or outside
 * the resolver's scope — callers treat that as "unresolved".
 *
 * Variants are ignored here: they're selector decorators (`md:`,
 * `hover:`) handled by the parser. The resolver operates on the
 * naked utility portion.
 */
export function resolveTailwindToken(token: TailwindToken): ResolvedDeclaration | null {
  if (token.malformed) return null;
  // Implementation added in a follow-up slice.
  return null;
}

/**
 * Convenience: parse + resolve in one step. Unresolved tokens are
 * skipped — callers that need the raw token list should call
 * `parseTailwind` directly.
 */
export function resolveTailwindClasses(classString: string): ResolvedDeclaration[] {
  const out: ResolvedDeclaration[] = [];
  for (const token of parseTailwind(classString)) {
    const resolved = resolveTailwindToken(token);
    if (resolved !== null) out.push(resolved);
  }
  return out;
}
