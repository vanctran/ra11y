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
export function findJsxElementsByTag(
  module: TsxModule,
  tag: string,
): readonly JsxElement[] {
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
  if (!attr || !attr.value) return null;
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
