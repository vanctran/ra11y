/**
 * Rule: semantics/list-structure
 * Satisfies: wcag22:1.3.1, wcag21:1.3.1
 * Spec: https://www.w3.org/TR/WCAG22/#info-and-relationships
 *
 * > Information, structure, and relationships conveyed through
 * > presentation can be programmatically determined or are available
 * > in text.
 *
 * Source: https://www.w3.org/TR/WCAG22/#info-and-relationships
 *
 * Flags `<li>` elements whose direct parent is not `<ul>`, `<ol>`, or
 * `<menu>`. List items outside a list container are not announced as
 * a list by screen readers — the "3 items" semantic gets lost, and
 * the user can't use list-navigation shortcuts.
 *
 * Also flags the inverse: `<ul>`/`<ol>` with non-`<li>` element
 * children (script/template excepted) is a structural error.
 */

import { defineRule } from "../../api/plugin.ts";
import {
  findHtmlElementsByTag,
  findJsxElementsByTag,
  walkHtmlElements,
  walkJsxElements,
} from "../../engine/ast-helpers.ts";
import type {
  HtmlDocument,
  HtmlElement,
  HtmlNode,
  JsxElement,
  JsxNode,
  TsxModule,
} from "../../types/ast.ts";

const LIST_PARENTS: ReadonlySet<string> = new Set(["ul", "ol", "menu"]);
const ALLOWED_IN_LIST: ReadonlySet<string> = new Set(["li", "script", "template"]);

export const rule = defineRule({
  id: "semantics/list-structure",
  satisfies: ["wcag22:1.3.1", "wcag21:1.3.1"],
  severity: "warning",
  scope: "node",
  appliesTo: {
    fileExtensions: [".html", ".htm", ".tsx", ".jsx"],
  },
  docs: {
    description:
      "<li> must be a direct child of <ul>, <ol>, or <menu>. List containers must only contain <li> (plus script/template).",
    rationale:
      "Screen readers announce lists as 'list, 3 items' and let users navigate item-by-item with list shortcuts. A stray <li> outside a list container is announced as a generic text block — the list semantic is lost. Mirrored: a <ul> with <div> children instead of <li> is not a list at all.",
    goodExample: `<ul>\n  <li>Home</li>\n  <li>About</li>\n  <li>Contact</li>\n</ul>`,
    badExample: `<div>\n  <li>Home</li>\n  <li>About</li>\n</div>`,
    normativeQuote:
      "Information, structure, and relationships conveyed through presentation can be programmatically determined.",
    references: [
      "https://www.w3.org/TR/WCAG22/#info-and-relationships",
      "https://html.spec.whatwg.org/#the-li-element",
    ],
  },
  check(ctx) {
    if (ctx.language === "html") {
      checkHtml(ctx.ast as HtmlDocument, (v) => ctx.emit(v));
    } else if (
      ctx.language === "tsx" ||
      ctx.language === "jsx" ||
      ctx.language === "ts" ||
      ctx.language === "js"
    ) {
      checkJsx(ctx.ast as TsxModule, (v) => ctx.emit(v));
    }
  },
});

type Emit = (v: {
  severity: "error" | "warning" | "info";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
}) => void;

// NOTE: the primitive-component case is JSX-only. In HTML, a top-level
// <li> is a page-level authoring error, not a component definition.

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function checkHtml(doc: HtmlDocument, emit: Emit): void {
  const parentOf = buildHtmlParentMap(doc);
  for (const li of walkHtmlElements(doc)) {
    if (li.tagName.toLowerCase() !== "li") continue;
    const parent = parentOf.get(li);
    if (parent && LIST_PARENTS.has(parent.tagName.toLowerCase())) continue;
    emit(buildStrayLiViolation(li.loc.start));
  }
  for (const list of findHtmlListContainers(doc)) {
    for (const child of list.children) {
      if (child.kind !== "HtmlElement") continue;
      if (ALLOWED_IN_LIST.has(child.tagName.toLowerCase())) continue;
      emit(buildWrongChildViolation(list.tagName, child.tagName, child.loc.start));
    }
  }
}

function findHtmlListContainers(doc: HtmlDocument): readonly HtmlElement[] {
  const out: HtmlElement[] = [];
  for (const tag of LIST_PARENTS) {
    for (const el of findHtmlElementsByTag(doc, tag)) out.push(el);
  }
  return out;
}

/**
 * Builds a child→parent index for every HtmlElement in the document.
 * We maintain this ourselves (instead of storing parent refs on the
 * nodes) because the parser owns the AST and we don't want rules to
 * mutate it. Rebuilt per rule invocation — cheap for realistic docs.
 */
