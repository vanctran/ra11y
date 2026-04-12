/**
 * In-house CSS parser — v0.0.x surface.
 *
 * A minimal, error-recovering CSS tokenizer + tree builder producing
 * the CSS AST defined in src/types/ast.ts. Handles the subset ra11y's
 * rules need:
 *
 *   - standalone .css files and <style> tag contents
 *   - qualified rules (selector { decl; decl; })
 *   - at-rules (@media, @supports, @import, @keyframes, @font-face)
 *     including nested blocks
 *   - declarations (property: value !important?)
 *   - comments (/* ... *\/)
 *
 * Out of scope for v0.0.x: Sass/SCSS nesting, PostCSS plugin syntax,
 * custom property `--name` validation, complex selector parsing
 * (selectors are captured as raw strings and rules compose their own
 * selector logic when needed).
 *
 * Like the HTML parser, we never throw. Malformed input returns a
 * partial AST plus `ParseError[]`. Progress guarantees at every
 * loop to prevent infinite-loop crashes on garbage input.
 */

import type {
  CssAtRule,
  CssComment,
  CssDeclaration,
  CssNode,
  CssRule,
  CssStylesheet,
  ParseError,
  SourcePosition,
  SourceRange,
} from "../../types/ast.ts";

export interface CssParseResult {
  readonly root: CssStylesheet;
  readonly errors: readonly ParseError[];
}

export function parseCss(source: string): CssParseResult {
  return new CssParser(source).parse();
}

class CssParser {
  #source: string;
  #pos = 0;
  // Line/column tracked incrementally — see HtmlParser for the why.
  #line = 1;
  #col = 1;
  #errors: ParseError[] = [];

  constructor(source: string) {
    this.#source = source;
  }

