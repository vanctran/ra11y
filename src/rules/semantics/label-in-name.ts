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
  getJsxAttributeString,
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
    const visibleText = collapseWhitespace(visibleTextHtml(element));
    const normalizedAria = collapseWhitespace(ariaLabel);
    if (visibleText.length === 0) continue;
    if (containsSubstring(normalizedAria, visibleText)) continue;
    emitViolation(element.tagName, visibleText, normalizedAria, element.loc.start, emit);
  }
}

/** Text content excluding aria-hidden subtrees — the text a sighted user sees. */
function visibleTextHtml(element: HtmlElement): string {
  const chunks: string[] = [];
  for (const child of element.children) visitHtmlVisible(child, chunks);
  return chunks.join("").trim();
}

function visitHtmlVisible(node: HtmlElement["children"][number], chunks: string[]): void {
  if (node.kind === "HtmlText") {
    chunks.push(node.value);
    return;
  }
  if (node.kind !== "HtmlElement") return;
  if (getHtmlAttribute(node, "aria-hidden") === "true") return;
  for (const child of node.children) visitHtmlVisible(child, chunks);
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
    const ariaLabel = collapseWhitespace(ariaAttr.value.value);
    if (ariaLabel.length === 0) continue;
    const visibleText = collapseWhitespace(visibleTextJsx(element));
    if (visibleText.length === 0) continue;
    if (containsSubstring(ariaLabel, visibleText)) continue;
    emitViolation(element.tagName, visibleText, ariaLabel, element.loc.start, emit);
  }
}

/** Text content excluding aria-hidden subtrees in JSX. */
function visibleTextJsx(element: JsxElement): string {
  const chunks: string[] = [];
  for (const child of element.children) visitJsxVisible(child, chunks);
  return chunks.join("").trim();
}

function visitJsxVisible(node: JsxElement["children"][number], chunks: string[]): void {
  if (node.kind === "JsxText") {
    chunks.push(node.value);
    return;
  }
  if (node.kind !== "JsxElement") return;
  if (getJsxAttributeString(node, "aria-hidden") === "true") return;
  for (const child of node.children) visitJsxVisible(child, chunks);
}

function isInteractiveJsx(element: JsxElement): boolean {
  return HTML_INTERACTIVE_TAGS.has(element.tagName.toLowerCase());
}

function containsSubstring(name: string, visibleText: string): boolean {
  return name.toLowerCase().includes(visibleText.toLowerCase());
}

/**
 * Collapses all whitespace runs (including newlines and tabs from JSX
 * source indentation) to a single space and trims. This matches what a
 * browser renders for inline-text content — a user sees one space
 * between adjacent `<span>`s, regardless of how many newlines separated
 * them in source. Skipping this step made the substring check fail on
 * correctly-authored code that happened to split visible text across
 * lines.
 */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
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
    suggestion: `Three resolution paths: (1) widen aria-label to contain the visible text (e.g., aria-label="${visibleText} — additional context"); (2) if part of the visible text is a decorative icon or symbol (\u25b2, arrows, glyphs), mark its container \`aria-hidden="true"\` so it isn't part of the visible label; (3) remove aria-label and let the visible text serve as the accessible name directly.`,
  });
}
