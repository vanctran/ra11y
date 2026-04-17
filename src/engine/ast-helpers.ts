/**
 * AST query helpers.
 *
 * Rules compose these primitives instead of hand-walking ASTs. Every
 * helper here is a pure, synchronous function over typed AST nodes.
 * If a rule needs something these helpers don't provide, add the
 * primitive here first (via `type-smith`) — don't hand-walk in the
 * rule.
 *
 * See docs/kb/patterns/using-ast-helpers.md.
 */

import type {
  CssAtRule,
  CssDeclaration,
  CssNode,
  CssRule,
  CssStylesheet,
  HtmlDocument,
  HtmlElement,
  HtmlNode,
  JsxAttribute,
  JsxElement,
  JsxNode,
  TsxModule,
} from "../types/ast.ts";

// ---------------------------------------------------------------------------
// HTML walkers
// ---------------------------------------------------------------------------

/** Yields every element in the HTML tree (depth-first, document order). */
export function* walkHtmlElements(root: HtmlDocument | HtmlElement): Iterable<HtmlElement> {
  const children = root.kind === "HtmlDocument" ? root.children : root.children;
  for (const child of children) {
    if (child.kind === "HtmlElement") {
      yield child;
      yield* walkHtmlElements(child);
    }
  }
}

/** Returns every element with the given lowercase tag name. */
export function findHtmlElementsByTag(
  root: HtmlDocument | HtmlElement,
  tag: string,
): readonly HtmlElement[] {
  const lowered = tag.toLowerCase();
  const out: HtmlElement[] = [];
  for (const el of walkHtmlElements(root)) {
    if (el.tagName.toLowerCase() === lowered) out.push(el);
  }
  return out;
}

/** Looks up an attribute on an HTML element by case-insensitive name. */
export function getHtmlAttribute(element: HtmlElement, name: string): string | null {
  const lowered = name.toLowerCase();
  for (const attr of element.attributes) {
    if (attr.name.toLowerCase() === lowered) return attr.value;
  }
  return null;
}

