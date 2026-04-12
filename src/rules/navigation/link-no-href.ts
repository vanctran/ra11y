/**
 * Rule: navigation/link-no-href
 * Satisfies: wcag22:2.1.1, wcag21:2.1.1, wcag22:4.1.2, wcag21:4.1.2
 * Spec: https://www.w3.org/TR/WCAG22/#keyboard
 *
 * > All functionality of the content is operable through a keyboard
 * > interface without requiring specific timings for individual
 * > keystrokes […].
 *
 * Source: https://www.w3.org/TR/WCAG22/#keyboard
 *
 * An `<a>` without an `href` is not in the default keyboard tab order
 * and is announced by screen readers as a generic container, not as
 * a link. If the element has an `onClick` (or `onclick`) handler, it
 * behaves like a button but can't be reached with Tab and can't be
 * activated with Enter — keyboard and AT users are locked out.
 *
 * The HTML spec is explicit: "The href content attribute on a and
 * area elements must have a value that is a valid URL potentially
 * surrounded by spaces." (https://html.spec.whatwg.org/#the-a-element)
 *
 * The fix depends on intent:
 *   - A link that navigates → add href
 *   - A control that toggles/submits → use <button type="button">
 *     instead of a bare <a onClick>
 */

import { defineRule } from "../../api/plugin.ts";
import {
  findHtmlElementsByTag,
  findJsxElementsByTag,
  hasHtmlAttribute,
  hasJsxAttribute,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, HtmlElement, JsxElement, TsxModule } from "../../types/ast.ts";

export const rule = defineRule({
  id: "navigation/link-no-href",
  satisfies: ["wcag22:2.1.1", "wcag21:2.1.1", "wcag22:4.1.2", "wcag21:4.1.2"],
  severity: "error",
  scope: "node",
  appliesTo: {
    fileExtensions: [".html", ".htm", ".tsx", ".jsx"],
  },
  docs: {
    description:
      "<a> elements with onClick but no href are not keyboard-operable and are announced as generic containers. Use <button> instead, or add a real href.",
    rationale:
      "An anchor without an href is a dead link. It's not in the tab order, Enter doesn't activate it, and screen readers announce it as a generic container with no role. The common pattern <a onclick='…'>Click me</a> breaks keyboard and screen-reader users completely.",
    goodExample: `<button type="button" onClick={handleClick}>Toggle menu</button>`,
    badExample: `<a onClick={handleClick}>Toggle menu</a>`,
    normativeQuote: "All functionality of the content is operable through a keyboard interface.",
    references: [
      "https://www.w3.org/TR/WCAG22/#keyboard",
      "https://html.spec.whatwg.org/#the-a-element",
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
  for (const anchor of findHtmlElementsByTag(doc, "a")) {
    if (hasHtmlAttribute(anchor, "href")) continue;
    if (!hasClickHandlerHtml(anchor)) continue;
    emit(buildViolation(anchor.loc.start));
  }
}

function hasClickHandlerHtml(element: HtmlElement): boolean {
  // HTML attribute names are case-insensitive.
  return hasHtmlAttribute(element, "onclick");
}

function checkJsx(module: TsxModule, emit: Emit): void {
  for (const anchor of findJsxElementsByTag(module, "a")) {
    if (hasJsxAttribute(anchor, "href")) continue;
    if (!hasClickHandlerJsx(anchor)) continue;
    emit(buildViolation(anchor.loc.start));
  }
}

function hasClickHandlerJsx(element: JsxElement): boolean {
  // React uses onClick (camelCase). The JSX parser preserves casing.
  return hasJsxAttribute(element, "onClick");
}

function buildViolation(loc: { line: number; column: number }): {
  severity: "error";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
} {
  return {
    severity: "error",
    location: { filePath: "", line: loc.line, column: loc.column },
    message: `<a> with a click handler but no href is not keyboard-operable — it's not in the tab order and Enter won't activate it.`,
    suggestion: `If this element navigates, add href="…". If it toggles or submits, use <button type="button"> instead. Bare <a> with only an onClick is never the right choice.`,
  };
}
