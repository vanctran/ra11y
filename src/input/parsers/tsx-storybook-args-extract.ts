/**
 * Args-extraction pass for the Storybook synthesis module. Walks a
 * `StoryObj` declarator's body, finds the top-level `args: { … }`
 * property, and extracts every literal key-value pair as
 * {@link ExtractedArg}. Returns null on any unsupported construct
 * (spread, computed key, identifier-reference value, callback,
 * dynamic template) so the caller can abandon synthesis for the
 * whole story rather than emit a partially-known element.
 *
 * Honest absence over confident wrongness — fabricating an attribute
 * value from a non-literal would surface phantom references the
 * agent can't verify against the source. This is the same trade-off
 * the rest of the parser makes (Expression-kind attributes are
 * passed through unchanged); we just refuse to invent a value.
 */
import {
  afterIdentifier,
  findQuoteClose,
  findTemplateClose,
  isCloseBracket,
  isIdentifierStart,
  isOpenBracket,
  matchingBrace,
  matchingParen,
  positionAt,
  skipStringOrComment,
  skipWhitespaceAndComments,
  unescapeString,
} from "./_string-walk.ts";

/** A single key-value pair extracted from a literal `args: { … }`. */
export interface ExtractedArg {
  readonly name: string;
  readonly value: ExtractedArgValue;
  /** 1-based source line of the property — used as the synthesized element's loc. */
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

export type ExtractedArgValue =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "expression"; readonly raw: string };

/**
 * Locates the `args: { … }` property inside the story declarator's
 * body and extracts every literal property. Returns null when:
 *  - no `args:` property is present;
 *  - the args value isn't an object literal;
 *  - the args object contains a spread (`...defaults`);
 *  - the args object contains a computed key (`["dy" + namic]: …`);
 *  - any args value is a function call (other than the literal-array
 *    construction we explicitly walk) or an identifier reference we
 *    can't pin to a literal.
 */
export function extractLiteralArgs(
  source: string,
  bodyStart: number,
  bodyEnd: number,
): readonly ExtractedArg[] | null {
  // `args` must be a top-level property of the body. Nested `args`
  // (e.g. inside `parameters: { … }`) does not count.
  const argsLoc = findTopLevelProperty(source, bodyStart, bodyEnd, "args");
  if (!argsLoc) return null;
  // The args value must itself be an object literal — `{`.
  const valueStart = skipWhitespaceAndComments(source, argsLoc.valueStart);
  if (source[valueStart] !== "{") return null;
  const argsBraceEnd = matchingBrace(source, valueStart);
  if (argsBraceEnd === -1) return null;
  return extractObjectProperties(source, valueStart, argsBraceEnd);
}

/**
 * Finds a top-level (depth-0 within the surrounding braces) property
 * with the given key. Returns the offset just past the `:` so the
 * caller can read the value. Skips strings, templates, comments, and
 * nested braces/brackets/parens. Property keys may be bare identifiers
 * or single/double-quoted strings; computed (`[expr]`) keys are
 * deliberately not supported.
 */
function findTopLevelProperty(
  source: string,
  bodyStart: number,
  bodyEnd: number,
  key: string,
): { readonly valueStart: number } | null {
  let i = bodyStart + 1;
  let depth = 0;
  while (i < bodyEnd) {
    const c = source[i];
    if (c === undefined) break;
    const skipped = skipStringOrComment(source, i, c);
    if (skipped !== -1) {
      i = skipped;
      continue;
    }
    if (isOpenBracket(c)) {
      depth += 1;
      i += 1;
      continue;
    }
    if (isCloseBracket(c)) {
      depth -= 1;
      i += 1;
      continue;
    }
    if (depth === 0 && isIdentifierStart(c)) {
      const valueStart = matchPropertyKey(source, i, bodyEnd, key);
      if (valueStart !== null) return { valueStart };
      i = afterIdentifier(source, i, bodyEnd);
      continue;
    }
    i += 1;
  }
  return null;
}

/**
 * If `source[idStart]` begins an identifier (which it does — the
 * caller already classified the position), and that identifier is
 * followed by `:` (after optional `?` + whitespace), and equals
 * `key`, returns the offset just past the colon. Returns null when
 * the identifier is present but isn't the target key.
 */
