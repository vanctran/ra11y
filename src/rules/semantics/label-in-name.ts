/**
 * Rule: semantics/label-in-name
 * Satisfies: wcag22:2.5.3, wcag21:2.5.3
 * Spec: https://www.w3.org/TR/WCAG22/#label-in-name
 *
 * > For user interface components with labels that include text or
 * > images of text, the name contains the text that is presented
 * > visually.
 *
 * Source: https://www.w3.org/TR/WCAG22/#label-in-name
 *
 * Flags elements where aria-label does not contain the visible text
 * content as a case-insensitive substring. Only fires when both the
 * visible text and aria-label are non-empty string literals (skips
 * expressions to avoid false positives).
 *
 * Example violation: <button aria-label="Submit form">Send</button>
 * "Send" is not a substring of "Submit form".
 */

import { defineRule } from "../../api/plugin.ts";
import {
  getHtmlAttribute,
  getJsxAttribute,
  htmlTextContent,
  jsxTextContent,
  walkHtmlElements,
  walkJsxElements,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, HtmlElement, JsxElement, TsxModule } from "../../types/ast.ts";

/** Interactive elements whose visible label must be contained in their accessible name. */
const HTML_INTERACTIVE_TAGS: ReadonlySet<string> = new Set([
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "summary",
]);

export const rule = defineRule({
  id: "semantics/label-in-name",
  satisfies: ["wcag22:2.5.3", "wcag21:2.5.3"],
  severity: "error",
  scope: "node",
  appliesTo: {
    fileExtensions: [".html", ".htm", ".tsx", ".jsx"],
  },
  docs: {
    description:
      "When an interactive element has both visible text and an aria-label, the aria-label must contain the visible text as a substring.",
    rationale:
      "Voice-control users activate controls by speaking their visible label. If the accessible name (aria-label) doesn't contain that visible text, the voice command fails — the user sees 'Send' but the system only recognizes 'Submit form'.",
    goodExample: `<button aria-label="Send message">Send</button>`,
    badExample: `<button aria-label="Submit form">Send</button>`,
    normativeQuote:
      "For user interface components with labels that include text or images of text, the name contains the text that is presented visually.",
    references: [
      "https://www.w3.org/TR/WCAG22/#label-in-name",
      "https://www.w3.org/WAI/WCAG22/Understanding/label-in-name",
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
  for (const element of walkHtmlElements(doc)) {
    if (!isInteractiveHtml(element)) continue;
    const ariaLabel = getHtmlAttribute(element, "aria-label");
    if (ariaLabel === null || ariaLabel.trim().length === 0) continue;
    const visibleText = htmlTextContent(element).trim();
    if (visibleText.length === 0) continue;
    if (containsSubstring(ariaLabel, visibleText)) continue;
    emitViolation(element.tagName, visibleText, ariaLabel, element.loc.start, emit);
  }
}

function isInteractiveHtml(element: HtmlElement): boolean {
  return HTML_INTERACTIVE_TAGS.has(element.tagName.toLowerCase());
}

function checkJsx(module: TsxModule, emit: Emit): void {
  for (const element of walkJsxElements(module)) {
    if (!isInteractiveJsx(element)) continue;
    // Only check string-literal aria-label — skip expressions
    const ariaAttr = getJsxAttribute(element, "aria-label");
    if (!ariaAttr?.value || ariaAttr.value.kind !== "StringLiteral") continue;
    const ariaLabel = ariaAttr.value.value.trim();
    if (ariaLabel.length === 0) continue;
    const visibleText = jsxTextContent(element).trim();
    if (visibleText.length === 0) continue;
    if (containsSubstring(ariaLabel, visibleText)) continue;
    emitViolation(element.tagName, visibleText, ariaLabel, element.loc.start, emit);
  }
}

function isInteractiveJsx(element: JsxElement): boolean {
  return HTML_INTERACTIVE_TAGS.has(element.tagName.toLowerCase());
}

function containsSubstring(name: string, visibleText: string): boolean {
  return name.toLowerCase().includes(visibleText.toLowerCase());
}

function emitViolation(
  tagName: string,
  visibleText: string,
  ariaLabel: string,
  loc: { line: number; column: number },
  emit: Emit,
): void {
  emit({
    severity: "error",
    location: { filePath: "", line: loc.line, column: loc.column },
    message: `<${tagName}> has visible text "${visibleText}" that is not contained in aria-label "${ariaLabel}" — voice-control users cannot activate this control by speaking its visible label.`,
    suggestion: `Change aria-label to include the visible text "${visibleText}" as a substring (e.g., aria-label="${visibleText} — additional context"). Or remove aria-label and let the visible text serve as the accessible name.`,
  });
}
