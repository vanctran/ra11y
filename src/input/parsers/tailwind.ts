/**
 * Tailwind class extractor — v0.0.x surface.
 *
 * Parses a `class` / `className` string into structured tokens so that
 * a11y rules (contrast, sizing, focus, motion) can reason about
 * utilities without a live Tailwind runtime. Zero dependencies; no
 * theme resolution (see `src/input/resolvers/theme.ts` for that).
 *
 * A single utility like `md:hover:!-bg-[rgb(0_0_0)]/50` decomposes into:
 *
 *   variants:       ["md", "hover"]
 *   important:      true
 *   negative:       true
 *   utility:        "bg"             // the leading key
 *   arbitraryValue: "rgb(0_0_0)"     // contents of [...] if present
 *   raw:            the original token
 *
 * Out of scope:
 *   - Resolving `bg-red-500` to `#ef4444`. Rules call the theme
 *     resolver for that, using `utility` + whatever follows.
 *   - Sorting / deduplication. Callers decide what to do with dupes.
 *   - Validating that a given utility actually exists. We are a
 *     syntactic parser, not a Tailwind config validator.
 *
 * The parser never throws. Malformed tokens (unclosed `[`, stray
 * characters) become tokens with a `malformed: true` flag so rules
 * can ignore or report them.
 */

export interface TailwindToken {
  /** Original source token, exactly as it appeared in the class string. */
  readonly raw: string;
  /** Variant chain in source order (e.g. ["md", "hover"]). */
  readonly variants: readonly string[];
  /** `!` important prefix was present. */
  readonly important: boolean;
  /** Leading `-` marking a negative utility (e.g. `-mt-2`). */
  readonly negative: boolean;
  /**
   * Utility portion after variants / prefixes, with any `[value]`
   * segment stripped. Modifier (after `/`) is also stripped — it's
   * reported separately in `modifier`.
   */
  readonly utility: string;
  /** Contents of `[...]` when the utility carries an arbitrary value. */
  readonly arbitraryValue: string | null;
  /**
   * Opacity / numeric modifier after `/`, if any. Examples:
   *   `bg-black/50`    → "50"
   *   `text-red-500/[.4]` → ".4"
   */
  readonly modifier: string | null;
  /** Parser couldn't make structural sense of this token. */
  readonly malformed: boolean;
}

/**
 * Split a Tailwind class string into structured tokens.
 *
 * Whitespace (spaces, tabs, newlines) separates tokens. Empty input
 * returns an empty array. Each non-empty token always produces exactly
 * one `TailwindToken`, even if malformed — rules get a complete view
 * of the source surface.
 */
export function parseTailwind(classString: string): TailwindToken[] {
  if (!classString) {
    return [];
  }
  const tokens: TailwindToken[] = [];
  for (const raw of splitTokens(classString)) {
    tokens.push(parseToken(raw));
  }
  return tokens;
}

/**
 * Whitespace-split a class string, but respect `[...]` regions —
 * Tailwind's arbitrary value syntax permits spaces inside, e.g.
 * `bg-[rgb(0 0 0)]`. Brackets can nest (e.g. `calc(…)` inside a
 * color function), and we treat an unmatched `]` as a literal.
 */
function splitTokens(source: string): string[] {
  const out: string[] = [];
  let buf = "";
  let depth = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source.charAt(i);
    if (ch === "[") {
      depth += 1;
      buf += ch;
      continue;
    }
    if (ch === "]") {
      if (depth > 0) depth -= 1;
      buf += ch;
      continue;
    }
    if (depth === 0 && isWhitespace(ch)) {
      if (buf.length > 0) {
        out.push(buf);
        buf = "";
      }
      continue;
    }
    buf += ch;
  }
  if (buf.length > 0) out.push(buf);
  return out;
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
}

/**
 * Parse a single whitespace-bounded token.
 *
 * The algorithm slices the string into four zones — variants,
 * important marker, utility body, modifier — then extracts any
 * `[arbitrary]` segment out of the utility body. Variant splitting
 * must respect bracketed regions because arbitrary variants exist
 * (`[&:nth-child(3)]:text-red-500`).
 */