function matchPropertyKey(
  source: string,
  idStart: number,
  limit: number,
  key: string,
): number | null {
  const idEnd = afterIdentifier(source, idStart, limit);
  const ident = source.slice(idStart, idEnd);
  let j = skipWhitespaceAndComments(source, idEnd);
  if (source[j] === "?") j = skipWhitespaceAndComments(source, j + 1);
  if (source[j] === ":" && ident === key) return j + 1;
  return null;
}

/**
 * Walks a `{ key: value, key2: value2 }` object literal and returns
 * every literal property. Returns null on any unsupported construct
 * (spread, computed key, identifier value, template literal with
 * substitutions, function call). The caller then abandons synthesis.
 */
function extractObjectProperties(
  source: string,
  braceStart: number,
  braceEnd: number,
): readonly ExtractedArg[] | null {
  const out: ExtractedArg[] = [];
  // braceStart points at `{`; braceEnd is just past the matching `}`.
  let i = braceStart + 1;
  const inside = braceEnd - 1;
  while (i < inside) {
    i = skipWhitespaceAndComments(source, i);
    if (i >= inside) break;
    if (source[i] === ",") {
      i += 1;
      continue;
    }
    if (isUnsupportedKey(source, i)) return null;
    const property = readObjectProperty(source, i, inside, braceEnd);
    if (!property) return null;
    out.push(property.arg);
    i = property.next;
  }
  return out;
}

/** True at the start of a spread (`...`) or computed key (`[`). */
function isUnsupportedKey(source: string, i: number): boolean {
  if (source[i] === "[") return true;
  if (source[i] === "." && source[i + 1] === "." && source[i + 2] === ".") return true;
  return false;
}

/**
 * Reads one `key: value` property out of an object literal. Returns
 * the extracted arg + next-position. Null on unsupported shapes (no
 * key, missing colon, callback or unresolvable value).
 */
function readObjectProperty(
  source: string,
  start: number,
  inside: number,
  braceEnd: number,
): { readonly arg: ExtractedArg; readonly next: number } | null {
  const propStart = start;
  const keyResult = readPropertyKey(source, start, inside);
  if (!keyResult) return null;
  let i = skipWhitespaceAndComments(source, keyResult.next);
  if (source[i] === "?") i = skipWhitespaceAndComments(source, i + 1);
  if (source[i] !== ":") return null;
  i = skipWhitespaceAndComments(source, i + 1);
  const valueResult = readArgValue(source, i, braceEnd);
  if (!valueResult) return null;
  const pos = positionAt(source, propStart);
  return {
    arg: {
      name: keyResult.key,
      value: valueResult.value,
      line: pos.line,
      column: pos.column,
      offset: propStart,
    },
    next: valueResult.next,
  };
}

/**
 * Reads an identifier or quoted property key starting at `start`.
 * Returns the parsed key + the offset just past the closing quote /
 * end of identifier. Returns null when no key is present.
 */
function readPropertyKey(
  source: string,
  start: number,
  inside: number,
): { readonly key: string; readonly next: number } | null {
  const c = source[start];
  if (c === '"' || c === "'") {
    const closeIdx = findQuoteClose(source, start, c);
    if (closeIdx === -1) return null;
    return { key: source.slice(start + 1, closeIdx), next: closeIdx + 1 };
  }
  if (c !== undefined && isIdentifierStart(c)) {
    const end = afterIdentifier(source, start, inside);
    return { key: source.slice(start, end), next: end };
  }
  return null;
}

/**
 * Reads one property's value. Returns the parsed value + the index of
 * the next character to read (after the value, before any trailing
 * comma). Null on unsupported constructs.
 */
