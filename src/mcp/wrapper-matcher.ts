/**
 * Wrapper-name matcher supporting literal names and simple `*` globs.
 *
 * The `nativeWrappers` config is a list of PascalCase component names
 * (legacy) or a name→element map (Q2-WRAPMAP). Either shape's keys
 * accept `*` as a wildcard — `*Button` matches `IconButton` / `BigButton`,
 * `Icon*` matches `IconButton` / `IconImage`, `*Card*` matches anything
 * containing `Card`. Exact names (`Button`) keep their literal semantics.
 *
 * Only `*` is recognized. No `?`, no `[abc]`, no `!` negation — the goal
 * is design-system-family matching, not shell-grade glob. Anything else
 * in the pattern (including regex metacharacters) is treated as literal.
 */

const WILDCARD = "*";

/** True when the pattern contains at least one `*`. */
export function isGlobWrapperPattern(pattern: string): boolean {
  return pattern.includes(WILDCARD);
}

/** Matches a single name against a single pattern (glob or literal). */
export function matchesWrapperPattern(name: string, pattern: string): boolean {
  if (!isGlobWrapperPattern(pattern)) return name === pattern;
  return globToRegex(pattern).test(name);
}

/** True when any pattern in the list matches the given name. */
export function nameMatchesAnyWrapper(name: string, patterns: readonly string[]): boolean {
  for (const pattern of patterns) {
    if (matchesWrapperPattern(name, pattern)) return true;
  }
  return false;
}

/**
 * Builds a regex suitable for source-text search that finds `<Name` /
 * `<IconButton` where `Name` matches the given pattern. The caller is
 * responsible for the trailing boundary assertion (e.g. `(?=[\\s/>])`)
 * — this helper only produces the body.
 */
export function wrapperPatternToTagRegexSource(pattern: string): string {
  if (!isGlobWrapperPattern(pattern)) return escapeRegex(pattern);
  return pattern.split(WILDCARD).map(escapeRegex).join("[A-Za-z0-9]*");
}

function globToRegex(pattern: string): RegExp {
  const body = pattern.split(WILDCARD).map(escapeRegex).join("[A-Za-z0-9]*");
  return new RegExp(`^${body}$`);
}

function escapeRegex(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}