function parseToken(raw: string): TailwindToken {
  const { variants, rest: afterVariants, malformed: variantsBad } = peelVariants(raw);
  if (variantsBad || afterVariants.length === 0) {
    return malformed(raw, variants);
  }

  const { important, rest: afterImportant } = peelImportant(afterVariants);
  if (afterImportant.length === 0) {
    return malformed(raw, variants);
  }

  const { negative, rest: afterNegative } = peelNegative(afterImportant);

  const bracket = extractArbitrary(afterNegative);
  const slice = extractModifier(bracket.body);

  let utility = slice.body;
  while (utility.endsWith("-")) utility = utility.slice(0, -1);

  const malformedFlag =
    bracket.malformed ||
    slice.malformed ||
    (utility.length === 0 && bracket.arbitraryValue === null);

  return {
    raw,
    variants,
    important,
    negative,
    utility,
    arbitraryValue: bracket.arbitraryValue,
    modifier: slice.modifier,
    malformed: malformedFlag,
  };
}

function peelVariants(raw: string): { variants: string[]; rest: string; malformed: boolean } {
  const variants: string[] = [];
  let rest = raw;
  while (true) {
    const colonAt = findTopLevelColon(rest);
    if (colonAt === -1) break;
    const head = rest.slice(0, colonAt);
    if (head.length === 0) {
      return { variants, rest, malformed: true };
    }
    variants.push(head);
    rest = rest.slice(colonAt + 1);
  }
  return { variants, rest, malformed: false };
}

function peelImportant(rest: string): { important: boolean; rest: string } {
  if (rest.charAt(0) === "!") {
    return { important: true, rest: rest.slice(1) };
  }
  return { important: false, rest };
}

/**
 * Tailwind writes `-mt-2` and `-translate-x-1/2`; a leading `-`
 * before the utility name means "negate the value". It must not be
 * confused with a lone `-` or with `--` (custom-property arbitrary
 * utility), so we require an ident/bracket to follow.
 */
function peelNegative(rest: string): { negative: boolean; rest: string } {
  if (rest.charAt(0) !== "-" || rest.length < 2) return { negative: false, rest };
  const next = rest.charAt(1);
  if (next === "-") return { negative: false, rest };
  if (isIdentStart(next) || next === "[") {
    return { negative: true, rest: rest.slice(1) };
  }
  return { negative: false, rest };
}

function extractArbitrary(rest: string): {
  body: string;
  arbitraryValue: string | null;
  malformed: boolean;
} {
  const bracketStart = rest.indexOf("[");
  if (bracketStart === -1) return { body: rest, arbitraryValue: null, malformed: false };
  const bracketEnd = findMatchingBracket(rest, bracketStart);
  if (bracketEnd === -1) {
    return {
      body: rest.slice(0, bracketStart),
      arbitraryValue: rest.slice(bracketStart + 1),
      malformed: true,
    };
  }
  return {
    body: rest.slice(0, bracketStart) + rest.slice(bracketEnd + 1),
    arbitraryValue: rest.slice(bracketStart + 1, bracketEnd),
    malformed: false,
  };
}

function extractModifier(body: string): {
  body: string;
  modifier: string | null;
  malformed: boolean;
} {
  const slashAt = body.indexOf("/");
  if (slashAt === -1) return { body, modifier: null, malformed: false };
  const modifier = body.slice(slashAt + 1);
  return {
    body: body.slice(0, slashAt),
    modifier,
    malformed: modifier.length === 0,
  };
}

function malformed(raw: string, variants: string[]): TailwindToken {
  return {
    raw,
    variants,
    important: false,
    negative: false,
    utility: "",
    arbitraryValue: null,
    modifier: null,
    malformed: true,
  };
}

function findTopLevelColon(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      if (depth > 0) depth -= 1;
    } else if (ch === ":" && depth === 0) {
      return i;
    }
  }
  return -1;
}

function findMatchingBracket(s: string, openAt: number): number {
  let depth = 0;
  for (let i = openAt; i < s.length; i++) {
    const ch = s[i];
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function isIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}