  parse(): CssParseResult {
    const startPos = this.#position();
    const rules: CssNode[] = [];
    while (!this.#eof()) {
      const before = this.#pos;
      const node = this.#consumeTopLevelNode();
      if (node) rules.push(node);
      if (this.#pos === before) this.#advance(1); // progress guarantee
    }
    const endPos = this.#position();
    return {
      root: {
        kind: "CssStylesheet",
        range: { start: 0, end: this.#source.length },
        loc: { start: startPos, end: endPos },
        rules,
      },
      errors: this.#errors,
    };
  }

  #consumeTopLevelNode(): CssNode | null {
    this.#skipWhitespace();
    if (this.#eof()) return null;
    if (this.#startsWith("/*")) return this.#consumeComment();
    if (this.#peek() === "@") return this.#consumeAtRule();
    return this.#consumeQualifiedRule();
  }

  // ---------------------------------------------------------------------
  // Comments
  // ---------------------------------------------------------------------

  #consumeComment(): CssComment {
    const start = this.#pos;
    const startPos = this.#position();
    this.#advance(2); // "/*"
    const valueStart = this.#pos;
    while (!this.#eof()) {
      if (this.#peek() === "*" && this.#peek(1) === "/") break;
      this.#advance(1);
    }
    const value = this.#source.slice(valueStart, this.#pos);
    if (!this.#eof()) this.#advance(2); // "*/"
    return {
      kind: "CssComment",
      range: this.#range(start),
      loc: { start: startPos, end: this.#position() },
      value,
    };
  }

  // ---------------------------------------------------------------------
  // At-rules
  // ---------------------------------------------------------------------

  #consumeAtRule(): CssAtRule {
    const start = this.#pos;
    const startPos = this.#position();
    this.#advance(1); // "@"
    const name = this.#readIdentifier();
    const params = this.#readAtRuleParams();
    const children: CssNode[] = this.#peek() === "{" ? this.#consumeBlockBody() : [];
    if (this.#peek() === ";") this.#advance(1);
    return {
      kind: "CssAtRule",
      range: this.#range(start),
      loc: { start: startPos, end: this.#position() },
      name,
      params,
      children,
    };
  }

  /** Reads the prelude between an at-rule name and its `{` or `;`. */
  #readAtRuleParams(): string {
    const start = this.#pos;
    while (!this.#eof()) {
      const c = this.#peek();
      if (c === "{" || c === ";") break;
      this.#advance(1);
    }
    return this.#source.slice(start, this.#pos).trim();
  }

  /** Consumes a `{ ... }` block body as a list of nested nodes. */
  #consumeBlockBody(): CssNode[] {
    const children: CssNode[] = [];
    if (this.#peek() !== "{") return children;
    this.#advance(1); // "{"
    while (!this.#eof()) {
      this.#skipWhitespace();
      if (this.#peek() === "}") {
        this.#advance(1);
        return children;
      }
      const before = this.#pos;
      const node = this.#consumeTopLevelNode();
      if (node) children.push(node);
      if (this.#pos === before) this.#advance(1);
    }
    this.#errors.push({
      message: "Unclosed CSS block",
      position: this.#position(),
      recoverable: true,
    });
    return children;
  }

  // ---------------------------------------------------------------------
  // Qualified rules (selector { declarations })
  // ---------------------------------------------------------------------

  #consumeQualifiedRule(): CssRule | null {
    const start = this.#pos;
    const startPos = this.#position();
    const selector = this.#readSelector();
    if (selector.length === 0) {
      this.#advance(1); // progress guarantee
      return null;
    }
    const declarations = this.#consumeDeclarationBlock();
    return {
      kind: "CssRule",
      range: this.#range(start),
      loc: { start: startPos, end: this.#position() },
      selector: selector.trim(),
      declarations,
    };
  }

  /** Reads a selector up to the opening `{` (or `;`, `}`, EOF — error recovery). */
  #readSelector(): string {
    const start = this.#pos;
    let braceDepth = 0;
    while (!this.#eof()) {
      const c = this.#peek();
      if (c === "(") braceDepth += 1;
      else if (c === ")") braceDepth = Math.max(0, braceDepth - 1);
      else if (c === "{" && braceDepth === 0) break;
      else if (c === "}" && braceDepth === 0) break;
      else if (c === ";" && braceDepth === 0) break;
      this.#advance(1);
    }
    return this.#source.slice(start, this.#pos);
  }

  /** Consumes `{ prop: value; prop: value; }` into CssDeclaration[]. */
  #consumeDeclarationBlock(): CssDeclaration[] {
    const declarations: CssDeclaration[] = [];
    if (this.#peek() !== "{") return declarations;
    this.#advance(1);
    while (!this.#eof()) {
      this.#skipWhitespaceAndComments();
      if (this.#peek() === "}") {
        this.#advance(1);
        return declarations;
      }
      const before = this.#pos;
      const decl = this.#consumeDeclaration();
      if (decl) declarations.push(decl);
      if (this.#pos === before) this.#advance(1);
    }
    this.#errors.push({
      message: "Unclosed CSS declaration block",
      position: this.#position(),
      recoverable: true,
    });
    return declarations;
  }

  #consumeDeclaration(): CssDeclaration | null {
    const start = this.#pos;
    const startPos = this.#position();
    const property = this.#readProperty();
    if (!property) return null;
    this.#skipWhitespace();
    if (this.#peek() !== ":") {
      // Malformed declaration — skip to next `;` or `}`
      this.#readUntilAny([";", "}"]);
      if (this.#peek() === ";") this.#advance(1);
      return null;
    }
    this.#advance(1); // ":"
    this.#skipWhitespace();
    const rawValue = this.#readDeclarationValue();
    const { value, important } = parseValueAndImportant(rawValue);
    if (this.#peek() === ";") this.#advance(1);
    return {
      kind: "CssDeclaration",
      range: this.#range(start),
      loc: { start: startPos, end: this.#position() },
      property,
      value,
      important,
    };
  }

  #readProperty(): string {
    const start = this.#pos;
    while (!this.#eof()) {
      const c = this.#peek();
      if (c === undefined) break;
      if (c === ":" || c === ";" || c === "}" || c === "{") break;
      if (c === " " || c === "\t" || c === "\n" || c === "\r") break;
      this.#advance(1);
    }
    return this.#source.slice(start, this.#pos);
  }

  #readDeclarationValue(): string {
    const start = this.#pos;
    let parenDepth = 0;
    while (!this.#eof()) {
      const c = this.#peek();
      if (c === "(") parenDepth += 1;
      else if (c === ")") parenDepth = Math.max(0, parenDepth - 1);
      else if ((c === ";" || c === "}") && parenDepth === 0) break;
      this.#advance(1);
    }
    return this.#source.slice(start, this.#pos).trim();
  }

  // ---------------------------------------------------------------------
  // Character helpers
  // ---------------------------------------------------------------------

  #readIdentifier(): string {
    const start = this.#pos;
    while (!this.#eof()) {
      const c = this.#peek();
      if (c === undefined) break;
      if (/[a-zA-Z0-9_-]/.test(c)) this.#advance(1);
      else break;
    }
    return this.#source.slice(start, this.#pos);
  }

  #skipWhitespace(): void {
    while (!this.#eof()) {
      const c = this.#peek();
      if (c === " " || c === "\t" || c === "\n" || c === "\r") this.#advance(1);
      else break;
    }
  }

  #skipWhitespaceAndComments(): void {
    while (!this.#eof()) {
      this.#skipWhitespace();
      if (this.#startsWith("/*")) {
        this.#consumeComment();
        continue;
      }
      break;
    }
  }

  #readUntilAny(stops: readonly string[]): void {
    while (!this.#eof()) {
      const c = this.#peek();
      if (c !== undefined && stops.includes(c)) break;
      this.#advance(1);
    }
  }

  #peek(offset = 0): string | undefined {
    return this.#source[this.#pos + offset];
  }

  #advance(n: number): void {
    const end = Math.min(this.#pos + n, this.#source.length);
    for (let i = this.#pos; i < end; i++) {
      if (this.#source[i] === "\n") {
        this.#line += 1;
        this.#col = 1;
      } else {
        this.#col += 1;
      }
    }
    this.#pos = end;
  }

  #eof(): boolean {
    return this.#pos >= this.#source.length;
  }

  #startsWith(s: string): boolean {
    return this.#source.startsWith(s, this.#pos);
  }

  #range(start: number, end?: number): SourceRange {
    return { start, end: end ?? this.#pos };
  }

  #position(): SourcePosition {
    return { line: this.#line, column: this.#col, offset: this.#pos };
  }
}

/** Splits a raw declaration value into (clean value, !important flag). */
function parseValueAndImportant(raw: string): { value: string; important: boolean } {
  const match = /\s*!\s*important\s*$/i.exec(raw);
  if (match) {
    return { value: raw.slice(0, match.index).trim(), important: true };
  }
  return { value: raw.trim(), important: false };
}