function readArgValue(
  source: string,
  start: number,
  limit: number,
): { readonly value: ExtractedArgValue; readonly next: number } | null {
  const c = source[start];
  if (c === undefined) return null;
  if (c === '"' || c === "'") {
    const close = findQuoteClose(source, start, c);
    if (close === -1) return null;
    return {
      value: { kind: "string", value: unescapeString(source.slice(start + 1, close)) },
      next: close + 1,
    };
  }
  if (c === "`") {
    const close = findTemplateClose(source, start);
    if (close === -1) return null;
    const raw = source.slice(start + 1, close);
    if (raw.includes("${")) return null; // dynamic template — skip
    return {
      value: { kind: "string", value: unescapeString(raw) },
      next: close + 1,
    };
  }
  // Numbers / booleans / null / arrays / objects pass through as
  // expression-kind so downstream attribute inspectors keep the
  // literal form. Callbacks are rejected — render fns aren't
  // resolvable.
  if (isCallbackStart(source, start)) return null;
  const next = scanLiteralExpression(source, start, limit);
  if (next === -1) return null;
  const raw = source.slice(start, next).trim();
  if (raw.length === 0) return null;
  if (!isAcceptableExpression(raw)) return null;
  return { value: { kind: "expression", raw }, next };
}

/**
 * True when the value position starts a callback — `() => …`,
 * `(x) => …`, `function …`, or just `function(`.
 */
function isCallbackStart(source: string, start: number): boolean {
  if (source.startsWith("function", start)) return true;
  if (source[start] !== "(") return false;
  const close = matchingParen(source, start);
  if (close === -1) return false;
  let i = close + 1;
  while (source[i] === " " || source[i] === "\t") i += 1;
  return source[i] === "=" && source[i + 1] === ">";
}

/**
 * Final guard against accidentally flagging an identifier reference
 * (`onClick: handleClick`) or a call expression (`label: getLabel()`)
 * as a literal expression value. The expression must be one of:
 * number, boolean, null, undefined, array literal, or object literal.
 */
function isAcceptableExpression(raw: string): boolean {
  if (raw === "true" || raw === "false" || raw === "null" || raw === "undefined") return true;
  if (/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw)) return true;
  if (raw.startsWith("[") && raw.endsWith("]")) return true;
  if (raw.startsWith("{") && raw.endsWith("}")) return true;
  return false;
}

/**
 * Walks one literal expression and returns the index just past its
 * end. Handles balanced braces/brackets/parens, strings, and
 * templates. Returns -1 on unterminated strings/templates or when
 * the loop ran off the end of the property's region without seeing a
 * terminator.
 */
function scanLiteralExpression(source: string, start: number, limit: number): number {
  const cursor: ScanCursor = { i: start, depth: 0 };
  while (cursor.i < limit) {
    const result = stepLiteralExpression(source, cursor);
    if (result !== null) return result;
  }
  return cursor.depth === 0 ? cursor.i : -1;
}

interface ScanCursor {
  i: number;
  depth: number;
}

/**
 * One iteration of {@link scanLiteralExpression}'s loop. Returns the
 * terminating offset when the value ends here (top-level `,` or
 * unbalanced close bracket); -1 on unterminated strings/templates;
 * null when the loop should continue (cursor advanced in place).
 */
function stepLiteralExpression(source: string, cursor: ScanCursor): number | null {
  const c = source[cursor.i];
  if (c === undefined) return -1;
  const skipped = skipStringTerminating(source, cursor.i, c);
  if (skipped === -1) return -1;
  if (skipped !== 0) {
    cursor.i += skipped;
    return null;
  }
  if (isOpenBracket(c)) {
    cursor.depth += 1;
    cursor.i += 1;
    return null;
  }
  if (isCloseBracket(c)) {
    if (cursor.depth === 0) return cursor.i;
    cursor.depth -= 1;
    cursor.i += 1;
    return null;
  }
  if (cursor.depth === 0 && c === ",") return cursor.i;
  cursor.i += 1;
  return null;
}

/**
 * If position `start` begins a string or template literal, returns
 * the number of characters to advance past it (always > 0). -1 when
 * unterminated (caller should abandon). 0 when there's no string at
 * this position.
 */
function skipStringTerminating(source: string, start: number, c: string): number {
  if (c === '"' || c === "'") {
    const close = findQuoteClose(source, start, c);
    if (close === -1) return -1;
    return close + 1 - start;
  }
  if (c === "`") {
    const close = findTemplateClose(source, start);
    if (close === -1) return -1;
    return close + 1 - start;
  }
  return 0;
}
