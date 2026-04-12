/**
 * In-house HTML parser.
 *
 * A character-driven tokenizer + tree builder producing the HTML AST
 * defined in src/types/ast.ts. Zero dependencies, a11y-aware, and
 * forgiving: malformed input never throws — the parser returns a
 * partial tree plus a `ParseError[]`.
 *
 * Scope for v0.0.x:
 *   - tags, attributes (quoted, unquoted, boolean), self-closing
 *   - text, comments, doctype
 *   - script/style content passthrough (raw-text mode)
 *   - HTML entities (named + numeric) in attribute values and text
 *   - void elements (img, br, input, …) are auto-self-closed
 *
 * Out of scope for v0.0.x: CDATA outside foreign content, full error
 * recovery per the HTML5 parsing algorithm, XML processing instructions.
 * The full HTML5 spec parsing lands in Phase 5 polish, driven by fuzz
 * tests.
 */

import type {
  HtmlAttribute,
  HtmlComment,
  HtmlDoctype,
  HtmlDocument,
  HtmlElement,
  HtmlNode,
  HtmlText,
  ParseError,
  SourcePosition,
  SourceRange,
} from "../../types/ast.ts";

/** HTML void elements that must not have closing tags. */
const VOID_ELEMENTS: ReadonlySet<string> = new Set([
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

/** Elements whose content is treated as raw text (no nested parsing). */
const RAW_TEXT_ELEMENTS: ReadonlySet<string> = new Set(["script", "style", "textarea", "title"]);

export interface HtmlParseResult {
  readonly root: HtmlDocument;
  readonly errors: readonly ParseError[];
}

export function parseHtml(source: string): HtmlParseResult {
  const parser = new HtmlParser(source);
  return parser.parse();
}

class HtmlParser {
  #source: string;
  #pos = 0;
  // Line/column are maintained incrementally so #position() is O(1).
  // Rescanning from offset 0 every call turned a 2MB HTML file into an
  // O(n²) parse that never returned in practice — see docs/performance.md.
  #line = 1;
  #col = 1;
  #errors: ParseError[] = [];

  constructor(source: string) {
    this.#source = source;
  }

  parse(): HtmlParseResult {
    const startPos = this.#position();
    const children: HtmlNode[] = [];
    while (!this.#eof()) {
      const node = this.#consumeNode();
      if (node) children.push(node);
    }
    const endPos = this.#position();
    return {
      root: {
        kind: "HtmlDocument",
        range: { start: 0, end: this.#source.length },
        loc: { start: startPos, end: endPos },
        children,
      },
      errors: this.#errors,
    };
  }

  #consumeNode(): HtmlNode | null {
    if (this.#peek() === "<") {
      // Tag-like construct.
      if (this.#startsWith("<!--")) return this.#consumeComment();
      if (
        this.#startsWith("<!") ||
        this.#startsWith("<!DOCTYPE") ||
        this.#startsWithIgnoreCase("<!doctype")
      ) {
        return this.#consumeDoctype();
      }
      if (this.#startsWith("</")) {
        // Stray closing tag at top level — skip it but record the error.
        const start = this.#pos;
        const startPos = this.#position();
        this.#advance(2);
        this.#readUntil(">");
        if (this.#peek() === ">") this.#advance(1);
        this.#errors.push({
          message: "Stray closing tag at top level",
          position: startPos,
          recoverable: true,
        });
        return {
          kind: "HtmlText",
          range: this.#range(start),
          loc: { start: startPos, end: this.#position() },
          value: "",
        };
      }
      if (this.#peek(1) !== undefined && isNameStart(this.#peek(1) ?? "")) {
        return this.#consumeElement();
      }
      // Not a recognized tag-like construct — treat '<' as literal text.
      return this.#consumeText();
    }
    return this.#consumeText();
  }

  #consumeElement(): HtmlElement {
    const start = this.#pos;
    const startPos = this.#position();
    this.#advance(1); // "<"
    const tagName = this.#readTagName();
    const attributes: HtmlAttribute[] = [];
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
        this.#advance(1); // stray /
        continue;
      }
      if (ch === undefined) {
        this.#errors.push({
          message: `Unterminated start tag <${tagName}>`,
          position: startPos,
          recoverable: true,
        });
        break;
      }
      // Progress guarantee: consumeAttribute advances on any valid
      // attribute. If it stalls (empty name, no `=`), fall through
      // and advance one character so the loop always makes progress.
      const posBefore = this.#pos;
      const attr = this.#consumeAttribute();
      if (this.#pos === posBefore) {
        this.#advance(1);
        continue;
      }
      attributes.push(attr);
    }

    const isVoid = VOID_ELEMENTS.has(tagName.toLowerCase());
    if (isVoid) selfClosing = true;

    let children: HtmlNode[] = [];
    if (!selfClosing) {
      children = this.#consumeChildren(tagName);
    }

    const end = this.#pos;
    return {
      kind: "HtmlElement",
      range: this.#range(start, end),
      loc: { start: startPos, end: this.#position() },
      tagName,
      attributes,
      children,
      selfClosing,
    };
  }

  #consumeChildren(parentTag: string): HtmlNode[] {
    const children: HtmlNode[] = [];
    const isRawText = RAW_TEXT_ELEMENTS.has(parentTag.toLowerCase());

    while (!this.#eof()) {
      // Look for a closing tag matching our parent (case-insensitive).
      if (this.#startsWithClosingTag(parentTag)) {
        this.#consumeClosingTag();
        return children;
      }
      if (isRawText) {
        // Raw-text elements (script/style) — consume everything until a
        // matching close tag as a single text node.
        const start = this.#pos;
        const startPos = this.#position();
        while (!(this.#eof() || this.#startsWithClosingTag(parentTag))) {
          this.#advance(1);
        }
        const raw = this.#source.slice(start, this.#pos);
        children.push({
          kind: "HtmlText",
          range: { start, end: this.#pos },
          loc: { start: startPos, end: this.#position() },
          value: raw,
        });
        if (!this.#eof()) {
          this.#consumeClosingTag();
        }
        return children;
      }
      const node = this.#consumeNode();
      if (node) children.push(node);
    }
    // Unclosed parent element. Recover gracefully.
    this.#errors.push({
      message: `Unclosed <${parentTag}> element`,
      position: this.#position(),
      recoverable: true,
    });
    return children;
  }

  #consumeClosingTag(): void {
    this.#advance(2); // "</"
    this.#readTagName();
    this.#readUntil(">");
    if (this.#peek() === ">") this.#advance(1);
  }

  #consumeAttribute(): HtmlAttribute {
    const start = this.#pos;
    const startPos = this.#position();
    const name = this.#readAttributeName();
    this.#skipWhitespace();
    const { value, quote } =
      this.#peek() === "=" ? this.#consumeAttributeValue() : { value: null, quote: null };

    return {
      kind: "HtmlAttribute",
      range: this.#range(start, this.#pos),
      loc: { start: startPos, end: this.#position() },
      name,
      value,
      quote,
    };
  }

  /** Parses `=value`, `="..."`, or `='...'`. Call only when peek() === "=". */
  #consumeAttributeValue(): { value: string | null; quote: '"' | "'" | null } {
    this.#advance(1); // consume "="
    this.#skipWhitespace();
    const ch = this.#peek();
    if (ch === '"' || ch === "'") return this.#consumeQuotedAttributeValue(ch);
    return { value: decodeEntities(this.#readUnquotedAttributeValue()), quote: null };
  }

  #consumeQuotedAttributeValue(quote: '"' | "'"): {
    value: string;
    quote: '"' | "'";
  } {
    this.#advance(1);
    const valueStart = this.#pos;
    while (!this.#eof() && this.#peek() !== quote) this.#advance(1);
    const value = decodeEntities(this.#source.slice(valueStart, this.#pos));
    if (this.#peek() === quote) this.#advance(1);
    return { value, quote };
  }

  #readUnquotedAttributeValue(): string {
    const valueStart = this.#pos;
    while (!this.#eof()) {
      const c = this.#peek();
      if (c === undefined || c === ">" || c === " " || c === "\t" || c === "\n" || c === "/") {
        break;
      }
      this.#advance(1);
    }
    return this.#source.slice(valueStart, this.#pos);
  }

  #consumeText(): HtmlText {
    const start = this.#pos;
    const startPos = this.#position();
    // Progress guarantee: if called while sitting on `<` (a `<` that
    // #consumeNode couldn't classify as any tag construct), consume
    // one literal character first. Otherwise the outer loop would
    // spin forever.
    if (this.#peek() === "<") this.#advance(1);
    while (!this.#eof() && this.#peek() !== "<") {
      this.#advance(1);
    }
    const raw = this.#source.slice(start, this.#pos);
    return {
      kind: "HtmlText",
      range: { start, end: this.#pos },
      loc: { start: startPos, end: this.#position() },
      value: decodeEntities(raw),
    };
  }

  #consumeComment(): HtmlComment {
    const start = this.#pos;
    const startPos = this.#position();
    this.#advance(4); // "<!--"
    const valueStart = this.#pos;
    while (!this.#eof()) {
      if (this.#peek() === "-" && this.#peek(1) === "-" && this.#peek(2) === ">") {
        break;
      }
      this.#advance(1);
    }
    const value = this.#source.slice(valueStart, this.#pos);
    if (!this.#eof()) this.#advance(3); // "-->"
    return {
      kind: "HtmlComment",
      range: this.#range(start),
      loc: { start: startPos, end: this.#position() },
      value,
    };
  }

  #consumeDoctype(): HtmlDoctype {
    const start = this.#pos;
    const startPos = this.#position();
    this.#readUntil(">");
    if (this.#peek() === ">") this.#advance(1);
    const value = this.#source.slice(start, this.#pos);
    return {
      kind: "HtmlDoctype",
      range: this.#range(start),
      loc: { start: startPos, end: this.#position() },
      value,
    };
  }

  // -------------------------------------------------------------------------
  // Character helpers
  // -------------------------------------------------------------------------

  #peek(offset = 0): string | undefined {
    return this.#source[this.#pos + offset];
  }

  #eof(): boolean {
    return this.#pos >= this.#source.length;
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

  #startsWith(s: string): boolean {
    return this.#source.startsWith(s, this.#pos);
  }

  #startsWithIgnoreCase(s: string): boolean {
    const slice = this.#source.slice(this.#pos, this.#pos + s.length);
    return slice.toLowerCase() === s.toLowerCase();
  }

  #startsWithClosingTag(tagName: string): boolean {
    if (this.#peek() !== "<" || this.#peek(1) !== "/") return false;
    const after = this.#source.slice(this.#pos + 2, this.#pos + 2 + tagName.length);
    if (after.toLowerCase() !== tagName.toLowerCase()) return false;
    const follow = this.#source[this.#pos + 2 + tagName.length];
    return follow === ">" || follow === " " || follow === "\t" || follow === "\n" || follow === "/";
  }

  #readTagName(): string {
    const start = this.#pos;
    while (!this.#eof()) {
      const c = this.#peek();
      if (c === undefined) break;
      if (isNameChar(c)) this.#advance(1);
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
      )
        break;
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

  #readUntil(stop: string): void {
    while (!this.#eof() && this.#peek() !== stop) {
      this.#advance(1);
    }
  }

  #range(start: number, end?: number): SourceRange {
    return { start, end: end ?? this.#pos };
  }

  #position(): SourcePosition {
    return { line: this.#line, column: this.#col, offset: this.#pos };
  }
}

function isNameStart(ch: string): boolean {
  return /[a-zA-Z]/.test(ch);
}

function isNameChar(ch: string): boolean {
  return /[a-zA-Z0-9\-_:]/.test(ch);
}

/** Decodes HTML entities in attribute values and text nodes. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      if (Number.isFinite(code)) return String.fromCodePoint(code);
      return match;
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      if (Number.isFinite(code)) return String.fromCodePoint(code);
      return match;
    }
    const named = NAMED_ENTITIES[entity];
    return named ?? match;
  });
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  hellip: "\u2026",
  mdash: "\u2014",
  ndash: "\u2013",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
};
