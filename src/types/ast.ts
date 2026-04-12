/**
 * AST node types produced by ra11y's in-house parsers.
 *
 * Three independent AST dialects — TSX/JSX, HTML, CSS — each with its own
 * discriminated node union. Rules narrow `RuleContext.ast` by reading
 * `RuleContext.language` first.
 *
 * These types are intentionally minimal in v0.0.x. They grow with the
 * parsers (Phase 5). Any change here is a potentially breaking ADR.
 *
 * See docs/kb/architecture/input-parsers.md.
 */

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

/** Byte-offset range in the source file. */
export interface SourceRange {
  readonly start: number;
  readonly end: number;
}

/** Human-friendly position. Both line and column are 1-based. */
export interface SourcePosition {
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

/** Every AST node carries its source range. */
export interface BaseNode {
  readonly range: SourceRange;
  readonly loc: { readonly start: SourcePosition; readonly end: SourcePosition };
}

/** Parse errors — parsers emit these alongside a partial AST; they never throw. */
export interface ParseError {
  readonly message: string;
  readonly position: SourcePosition;
  readonly recoverable: boolean;
}

// ---------------------------------------------------------------------------
// HTML AST
// ---------------------------------------------------------------------------

export interface HtmlDocument extends BaseNode {
  readonly kind: "HtmlDocument";
  readonly children: readonly HtmlNode[];
}

export type HtmlNode = HtmlElement | HtmlText | HtmlComment | HtmlDoctype;

export interface HtmlElement extends BaseNode {
  readonly kind: "HtmlElement";
  readonly tagName: string;
  readonly attributes: readonly HtmlAttribute[];
  readonly children: readonly HtmlNode[];
  readonly selfClosing: boolean;
}

export interface HtmlAttribute extends BaseNode {
  readonly kind: "HtmlAttribute";
  readonly name: string;
  readonly value: string | null;
  readonly quote: '"' | "'" | null;
}

export interface HtmlText extends BaseNode {
  readonly kind: "HtmlText";
  readonly value: string;
}

export interface HtmlComment extends BaseNode {
  readonly kind: "HtmlComment";
  readonly value: string;
}

export interface HtmlDoctype extends BaseNode {
  readonly kind: "HtmlDoctype";
  readonly value: string;
}

// ---------------------------------------------------------------------------
// CSS AST
// ---------------------------------------------------------------------------

export interface CssStylesheet extends BaseNode {
  readonly kind: "CssStylesheet";
  readonly rules: readonly CssNode[];
}

export type CssNode = CssRule | CssAtRule | CssComment;

export interface CssRule extends BaseNode {
  readonly kind: "CssRule";
  readonly selector: string;
  readonly declarations: readonly CssDeclaration[];
}

export interface CssDeclaration extends BaseNode {
  readonly kind: "CssDeclaration";
  readonly property: string;
  readonly value: string;
  readonly important: boolean;
}

export interface CssAtRule extends BaseNode {
  readonly kind: "CssAtRule";
  readonly name: string;
  readonly params: string;
  readonly children: readonly CssNode[];
}

export interface CssComment extends BaseNode {
  readonly kind: "CssComment";
  readonly value: string;
}

// ---------------------------------------------------------------------------
// TSX/JSX AST — minimal surface for v0.0.x. Real parser in Phase 5.
// ---------------------------------------------------------------------------

export interface TsxModule extends BaseNode {
  readonly kind: "TsxModule";
  readonly jsxElements: readonly JsxElement[];
}

export interface JsxElement extends BaseNode {
  readonly kind: "JsxElement";
  readonly tagName: string;
  readonly attributes: readonly JsxAttribute[];
  readonly children: readonly JsxNode[];
  readonly selfClosing: boolean;
}

export type JsxNode = JsxElement | JsxText | JsxExpression;

export interface JsxAttribute extends BaseNode {
  readonly kind: "JsxAttribute";
  readonly name: string;
  /** `null` for shorthand attributes (`<img hidden />`). */
  readonly value: JsxAttributeValue | null;
}

export type JsxAttributeValue =
  | { readonly kind: "StringLiteral"; readonly value: string }
  | { readonly kind: "Expression"; readonly raw: string };

export interface JsxText extends BaseNode {
  readonly kind: "JsxText";
  readonly value: string;
}

export interface JsxExpression extends BaseNode {
  readonly kind: "JsxExpression";
  readonly raw: string;
}

// ---------------------------------------------------------------------------
// Discriminated union tying language → AST root
// ---------------------------------------------------------------------------

export type Ast =
  | {
      readonly language: "html";
      readonly root: HtmlDocument;
      readonly errors: readonly ParseError[];
    }
  | {
      readonly language: "css";
      readonly root: CssStylesheet;
      readonly errors: readonly ParseError[];
    }
  | {
      readonly language: "tsx" | "jsx" | "ts" | "js";
      readonly root: TsxModule;
      readonly errors: readonly ParseError[];
    };
