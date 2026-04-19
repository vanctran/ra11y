/**
 * Tiny string-walking utilities shared by the TSX parser's auxiliary
 * passes. These are character-driven, regex-free, and zero-dep — same
 * ground rules as the main parser, just factored out of the main
 * tokenizer so the synthesis passes (Storybook args binding, future
 * passes) can reuse them without re-implementing string/template/
 * comment skipping.
 *
 * Nothing in this file knows about JSX or TSX — they're plain JS-string
 * primitives. They go here (rather than a generic util) so they can
 * stay private to the parser layer; if any other consumer ever needs
 * them, promote to `src/utils/` then.
 */
import type { SourcePosition } from "../../types/ast.ts";

/** Advance past a single- or double-quoted string. Returns offset just past the closing quote. */
export function skipQuoted(source: string, start: number, quote: '"' | "'"): number {
  let i = start + 1;
  while (i < source.length) {
    const c = source[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    i += 1;
  }
  return source.length;
}

/** Returns the offset of the closing quote, or -1 if unterminated. */
export function findQuoteClose(source: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < source.length) {
    const c = source[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === quote) return i;
    i += 1;
  }
  return -1;
}

/** Advance past a template literal. Returns offset just past the closing backtick. */
export function skipTemplate(source: string, start: number): number {
  let i = start + 1;
  while (i < source.length) {
    const c = source[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "`") return i + 1;
    i += 1;
  }
  return source.length;
}

/** Returns the offset of the closing backtick, or -1 if unterminated. */
export function findTemplateClose(source: string, start: number): number {
  let i = start + 1;
  while (i < source.length) {
    const c = source[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "`") return i;
    i += 1;
  }
  return -1;
}

/** Advance past `// …` to the next newline (or EOF). */
export function skipLineComment(source: string, start: number): number {
  let i = start + 2;
  while (i < source.length && source[i] !== "\n") i += 1;
  return i;
}

/** Advance past a `/* … *​/` block. Returns offset just past the closing `*​/`. */
export function skipBlockComment(source: string, start: number): number {
  let i = start + 2;
  while (i < source.length) {
    if (source[i] === "*" && source[i + 1] === "/") return i + 2;
    i += 1;
  }
  return source.length;
}

/** Advance past whitespace and `//` / `/​* *​/` comments. */
export function skipWhitespaceAndComments(source: string, start: number): number {
  let i = start;
  while (i < source.length) {
    const c = source[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i += 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      i = skipLineComment(source, i);
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      i = skipBlockComment(source, i);
      continue;
    }
    return i;
  }
  return i;
}

/**
 * If position `start` begins a string, template literal, line comment,
 * or block comment, returns the offset just past it. Returns -1
 * otherwise so the caller can fall through to its own logic.
 */
export function skipStringOrComment(source: string, start: number, c: string): number {
  if (c === '"' || c === "'") return skipQuoted(source, start, c);
  if (c === "`") return skipTemplate(source, start);
  if (c === "/" && source[start + 1] === "/") return skipLineComment(source, start);
  if (c === "/" && source[start + 1] === "*") return skipBlockComment(source, start);
  return -1;
}

export function isOpenBracket(c: string): boolean {
  return c === "{" || c === "[" || c === "(";
}

export function isCloseBracket(c: string): boolean {
  return c === "}" || c === "]" || c === ")";
}

export function isIdentifierStart(c: string | undefined): boolean {
  if (c === undefined) return false;
  return c === "_" || c === "$" || (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
}

export function isIdentifierPart(c: string | undefined): boolean {
  if (c === undefined) return false;
  return isIdentifierStart(c) || (c >= "0" && c <= "9");
}

/** Advances through identifier characters starting at `start`. */
export function afterIdentifier(source: string, start: number, limit: number): number {
  let i = start;
  while (i < limit && isIdentifierPart(source[i])) i += 1;
  return i;
}

/** Returns offset just past the matching `}`, or -1 if unbalanced. */
export function matchingBrace(source: string, openOffset: number): number {
  return matchingPair(source, openOffset, "{", "}");
}

/** Returns offset just past the matching `)`, or -1 if unbalanced. */
export function matchingParen(source: string, openOffset: number): number {
  return matchingPair(source, openOffset, "(", ")");
}

function matchingPair(source: string, openOffset: number, open: string, close: string): number {
  if (source[openOffset] !== open) return -1;
  let depth = 0;
  let i = openOffset;
  while (i < source.length) {
    const c = source[i];
    if (c === undefined) break;
    const skipped = skipStringOrComment(source, i, c);
    if (skipped !== -1) {
      i = skipped;
      continue;
    }
    if (c === open) {
      depth += 1;
      i += 1;
      continue;
    }
    if (c === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
      i += 1;
      continue;
    }
    i += 1;
  }
  return -1;
}

/** Minimal unescape for the common JS string escapes we expect in story args. */
export function unescapeString(raw: string): string {
  return raw
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\");
}

/**
 * Computes 1-based line + column for a given character offset by
 * counting newlines in the prefix. Used at synthesis assembly time
 * only, not in any hot loop, so the linear walk is fine.
 */
export function positionAt(source: string, offset: number): SourcePosition {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset && i < source.length; i += 1) {
    if (source[i] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column, offset };
}
