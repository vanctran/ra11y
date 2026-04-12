/**
 * Minimal gitignore-style glob matcher.
 *
 * Supports the subset of gitignore patterns ra11y actually needs:
 *   - `*`     matches any run of non-slash characters
 *   - `**`    matches any run of characters including slashes
 *   - `?`     matches one non-slash character
 *   - leading `/` anchors to the root
 *   - trailing `/` matches a directory (and everything under it)
 *   - lines starting with `#` are comments
 *   - leading `!` (negation) is NOT supported — we only compose
 *     exclude lists; negation would complicate the contract with
 *     no clear use case in this codebase.
 *
 * Zero dependencies. The compiled matcher is a plain predicate so
 * callers can memoize or combine as needed.
 */

const REGEX_METACHARS = /[.+^$(){}|[\]\\]/;

/** Translates one pattern character (or `**` pair) into a regex fragment. */
function translateChar(trimmed: string, i: number): { readonly re: string; readonly next: number } {
  const c = trimmed[i] ?? "";
  if (c === "*" && trimmed[i + 1] === "*") {
    // "**" swallows slashes; if followed by "/", consume it so "**/foo"
    // matches "foo" at the root.
    const skipSlash = trimmed[i + 2] === "/" ? 1 : 0;
    return { re: ".*", next: i + 2 + skipSlash };
  }
  if (c === "*") return { re: "[^/]*", next: i + 1 };
  if (c === "?") return { re: "[^/]", next: i + 1 };
  if (REGEX_METACHARS.test(c)) return { re: `\\${c}`, next: i + 1 };
  return { re: c, next: i + 1 };
}

/** Converts a single gitignore pattern into a RegExp matching POSIX-style paths. */
function compilePattern(pattern: string): RegExp {
  const anchored = pattern.startsWith("/");
  const trimmed = pattern.replace(/^\//, "").replace(/\/$/, "");

  let re = "";
  let i = 0;
  while (i < trimmed.length) {
    const step = translateChar(trimmed, i);
    re += step.re;
    i = step.next;
  }

  // Anchoring: patterns with a slash (or a leading `/`) match from the root.
  // Bare patterns match at any depth — "foo" matches both "foo" and "bar/foo".
  const prefix = anchored || trimmed.includes("/") ? "^" : "(^|.*/)";
  return new RegExp(`${prefix}${re}(/.*)?$`);
}

export interface GlobMatcher {
  /** True if `relPath` (POSIX `/`-separated) matches any compiled pattern. */
  readonly matches: (relPath: string) => boolean;
}

/**
 * Compiles a list of gitignore-style patterns into a single matcher.
 * Empty lines and `#` comments are ignored. Whitespace is trimmed.
 */
export function compileGlobs(patterns: readonly string[]): GlobMatcher {
  const compiled: RegExp[] = [];
  for (const raw of patterns) {
    const p = raw.trim();
    if (p.length === 0) continue;
    if (p.startsWith("#")) continue;
    if (p.startsWith("!")) continue; // negation not supported
    compiled.push(compilePattern(p));
  }
  return {
    matches(relPath: string): boolean {
      for (const re of compiled) {
        if (re.test(relPath)) return true;
      }
      return false;
    },
  };
}
