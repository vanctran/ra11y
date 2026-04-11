/**
 * Minimal in-house TSX/JSX parser — v0.0.x surface.
 *
 * This is NOT a full TypeScript parser. It scans source for top-level
 * and nested JSX elements, extracts tag names, string-literal attributes,
 * and text children, and returns a `TsxModule` AST. It's enough to
 * drive the first wave of a11y rules (alt-text, link text, lang
 * attribute, etc.) that only need JSX structure, not full type info.
 *
 * Phase 5 replaces this with a TypeScript-compiler-API-backed parser
 * that pools the `ts` import. The API shape stays the same.
 *
 * Implementation strategy: we treat JSX like HTML but with {expression}
 * children tracked separately. We skip over JS/TS code outside JSX,
 * entering JSX mode when we see `<TagName` where TagName starts with
 * a letter and is followed by ASCII identifier characters.
 */

import type {
  JsxAttribute,
  JsxAttributeValue,
  JsxElement,
  JsxNode,
  ParseError,
  SourcePosition,
  TsxModule,
} from "../../types/ast.ts";

export interface TsxParseResult {
  readonly root: TsxModule;
  readonly errors: readonly ParseError[];
}

const SELF_CLOSING_VOID: ReadonlySet<string> = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

export function parseTsx(source: string): TsxParseResult {
  return new TsxParser(source).parse();
}

class TsxParser {
  #source: string;
  #pos = 0;
  #errors: ParseError[] = [];
  #elements: JsxElement[] = [];

  constructor(source: string) {
    this.#source = source;
  }