/** True if the element has the attribute (even as a boolean attribute). */
export function hasHtmlAttribute(element: HtmlElement, name: string): boolean {
  const lowered = name.toLowerCase();
  for (const attr of element.attributes) {
    if (attr.name.toLowerCase() === lowered) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// JSX walkers (v0.0.x minimal surface)
// ---------------------------------------------------------------------------

/** Yields every JsxElement in the module. */
export function* walkJsxElements(module: TsxModule): Iterable<JsxElement> {
  for (const el of module.jsxElements) {
    yield el;
    yield* walkJsxElementChildren(el);
  }
}

function* walkJsxElementChildren(element: JsxElement): Iterable<JsxElement> {
  for (const child of element.children) {
    if (child.kind === "JsxElement") {
      yield child;
      yield* walkJsxElementChildren(child);
    }
  }
}

/** Finds JSX elements by tag name (case-sensitive; matches React component names). */
export function findJsxElementsByTag(module: TsxModule, tag: string): readonly JsxElement[] {
  const out: JsxElement[] = [];
  for (const el of walkJsxElements(module)) {
    if (el.tagName === tag) out.push(el);
  }
  return out;
}

/** Gets a JSX attribute by name, or null if missing. */
export function getJsxAttribute(element: JsxElement, name: string): JsxAttribute | null {
  for (const attr of element.attributes) {
    if (attr.name === name) return attr;
  }
  return null;
}

/** Gets the string-literal value of a JSX attribute, or null if missing or expression. */
export function getJsxAttributeString(element: JsxElement, name: string): string | null {
  const attr = getJsxAttribute(element, name);
  if (!attr?.value) return null;
  return attr.value.kind === "StringLiteral" ? attr.value.value : null;
}

/** True if the element has the given attribute (even shorthand). */
export function hasJsxAttribute(element: JsxElement, name: string): boolean {
  return getJsxAttribute(element, name) !== null;
}

// ---------------------------------------------------------------------------
// Decorative / accessible-name primitives (v0.0.x minimal)
// ---------------------------------------------------------------------------

/**
 * True if the element should be treated as decorative and therefore exempt
 * from a text alternative requirement. WCAG 1.1.1 allows empty alt, role
 * of presentation/none, or aria-hidden for decorative images.
 */
export function isDecorativeHtmlElement(element: HtmlElement): boolean {
  if (getHtmlAttribute(element, "alt") === "") return true;
  const role = getHtmlAttribute(element, "role");
  if (role === "presentation" || role === "none") return true;
  if (getHtmlAttribute(element, "aria-hidden") === "true") return true;
  return false;
}

export function isDecorativeJsxElement(element: JsxElement): boolean {
  if (getJsxAttributeString(element, "alt") === "") return true;
  const role = getJsxAttributeString(element, "role");
  if (role === "presentation" || role === "none") return true;
  if (getJsxAttributeString(element, "aria-hidden") === "true") return true;
  return false;
}

/** Very loose accessible-name heuristic for a JSX element. Grows in later phases. */
export function looseAccessibleNameJsx(element: JsxElement): string {
  const aria = getJsxAttributeString(element, "aria-label");
  if (aria && aria.trim().length > 0) return aria.trim();
  const alt = getJsxAttributeString(element, "alt");
  if (alt && alt.trim().length > 0) return alt.trim();
  const title = getJsxAttributeString(element, "title");
  if (title && title.trim().length > 0) return title.trim();
  return "";
}

/** All HTML child nodes (no recursion) — handy when a rule wants immediate siblings. */
export function directHtmlChildren(element: HtmlElement): readonly HtmlNode[] {
  return element.children;
}

/** Text content of an HTML element (concatenated descendant text, trimmed). */
export function htmlTextContent(element: HtmlElement): string {
  const chunks: string[] = [];
  const visit = (node: HtmlNode): void => {
    if (node.kind === "HtmlText") chunks.push(node.value);
    else if (node.kind === "HtmlElement") for (const c of node.children) visit(c);
  };
  for (const child of element.children) visit(child);
  return chunks.join("").trim();
}

/** Text content of a JSX element (concatenated literal text only). */
export function jsxTextContent(element: JsxElement): string {
  const chunks: string[] = [];
  const visit = (node: JsxNode): void => {
    if (node.kind === "JsxText") chunks.push(node.value);
    else if (node.kind === "JsxElement") for (const c of node.children) visit(c);
  };
  for (const child of element.children) visit(child);
  return chunks.join("").trim();
}

/**
 * True if the JSX element has any content that likely produces text
 * at runtime — literal text OR expression children like `{label}`.
 * Used by name-checking rules to avoid false-flagging `<button>{label}</button>`.
 */
export function jsxHasContentChildren(element: JsxElement): boolean {
  for (const child of element.children) {
    if (child.kind === "JsxText" && child.value.trim().length > 0) return true;
    if (child.kind === "JsxExpression") return true;
    if (child.kind === "JsxElement") return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// CSS walkers
// ---------------------------------------------------------------------------

/**
 * Yields every CssRule in the stylesheet, flattened through any
 * nested at-rule containers (@media, @supports, @keyframes, etc.).
 * Rules are yielded in document order.
 */
export function* walkCssRules(stylesheet: CssStylesheet): Iterable<CssRule> {
  yield* walkCssNodesForRules(stylesheet.rules);
}

function* walkCssNodesForRules(nodes: readonly CssNode[]): Iterable<CssRule> {
  for (const node of nodes) {
    if (node.kind === "CssRule") {
      yield node;
      continue;
    }
    if (node.kind === "CssAtRule") {
      yield* walkCssNodesForRules(node.children);
    }
  }
}

/** Yields every CssAtRule in the stylesheet (depth-first). */
export function* walkCssAtRules(stylesheet: CssStylesheet): Iterable<CssAtRule> {
  yield* walkCssNodesForAtRules(stylesheet.rules);
}

function* walkCssNodesForAtRules(nodes: readonly CssNode[]): Iterable<CssAtRule> {
  for (const node of nodes) {
    if (node.kind === "CssAtRule") {
      yield node;
      yield* walkCssNodesForAtRules(node.children);
    }
  }
}

/** Returns the first declaration whose property matches (case-insensitive). */
export function findCssDeclaration(rule: CssRule, property: string): CssDeclaration | undefined {
  const target = property.toLowerCase();
  return rule.declarations.find((d) => d.property.toLowerCase() === target);
}

/** True if any declaration in the rule matches the property. */
export function hasCssDeclaration(rule: CssRule, property: string): boolean {
  return findCssDeclaration(rule, property) !== undefined;
}

// ---------------------------------------------------------------------------
// Node shape description — feeds Violation.groupKey
// ---------------------------------------------------------------------------

/**
 * The subset of AST node kinds that can plausibly be the *target* of a
 * rule emission. Rules emit findings anchored on an element, a rule
 * block, a declaration, or an at-rule — never on a doctype or a comment
 * node, so those are left out. When the engine can't resolve any of
 * these at an emitted location, it falls back to the `UNKNOWN_SHAPE`
 * sentinel (see `src/utils/group-key.ts`).
 */
export type TargetNode = HtmlElement | JsxElement | CssRule | CssDeclaration | CssAtRule;

interface NodeLoc {
  readonly start: { readonly line: number; readonly column: number };
  readonly end: { readonly line: number; readonly column: number };
}

/**
 * Produces a canonical, identifier-agnostic description of an AST
 * node's shape. Feeds `Violation.groupKey` — two findings from the same
 * rule whose target nodes produce the same shape string share a
 * groupKey, regardless of which file they live in.
 *
 * Normalization principles (enforced here, not in callers):
 *
 * 1. Element / selector kind is preserved (tag name, at-rule name,
 *    selector pseudo-class set).
 * 2. Attribute / property NAMES are preserved; VALUES are stripped.
 *    `<img alt="a">` and `<img alt="b">` produce the same shape; a
 *    missing `alt` produces a shape with `[missing=no-alt]` — missingness
 *    matters to the rule, so it's encoded.
 * 3. Children structure is coarse-grained: `[empty]`, `[text]`,
 *    `[expr]`, `[element]`, `[mixed]`. Literal text never feeds the
 *    hash.
 * 4. Position in the file (line, column, byte offset) is excluded —
 *    same reason `findingId` excludes line numbers.
 *
 * Pure function. Never throws; on an unexpected kind, returns
 * `<exotic:<kind>>` — still deterministic per-kind.
 */
export function describeNodeShape(node: TargetNode): string {
  if (node.kind === "HtmlElement") return describeHtmlElement(node);
  if (node.kind === "JsxElement") return describeJsxElement(node);
  if (node.kind === "CssRule") return describeCssRule(node);
  if (node.kind === "CssDeclaration") return describeCssDeclaration(node);
  if (node.kind === "CssAtRule") return describeCssAtRule(node);
  // Unreachable under the discriminated union above; kept as a
  // deterministic safety net in case the union grows without this
  // function being updated. Per-kind so the fallback still groups
  // sensibly rather than bucketing every exotic kind together.
  return `<exotic:${(node as { kind: string }).kind}>`;
}

/**
 * Finds the innermost AST node whose source range contains the given
 * `(line, column)` position (both 1-based). Returns `undefined` when
 * no target node overlaps — caller falls back to `UNKNOWN_SHAPE`.
 *
 * Used by the scanner to bridge emitted violations (which carry a
 * location but not the node that triggered them) to a groupable
 * shape. Pure function; no I/O.
 */
export function findTargetNodeAtLocation(
  astRoot: HtmlDocument | TsxModule | CssStylesheet,
  line: number,
  column: number,
): TargetNode | undefined {
  if (astRoot.kind === "HtmlDocument") {
    return findHtmlTargetAtLocation(astRoot.children, line, column);
  }
  if (astRoot.kind === "TsxModule") {
    return findJsxTargetAtLocation(astRoot.jsxElements, line, column);
  }
  return findCssTargetAtLocation(astRoot.rules, line, column);
}

// Internal shape builders ---------------------------------------------------

function describeHtmlElement(el: HtmlElement): string {
  const tag = el.tagName.toLowerCase();
  const attrs = describeAttributeNames(el.attributes.map((a) => a.name.toLowerCase()));
  const present = new Set(el.attributes.map((a) => a.name.toLowerCase()));
  const missing = describeMissingForTag(tag, present);
  const children = describeHtmlChildren(el.children);
  return `html:${tag}${attrs}${missing}${children}`;
}

function describeJsxElement(el: JsxElement): string {
  const tag = el.tagName;
  const attrs = describeAttributeNames(el.attributes.map((a: JsxAttribute) => a.name));
  const present = new Set(el.attributes.map((a) => a.name.toLowerCase()));
  const missing = describeMissingForTag(tag.toLowerCase(), present);
  const spread = el.hasSpreadProps ? "[spread]" : "";
  const children = describeJsxChildren(el.children);
  return `jsx:${tag}${attrs}${spread}${missing}${children}`;
}

function describeCssRule(rule: CssRule): string {
  const selector = canonicalizeCssSelector(rule.selector);
  const props = rule.declarations
    .map((d) => d.property.toLowerCase())
    .sort()
    .join(",");
  return `css:rule[selector=${selector}][decl=${props}]`;
}

function describeCssDeclaration(decl: CssDeclaration): string {
  return `css:decl[${decl.property.toLowerCase()}]`;
}

function describeCssAtRule(atRule: CssAtRule): string {
  return `css:at-rule[${atRule.name.toLowerCase()}]`;
}

/**
 * Collapses an attribute name list to a deterministic `[attrs=:a:b:c]`
 * string. Names are lowercased and sorted so `alt`+`src` and `src`+`alt`
 * produce the same string — we care about *which names are present*,
 * not the source order.
 */
function describeAttributeNames(names: readonly string[]): string {
  if (names.length === 0) return "[attrs=]";
  const normalized = [...new Set(names.map((n) => n.toLowerCase()))].sort();
  return `[attrs=:${normalized.join(":")}]`;
}

/**
 * Encodes known-missingness flags for a small set of tags where the
 * *absence* of an attribute is semantically load-bearing (an `<img>`
 * with no `alt` is a different rule-firing reason than one with
 * `alt="x"`; grouping the two together would merge unrelated buckets).
 *
 * The list is deliberately conservative — attributes whose absence is
 * already the rule's firing condition. It does not try to be a full
 * WCAG-required-attribute enumeration.
 */
function describeMissingForTag(tag: string, present: ReadonlySet<string>): string {
  const markers: string[] = [];
  if (tag === "img" && !present.has("alt")) markers.push("no-alt");
  if (tag === "input" && !present.has("type")) markers.push("no-type");
  if (tag === "button" && !present.has("type")) markers.push("no-type");
  if (tag === "a" && !present.has("href")) markers.push("no-href");
  if (tag === "html" && !present.has("lang")) markers.push("no-lang");
  if (markers.length === 0) return "";
  return `[missing=${markers.sort().join(",")}]`;
}

function describeHtmlChildren(children: readonly HtmlNode[]): string {
  if (children.length === 0) return "[children=empty]";
  let hasText = false;
  let hasElement = false;
  for (const c of children) {
    if (c.kind === "HtmlText" && c.value.trim().length > 0) hasText = true;
    else if (c.kind === "HtmlElement") hasElement = true;
  }
  return `[children=${classifyChildren(hasText, false, hasElement)}]`;
}

function describeJsxChildren(children: readonly JsxNode[]): string {
  if (children.length === 0) return "[children=empty]";
  let hasText = false;
  let hasExpr = false;
  let hasElement = false;
  for (const c of children) {
    if (c.kind === "JsxText" && c.value.trim().length > 0) hasText = true;
    else if (c.kind === "JsxExpression") hasExpr = true;
    else if (c.kind === "JsxElement") hasElement = true;
  }
  return `[children=${classifyChildren(hasText, hasExpr, hasElement)}]`;
}

function classifyChildren(hasText: boolean, hasExpr: boolean, hasElement: boolean): string {
  const flags = [hasText, hasExpr, hasElement].filter(Boolean).length;
  if (flags === 0) return "empty";
  if (flags > 1) return "mixed";
  if (hasText) return "text";
  if (hasExpr) return "expr";
  return "element";
}

/**
 * Canonicalizes a CSS selector string for grouping purposes:
 * class / id / attribute *values* are stripped, but selector type and
 * pseudo-class/pseudo-element markers are preserved because they alter
 * the rule's semantics (`.foo:focus-visible` is a different kind of
 * rule than `.foo:hover`).
 *
 * Deterministic and identifier-agnostic: `.login-btn:focus-visible`
 * and `.submit:focus-visible` both canonicalize to
 * `class-selector:focus-visible`.
 */
function canonicalizeCssSelector(selector: string): string {
  const parts: string[] = [];
  const trimmed = selector.trim();
  if (trimmed.length === 0) return "empty";
  // Collapse each comma-separated simple selector to its kind summary.
  for (const raw of trimmed.split(",")) {
    const s = raw.trim();
    if (s.length === 0) continue;
    parts.push(summarizeSimpleSelector(s));
  }
  return parts.sort().join("|");
}

function summarizeSimpleSelector(s: string): string {
  const kinds: string[] = [];
  if (s.startsWith(".")) kinds.push("class-selector");
  else if (s.startsWith("#")) kinds.push("id-selector");
  else if (s.startsWith("[")) kinds.push("attr-selector");
  else if (s.startsWith("*")) kinds.push("universal-selector");
  else if (/^[a-zA-Z]/.test(s)) kinds.push("type-selector");
  else kinds.push("other-selector");
  // Preserve pseudo-class and pseudo-element markers (values only —
  // `nth-child(…)` arguments are stripped).
  const pseudos = s.match(/::?[a-zA-Z-]+/g);
  if (pseudos) for (const p of pseudos.sort()) kinds.push(p);
  return kinds.join("");
}

// Internal location lookup --------------------------------------------------

/**
 * True when `(line, column)` falls within the (inclusive) line/column
 * range described by `loc`. Both inputs are 1-based. We use `loc`
 * rather than the byte-offset `range` because emitted violations carry
 * (line, column) and never byte offsets.
 */
function locationInNodeLoc(loc: NodeLoc, line: number, column: number): boolean {
  if (line < loc.start.line || line > loc.end.line) return false;
  if (line === loc.start.line && column < loc.start.column) return false;
  if (line === loc.end.line && column > loc.end.column) return false;
  return true;
}

function findHtmlTargetAtLocation(
  children: readonly HtmlNode[],
  line: number,
  column: number,
): HtmlElement | undefined {
  let best: HtmlElement | undefined;
  for (const child of children) {
    if (child.kind !== "HtmlElement") continue;
    if (!locationInNodeLoc(child.loc, line, column)) continue;
    best = child;
    const deeper = findHtmlTargetAtLocation(child.children, line, column);
    if (deeper) best = deeper;
  }
  return best;
}

function findJsxTargetAtLocation(
  elements: readonly JsxElement[],
  line: number,
  column: number,
): JsxElement | undefined {
  let best: JsxElement | undefined;
  for (const el of elements) {
    if (!locationInNodeLoc(el.loc, line, column)) continue;
    best = el;
    const deeper = findJsxTargetInChildren(el.children, line, column);
    if (deeper) best = deeper;
  }
  return best;
}

function findJsxTargetInChildren(
  children: readonly JsxNode[],
  line: number,
  column: number,
): JsxElement | undefined {
  let best: JsxElement | undefined;
  for (const c of children) {
    if (c.kind !== "JsxElement") continue;
    if (!locationInNodeLoc(c.loc, line, column)) continue;
    best = c;
    const deeper = findJsxTargetInChildren(c.children, line, column);
    if (deeper) best = deeper;
  }
  return best;
}

function findCssTargetAtLocation(
  nodes: readonly CssNode[],
  line: number,
  column: number,
): CssRule | CssAtRule | CssDeclaration | undefined {
  let best: CssRule | CssAtRule | CssDeclaration | undefined;
  for (const node of nodes) {
    const match = matchCssNodeAtLocation(node, line, column);
    if (match) best = match;
  }
  return best;
}

function matchCssNodeAtLocation(
  node: CssNode,
  line: number,
  column: number,
): CssRule | CssAtRule | CssDeclaration | undefined {
  if (node.kind === "CssComment") return undefined;
  if (!locationInNodeLoc(node.loc, line, column)) return undefined;
  if (node.kind === "CssRule") return matchInCssRule(node, line, column);
  return matchInCssAtRule(node, line, column);
}

function matchInCssRule(rule: CssRule, line: number, column: number): CssRule | CssDeclaration {
  for (const decl of rule.declarations) {
    if (locationInNodeLoc(decl.loc, line, column)) return decl;
  }
  return rule;
}

function matchInCssAtRule(
  atRule: CssAtRule,
  line: number,
  column: number,
): CssRule | CssAtRule | CssDeclaration {
  const deeper = findCssTargetAtLocation(atRule.children, line, column);
  return deeper ?? atRule;
}
