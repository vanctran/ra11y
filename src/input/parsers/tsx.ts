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
 *
 * Complexity note: the top-level scanner and element consumers are
 * built from small single-purpose helpers (#skipLineComment,
 * #skipQuoted, #consumeJsxOpenTag, #consumeJsxClosingTag, etc.) so
 * each method stays within the project's cognitive-complexity budget.
 * If you're adding a new JSX construct, add a helper for it rather
 * than inlining the logic into the main loop.
 */

import type {
  JsxAttribute,
  JsxAttributeValue,
  JsxElement,
  JsxExpression,
  JsxNode,
  JsxText,
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
  // Line/column tracked incrementally — see HtmlParser for the why.
  #line = 1;
  #col = 1;
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

  // ---------------------------------------------------------------------
  // Top-level scanner — fast-forward through JS/TS code to the next JSX
  // tag, skipping strings, templates, and comments so the parser doesn't
  // misread literal `<` characters in strings as element openers.
  // ---------------------------------------------------------------------

  #scanToJsx(): void {
    while (!this.#eof()) {
      const c = this.#peek();
      if (c === undefined) return;
      if (this.#skipSkippable(c)) continue;
      if (c === "<" && isTagStart(this.#peek(1))) return;
      this.#advance(1);
    }
  }

  /** Returns true if `c` begins a skippable construct and it was consumed. */
  #skipSkippable(c: string): boolean {
    if (c === "/" && this.#peek(1) === "/") {
      this.#skipLineComment();
      return true;
    }
    if (c === "/" && this.#peek(1) === "*") {
      this.#skipBlockComment();
      return true;
    }
    if (c === '"' || c === "'") {
      this.#skipQuoted(c);
      return true;
    }
    if (c === "`") {
      this.#skipTemplateLiteral();
      return true;
    }
    return false;
  }

  #skipLineComment(): void {
    while (!this.#eof() && this.#peek() !== "\n") this.#advance(1);
  }

  #skipBlockComment(): void {
    this.#advance(2);
    while (!this.#eof()) {
      if (this.#peek() === "*" && this.#peek(1) === "/") break;
      this.#advance(1);
    }
    if (!this.#eof()) this.#advance(2);
  }

  #skipQuoted(quote: '"' | "'"): void {
    this.#advance(1);
    while (!this.#eof() && this.#peek() !== quote) {
      if (this.#peek() === "\\") this.#advance(2);
      else this.#advance(1);
    }
    if (!this.#eof()) this.#advance(1);
  }

  #skipTemplateLiteral(): void {
    this.#advance(1);
    while (!this.#eof() && this.#peek() !== "`") {
      if (this.#peek() === "\\") this.#advance(2);
      else this.#advance(1);
    }
    if (!this.#eof()) this.#advance(1);
  }

  // ---------------------------------------------------------------------
  // Element consumer
  // ---------------------------------------------------------------------

  #consumeJsxElement(): JsxElement | null {
    const start = this.#pos;
    const startPos = this.#position();
    this.#advance(1); // "<"
    const tagName = this.#readTagName();
    if (!tagName) {
      this.#advance(1); // back off past the stray '<'
      return null;
    }

    const { attributes, selfClosing, hasSpreadProps } = this.#consumeJsxOpenTag(tagName, startPos);
    const effectiveSelfClosing =
      selfClosing || (isLowercase(tagName) && SELF_CLOSING_VOID.has(tagName));
    const children: JsxNode[] = effectiveSelfClosing ? [] : this.#consumeJsxChildren(tagName);

    return {
      kind: "JsxElement",
      range: { start, end: this.#pos },
      loc: { start: startPos, end: this.#position() },
      tagName,
      attributes,
      children,
      selfClosing: effectiveSelfClosing,
      hasSpreadProps,
    };
  }

  /** Parses the attributes between `<Tag ` and the closing `>` or `/>`. */
  #consumeJsxOpenTag(
    tagName: string,
    startPos: SourcePosition,
  ): { attributes: JsxAttribute[]; selfClosing: boolean; hasSpreadProps: boolean } {
    const attributes: JsxAttribute[] = [];
    let hasSpreadProps = false;
    while (!this.#eof()) {
      this.#skipWhitespace();
      const terminator = this.#consumeOpenTagTerminator(tagName, startPos);
      if (terminator === "close") return { attributes, selfClosing: false, hasSpreadProps };
      if (terminator === "self-close") return { attributes, selfClosing: true, hasSpreadProps };
      const posBefore = this.#pos;
      const step = this.#consumeJsxAttributeOrSpread();
      if (step.kind === "attribute") attributes.push(step.attribute);
      else if (step.kind === "spread") hasSpreadProps = true;
      if (this.#pos === posBefore) this.#advance(1);
    }
    return { attributes, selfClosing: false, hasSpreadProps };
  }

  /**
   * Detects whether the current position ends the open tag (`>`, `/>`)
   * or is an EOF error, advancing past the terminator. Returns `"attr"`
   * when the caller should try to consume an attribute instead.
   */
  #consumeOpenTagTerminator(
    tagName: string,
    startPos: SourcePosition,
  ): "close" | "self-close" | "attr" {
    const ch = this.#peek();
    if (ch === undefined) {
      this.#errors.push({
        message: `Unterminated JSX element <${tagName}>`,
        position: startPos,
        recoverable: true,
      });
      return "close";
    }
    if (ch === ">") {
      this.#advance(1);
      return "close";
    }
    if (ch === "/" && this.#peek(1) === ">") {
      this.#advance(2);
      return "self-close";
    }
    if (ch === "/") this.#advance(1);
    return "attr";
  }

  // ---------------------------------------------------------------------
  // Attribute consumer
  // ---------------------------------------------------------------------

  /**
   * One step of the open-tag loop. A `{` opens a spread attribute
   * (`{...props}`) whose raw expression we intentionally discard; anything
   * else falls through to the named-attribute parser. Keeping the branch
   * here (not inside `consumeJsxAttribute`) keeps each helper single-purpose.
   */
  #consumeJsxAttributeOrSpread():
    | { kind: "attribute"; attribute: JsxAttribute }
    | { kind: "spread" }
    | { kind: "none" } {
    if (this.#peek() === "{") {
      this.#skipBraceBlock();
      return { kind: "spread" };
    }
    const attribute = this.#consumeJsxAttribute();
    return attribute ? { kind: "attribute", attribute } : { kind: "none" };
  }

  #consumeJsxAttribute(): JsxAttribute | null {
    const start = this.#pos;
    const startPos = this.#position();

    const name = this.#readAttributeName();
    if (!name) return null;

    this.#skipWhitespace();
    const value = this.#peek() === "=" ? this.#parseJsxAttributeValue() : null;

    return {
      kind: "JsxAttribute",
      range: { start, end: this.#pos },
      loc: { start: startPos, end: this.#position() },
      name,
      value,
    };
  }

  #parseJsxAttributeValue(): JsxAttributeValue | null {
    this.#advance(1); // consume "="
    this.#skipWhitespace();
    const ch = this.#peek();
    if (ch === '"' || ch === "'") return this.#parseStringAttributeValue(ch);
    if (ch === "{") return this.#parseExpressionAttributeValue();
    return null;
  }

  #parseStringAttributeValue(quote: '"' | "'"): JsxAttributeValue {
    this.#advance(1);
    const valStart = this.#pos;
    while (!this.#eof() && this.#peek() !== quote) this.#advance(1);
    const value: JsxAttributeValue = {
      kind: "StringLiteral",
      value: this.#source.slice(valStart, this.#pos),
    };
    if (!this.#eof()) this.#advance(1);
    return value;
  }

  #parseExpressionAttributeValue(): JsxAttributeValue {
    const exprStart = this.#pos;
    this.#skipBraceBlock();
    return { kind: "Expression", raw: this.#source.slice(exprStart, this.#pos) };
  }

  /**
   * Consumes a balanced `{...}` expression block starting at the current
   * position. Respects nested braces. Advances past the closing `}`.
   */
  #skipBraceBlock(): void {
    let depth = 0;
    while (!this.#eof()) {
      const c = this.#peek();
      if (c === "{") depth += 1;
      else if (c === "}") {
        depth -= 1;
        this.#advance(1);
        if (depth === 0) return;
        continue;
      }
      this.#advance(1);
    }
  }

  // ---------------------------------------------------------------------
  // Children consumer
  // ---------------------------------------------------------------------

  #consumeJsxChildren(tagName: string): JsxNode[] {
    const children: JsxNode[] = [];
    while (!this.#eof()) {
      if (this.#isMatchingClosingTag(tagName)) {
        this.#consumeJsxClosingTag();
        return children;
      }
      const before = this.#pos;
      const child = this.#consumeJsxChildNode();
      if (child) children.push(child);
      if (this.#pos === before) this.#advance(1);
    }
    this.#errors.push({
      message: `Unclosed JSX element <${tagName}>`,
      position: this.#position(),
      recoverable: true,
    });
    return children;
  }

  /** Dispatches to the right child consumer based on the current character. */
  #consumeJsxChildNode(): JsxNode | null {
    const ch = this.#peek();
    if (ch === "<" && isTagStart(this.#peek(1))) return this.#consumeJsxElement();
    if (ch === "{") return this.#consumeJsxExpressionChild();
    return this.#consumeJsxTextChild();
  }

  #consumeJsxExpressionChild(): JsxExpression {
    const start = this.#pos;
    const startPos = this.#position();
    this.#skipBraceBlock();
    return {
      kind: "JsxExpression",
      range: { start, end: this.#pos },
      loc: { start: startPos, end: this.#position() },
      raw: this.#source.slice(start, this.#pos),
    };
  }

  #consumeJsxTextChild(): JsxText | null {
    const start = this.#pos;
    const startPos = this.#position();
    while (!this.#eof()) {
      const c = this.#peek();
      if (c === "<" || c === "{" || c === undefined) break;
      this.#advance(1);
    }
    if (this.#pos === start) {
      // Progress guarantee — consume one literal character even if it
      // doesn't start a recognized construct.
      this.#advance(1);
    }
    const value = this.#source.slice(start, this.#pos);
    if (value.length === 0) return null;
    return {
      kind: "JsxText",
      range: { start, end: this.#pos },
      loc: { start: startPos, end: this.#position() },
      value,
    };
  }

  #isMatchingClosingTag(tagName: string): boolean {
    if (this.#peek() !== "<" || this.#peek(1) !== "/") return false;
    const after = this.#source.slice(this.#pos + 2, this.#pos + 2 + tagName.length);
    return after.toLowerCase() === tagName.toLowerCase();
  }

  #consumeJsxClosingTag(): void {
    this.#advance(2); // "</"
    this.#readTagName();
    while (!this.#eof() && this.#peek() !== ">") this.#advance(1);
    if (!this.#eof()) this.#advance(1);
  }

  // ---------------------------------------------------------------------
  // Low-level character helpers
  // ---------------------------------------------------------------------

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
      if (
        c === undefined ||
        c === "=" ||
        c === ">" ||
        c === "/" ||
        c === " " ||
        c === "\t" ||
        c === "\n"
      ) {
        break;
      }
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

  #position(): SourcePosition {
    return { line: this.#line, column: this.#col, offset: this.#pos };
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