  parse(): TsxParseResult {
    const startPos = this.#position();
    while (!this.#eof()) {
      this.#scanToJsx();
      if (this.#eof()) break;
      const el = this.#consumeJsxElement();
      if (el) this.#elements.push(el);
    }
    const endPos = this.#position();
    const root: TsxModule = {
      kind: "TsxModule",
      range: { start: 0, end: this.#source.length },
      loc: { start: startPos, end: endPos },
      jsxElements: this.#elements,
    };
    return { root, errors: this.#errors };
  }

  /**
   * Fast-forward to the next plausible JSX opening tag. We skip over
   * strings, template literals, regex literals, and comments so a JSX
   * parser doesn't mistake them for tags. This is a heuristic, not a
   * full JS lexer — good enough for Phase 6 rules.
   */
  #scanToJsx(): void {
    while (!this.#eof()) {
      const c = this.#peek();
      if (c === undefined) return;

      // Skip line comments.
      if (c === "/" && this.#peek(1) === "/") {
        while (!this.#eof() && this.#peek() !== "\n") this.#advance(1);
        continue;
      }
      // Skip block comments.
      if (c === "/" && this.#peek(1) === "*") {
        this.#advance(2);
        while (!this.#eof() && !(this.#peek() === "*" && this.#peek(1) === "/")) {
          this.#advance(1);
        }
        if (!this.#eof()) this.#advance(2);
        continue;
      }
      // Skip string literals.
      if (c === "\"" || c === "'") {
        const quote = c;
        this.#advance(1);
        while (!this.#eof() && this.#peek() !== quote) {
          if (this.#peek() === "\\") this.#advance(2);
          else this.#advance(1);
        }
        if (!this.#eof()) this.#advance(1);
        continue;
      }
      // Skip template literals.
      if (c === "`") {
        this.#advance(1);
        while (!this.#eof() && this.#peek() !== "`") {
          if (this.#peek() === "\\") this.#advance(2);
          else this.#advance(1);
        }
        if (!this.#eof()) this.#advance(1);
        continue;
      }
      // JSX opening tag: < followed by a name start (letter).
      if (c === "<" && isTagStart(this.#peek(1))) {
        return;
      }
      this.#advance(1);
    }
  }

  #consumeJsxElement(): JsxElement | null {
    const start = this.#pos;
    const startPos = this.#position();
    this.#advance(1); // "<"
    const tagName = this.#readTagName();
    if (!tagName) {
      // Not actually a JSX tag — back off and let the outer loop skip.
      this.#advance(1);
      return null;
    }

    const attributes: JsxAttribute[] = [];
    let selfClosing = false;
    while (!this.#eof()) {
      this.#skipWhitespace();
      const ch = this.#peek();
      if (ch === ">") {
        this.#advance(1);
        break;
      }
      if (ch === "/") {
        if (this.#peek(1) === ">") {
          selfClosing = true;
          this.#advance(2);
          break;
        }
        this.#advance(1);
        continue;
      }
      if (ch === undefined) {
        this.#errors.push({
          message: `Unterminated JSX element <${tagName}>`,
          position: startPos,
          recoverable: true,
        });
        break;
      }
      const posBefore = this.#pos;
      const attr = this.#consumeJsxAttribute();
      if (attr) {
        attributes.push(attr);
        continue;
      }
      if (this.#pos === posBefore) this.#advance(1);
    }

    // HTML-style void elements (lowercase DOM names like <img>, <br>,
    // <input>) are always treated as self-closing even without a
    // trailing slash. React allows this too. We deliberately only
    // match lowercase names: PascalCase components like <Link> or
    // <Input> are React components that happen to share a name with
    // a void element and can have children.
    if (isLowercase(tagName) && SELF_CLOSING_VOID.has(tagName)) selfClosing = true;

    const children: JsxNode[] = selfClosing ? [] : this.#consumeJsxChildren(tagName);

    return {
      kind: "JsxElement",
      range: { start, end: this.#pos },
      loc: { start: startPos, end: this.#position() },
      tagName,
      attributes,
      children,
      selfClosing,
    };
  }

  #consumeJsxAttribute(): JsxAttribute | null {
    const start = this.#pos;
    const startPos = this.#position();
    // Skip spread attributes {...x} and other expression-only attrs — we
    // only care about string-literal attributes for v0.0.x rules.
    if (this.#peek() === "{") {
      // Find the matching closing brace, respecting nesting.
      let depth = 0;
      while (!this.#eof()) {
        const c = this.#peek();
        if (c === "{") depth += 1;
        else if (c === "}") {
          depth -= 1;
          this.#advance(1);
          if (depth === 0) break;
          continue;
        }
        this.#advance(1);
      }
      return null;
    }

    const name = this.#readAttributeName();
    if (!name) return null;

    this.#skipWhitespace();
    let value: JsxAttributeValue | null = null;
    if (this.#peek() === "=") {
      this.#advance(1);
      this.#skipWhitespace();
      const ch = this.#peek();
      if (ch === "\"" || ch === "'") {
        this.#advance(1);
        const valStart = this.#pos;
        while (!this.#eof() && this.#peek() !== ch) this.#advance(1);
        value = { kind: "StringLiteral", value: this.#source.slice(valStart, this.#pos) };
        if (!this.#eof()) this.#advance(1);
      } else if (ch === "{") {
        // Expression value — record the raw text, not the parsed shape.
        let depth = 0;
        const exprStart = this.#pos;
        while (!this.#eof()) {
          const c = this.#peek();
          if (c === "{") depth += 1;
          else if (c === "}") {
            depth -= 1;
            this.#advance(1);
            if (depth === 0) break;
            continue;
          }
          this.#advance(1);
        }
        value = { kind: "Expression", raw: this.#source.slice(exprStart, this.#pos) };
      }
    }

    return {
      kind: "JsxAttribute",
      range: { start, end: this.#pos },
      loc: { start: startPos, end: this.#position() },
      name,
      value,
    };
  }

  #consumeJsxChildren(tagName: string): JsxNode[] {
    const children: JsxNode[] = [];
    while (!this.#eof()) {
      // Closing tag for our parent?
      if (
        this.#peek() === "<" &&
        this.#peek(1) === "/" &&
        this.#source.slice(this.#pos + 2, this.#pos + 2 + tagName.length).toLowerCase() ===
          tagName.toLowerCase()
      ) {
        // Consume </tagName>
        this.#advance(2);
        this.#readTagName();
        while (!this.#eof() && this.#peek() !== ">") this.#advance(1);
        if (!this.#eof()) this.#advance(1);
        return children;
      }

      // Nested element?
      if (this.#peek() === "<" && isTagStart(this.#peek(1))) {
        const posBefore = this.#pos;
        const child = this.#consumeJsxElement();
        if (child) children.push(child);
        if (this.#pos === posBefore) this.#advance(1);
        continue;
      }

      // Expression child {...}
      if (this.#peek() === "{") {
        const start = this.#pos;
        const startPos = this.#position();
        let depth = 0;
        while (!this.#eof()) {
          const c = this.#peek();
          if (c === "{") depth += 1;
          else if (c === "}") {
            depth -= 1;
            this.#advance(1);
            if (depth === 0) break;
            continue;
          }
          this.#advance(1);
        }
        children.push({
          kind: "JsxExpression",
          range: { start, end: this.#pos },
          loc: { start: startPos, end: this.#position() },
          raw: this.#source.slice(start, this.#pos),
        });
        continue;
      }

      // Text node until next < or {.
      const start = this.#pos;
      const startPos = this.#position();
      const posBefore = this.#pos;
      while (!this.#eof()) {
        const c = this.#peek();
        if (c === "<" || c === "{" || c === undefined) break;
        this.#advance(1);
      }
      if (this.#pos === posBefore) {
        // Progress guarantee.
        this.#advance(1);
      }
      const value = this.#source.slice(start, this.#pos);
      if (value.trim().length > 0 || value.length > 0) {
        children.push({
          kind: "JsxText",
          range: { start, end: this.#pos },
          loc: { start: startPos, end: this.#position() },
          value,
        });
      }
    }

    // EOF without closing tag — record error and return.
    this.#errors.push({
      message: `Unclosed JSX element <${tagName}>`,
      position: this.#position(),
      recoverable: true,
    });
    return children;
  }

  #readTagName(): string {
    const start = this.#pos;
    while (!this.#eof()) {
      const c = this.#peek();
      if (c === undefined) break;
      if (/[a-zA-Z0-9_.]/.test(c)) this.#advance(1);
      else break;
    }
    return this.#source.slice(start, this.#pos);
  }

  #readAttributeName(): string {
    const start = this.#pos;
    while (!this.#eof()) {
      const c = this.#peek();
      if (c === undefined || c === "=" || c === ">" || c === "/" || c === " " || c === "\t" || c === "\n") break;
      this.#advance(1);
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

  #peek(offset = 0): string | undefined {
    return this.#source[this.#pos + offset];
  }

  #advance(n: number): void {
    this.#pos += n;
  }

  #eof(): boolean {
    return this.#pos >= this.#source.length;
  }

  #position(): SourcePosition {
    let line = 1;
    let col = 1;
    for (let i = 0; i < this.#pos; i++) {
      if (this.#source[i] === "\n") {
        line += 1;
        col = 1;
      } else {
        col += 1;
      }
    }
    return { line, column: col, offset: this.#pos };
  }
}

function isTagStart(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return /[a-zA-Z]/.test(ch);
}

function isLowercase(s: string): boolean {
  if (s.length === 0) return false;
  const first = s[0];
  if (first === undefined) return false;
  return first === first.toLowerCase() && first !== first.toUpperCase();
}
