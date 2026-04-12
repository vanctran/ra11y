/**
 * Rule: semantics/empty-heading
 * Satisfies: wcag22:2.4.6, wcag21:2.4.6
 * Spec: https://www.w3.org/TR/WCAG22/#headings-and-labels
 *
 * > Headings and labels describe topic or purpose.
 *
 * Source: https://www.w3.org/TR/WCAG22/#headings-and-labels
 *
 * Flags <h1>-<h6> elements that are empty, contain only whitespace,
 * or contain only non-text children (e.g., an <svg> or <img> without
 * alt text). An empty heading is invisible to screen-reader navigation
 * shortcuts and degrades the heading outline.
 *
 * Complements semantics/heading-hierarchy (which checks order, not content).
 */

import { defineRule } from "../../api/plugin.ts";
import {
  findHtmlElementsByTag,
  findJsxElementsByTag,
  getHtmlAttribute,
  getJsxAttributeString,
  hasHtmlAttribute,
  hasJsxAttribute,
  htmlTextContent,
  jsxTextContent,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, HtmlElement, JsxElement, TsxModule } from "../../types/ast.ts";

const HEADING_TAGS: readonly string[] = ["h1", "h2", "h3", "h4", "h5", "h6"];

export const rule = defineRule({
  id: "semantics/empty-heading",
  satisfies: ["wcag22:2.4.6", "wcag21:2.4.6"],
  severity: "error",
  scope: "node",
  appliesTo: {
    fileExtensions: [".html", ".htm", ".tsx", ".jsx"],
  },
  docs: {
    description:
      "Heading elements (<h1>-<h6>) must have text content. Empty or whitespace-only headings are invisible to assistive technology.",
    rationale:
      "Screen-reader users navigate pages by jumping between headings. An empty heading appears in the heading outline as a blank entry, providing no context and disrupting navigation flow.",
    goodExample: `<h2>Contact Information</h2>`,
    badExample: `<h2></h2>\n<h2>   </h2>\n<h2><svg aria-hidden="true"></svg></h2>`,
    normativeQuote: "Headings and labels describe topic or purpose.",
    references: [
      "https://www.w3.org/TR/WCAG22/#headings-and-labels",
      "https://www.w3.org/WAI/WCAG22/Techniques/general/G130",
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

function checkHtml(doc: HtmlDocument, emit: Emit): void {
  for (const tag of HEADING_TAGS) {
    for (const element of findHtmlElementsByTag(doc, tag)) {
      if (hasAccessibleContentHtml(element)) continue;
      emitViolation(element.tagName, element.loc.start.line, element.loc.start.column, emit);
    }
  }
}

function hasAccessibleContentHtml(element: HtmlElement): boolean {
  // Direct text content
  if (htmlTextContent(element).length > 0) return true;
  // aria-label provides an accessible name
  const ariaLabel = getHtmlAttribute(element, "aria-label");
  if (ariaLabel !== null && ariaLabel.trim().length > 0) return true;
  // aria-labelledby references an external label
  if (hasHtmlAttribute(element, "aria-labelledby")) return true;
  // Check for child <img> with alt text
  if (hasChildImageWithAltHtml(element)) return true;
  return false;
}

function hasChildImageWithAltHtml(element: HtmlElement): boolean {
  for (const child of element.children) {
    if (child.kind !== "HtmlElement") continue;
    if (child.tagName.toLowerCase() === "img") {
      const alt = getHtmlAttribute(child, "alt");
      if (alt !== null && alt.trim().length > 0) return true;
    }
    // Recurse into nested elements
    if (hasChildImageWithAltHtml(child)) return true;
  }
  return false;
}

function checkJsx(module: TsxModule, emit: Emit): void {
  for (const tag of HEADING_TAGS) {
    for (const element of findJsxElementsByTag(module, tag)) {
      if (hasAccessibleContentJsx(element)) continue;
      emitViolation(element.tagName, element.loc.start.line, element.loc.start.column, emit);
    }
  }
}

function hasAccessibleContentJsx(element: JsxElement): boolean {
  // Direct text content
  if (jsxTextContent(element).length > 0) return true;
  // aria-label provides an accessible name
  const ariaLabel = getJsxAttributeString(element, "aria-label");
  if (ariaLabel !== null && ariaLabel.trim().length > 0) return true;
  // aria-labelledby references an external label
  if (hasJsxAttribute(element, "aria-labelledby")) return true;
  // Runtime expression children — assume developer is computing content
  if (hasExpressionChild(element)) return true;
  // Check for child <img> with alt text
  if (hasChildImageWithAltJsx(element)) return true;
  return false;
}

function hasExpressionChild(element: JsxElement): boolean {
  for (const child of element.children) {
    if (child.kind === "JsxExpression") return true;
  }
  return false;
}

function hasChildImageWithAltJsx(element: JsxElement): boolean {
  for (const child of element.children) {
    if (child.kind !== "JsxElement") continue;
    if (child.tagName === "img") {
      const alt = getJsxAttributeString(child, "alt");
      if (alt !== null && alt.trim().length > 0) return true;
    }
    // PascalCase components might render accessible content
    if (/^[A-Z]/.test(child.tagName)) return true;
    if (hasChildImageWithAltJsx(child)) return true;
  }
  return false;
}

function emitViolation(tagName: string, line: number, column: number, emit: Emit): void {
  emit({
    severity: "error",
    location: { filePath: "", line, column },
    message: `<${tagName}> is empty — it appears in the heading outline but describes no topic or purpose.`,
    suggestion: `Add descriptive text inside <${tagName}> that summarizes the section it introduces. If the heading is used for visual styling only, replace it with a styled <p> or <div> and apply CSS to achieve the same appearance.`,
  });
}