function buildHtmlParentMap(doc: HtmlDocument): Map<HtmlElement, HtmlElement> {
  const parentOf = new Map<HtmlElement, HtmlElement>();
  const visit = (node: HtmlNode, parent: HtmlElement | null): void => {
    if (node.kind !== "HtmlElement") return;
    if (parent) parentOf.set(node, parent);
    for (const child of node.children) visit(child, node);
  };
  for (const top of doc.children) visit(top, null);
  return parentOf;
}

// ---------------------------------------------------------------------------
// JSX
// ---------------------------------------------------------------------------

function checkJsx(module: TsxModule, emit: Emit): void {
  const parentOf = buildJsxParentMap(module);
  checkJsxStrayLi(module, parentOf, emit);
  checkJsxListContainerChildren(module, emit);
}

function checkJsxStrayLi(
  module: TsxModule,
  parentOf: Map<JsxElement, JsxElement>,
  emit: Emit,
): void {
  for (const li of walkJsxElements(module)) {
    if (li.tagName !== "li") continue;
    const parent = parentOf.get(li);
    if (parent && LIST_PARENTS.has(parent.tagName)) continue;
    // PascalCase parent: may render a <ul>/<ol>/<menu> internally (e.g.,
    // Radix NavigationMenuList). Mirrors the PascalCase-child skip in
    // checkJsxListContainerChildren — native-wrapper awareness lives at
    // the component level.
    if (parent && isJsxPascalCase(parent.tagName)) continue;
    if (!parent) {
      // Top-level <li> in a JSX module: the element is the root of a
      // component return (e.g., `function GridItem() { return <li>…</li>; }`).
      // Static analysis can't see the call site, so we surface it as info
      // rather than assert a violation — the agent reads the file and
      // decides.
      emit(buildPrimitiveLiViolation(li.loc.start));
      continue;
    }
    emit(buildStrayLiViolation(li.loc.start));
  }
}

function checkJsxListContainerChildren(module: TsxModule, emit: Emit): void {
  for (const list of findJsxListContainers(module)) {
    for (const child of list.children) {
      if (child.kind !== "JsxElement") continue;
      if (isJsxPascalCase(child.tagName)) continue;
      if (ALLOWED_IN_LIST.has(child.tagName)) continue;
      emit(buildWrongChildViolation(list.tagName, child.tagName, child.loc.start));
    }
  }
}

function isJsxPascalCase(tag: string): boolean {
  const first = tag[0];
  return first !== undefined && first >= "A" && first <= "Z";
}

function findJsxListContainers(module: TsxModule): readonly JsxElement[] {
  const out: JsxElement[] = [];
  for (const tag of LIST_PARENTS) {
    for (const el of findJsxElementsByTag(module, tag)) out.push(el);
  }
  return out;
}

function buildJsxParentMap(module: TsxModule): Map<JsxElement, JsxElement> {
  const parentOf = new Map<JsxElement, JsxElement>();
  const visit = (node: JsxNode, parent: JsxElement | null): void => {
    if (node.kind !== "JsxElement") return;
    if (parent) parentOf.set(node, parent);
    for (const child of node.children) visit(child, node);
  };
  for (const top of module.jsxElements) visit(top, null);
  return parentOf;
}

// ---------------------------------------------------------------------------
// Violation builders
// ---------------------------------------------------------------------------

function buildStrayLiViolation(loc: { line: number; column: number }): {
  severity: "warning";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
} {
  return {
    severity: "warning",
    location: { filePath: "", line: loc.line, column: loc.column },
    message: `<li> is not inside a <ul>, <ol>, or <menu> — the list semantic is lost and screen readers won't announce it as a list item.`,
    suggestion: `Wrap the <li> in a <ul> or <ol>. If you need a flat text container, use a <p> or <span> instead.`,
  };
}

function buildPrimitiveLiViolation(loc: { line: number; column: number }): {
  severity: "info";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
} {
  return {
    severity: "info",
    location: { filePath: "", line: loc.line, column: loc.column },
    message: `<li> is the root of a JSX return — this looks like a component primitive, so ra11y cannot see whether call sites render it inside a <ul>, <ol>, or <menu>. Verify at usage sites.`,
    suggestion: `If this component is only ever consumed inside a list container, it is fine — add \`{/* ra11y-disable semantics/list-structure */}\` at the top of the file to silence this info note. Otherwise move the <li> inside a <ul>/<ol>, or change the root element to <p>/<span>.`,
  };
}

function buildWrongChildViolation(
  parentTag: string,
  childTag: string,
  loc: { line: number; column: number },
): {
  severity: "warning";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
} {
  return {
    severity: "warning",
    location: { filePath: "", line: loc.line, column: loc.column },
    message: `<${parentTag}> contains <${childTag}> as a direct child — list containers must only contain <li>.`,
    suggestion: `Move the <${childTag}> inside an <li>, or — if the parent isn't really a list — use a <div> instead of <${parentTag}>.`,
  };
}
