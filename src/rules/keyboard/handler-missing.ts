/**
 * Rule: keyboard/handler-missing
 * Satisfies: wcag22:2.1.1, wcag21:2.1.1
 * Spec: https://www.w3.org/TR/WCAG22/#keyboard
 *
 * > All functionality of the content is operable through a keyboard
 * > interface without requiring specific timings for individual
 * > keystrokes.
 *
 * Source: https://www.w3.org/TR/WCAG22/#keyboard
 *
 * Flags JSX/HTML elements that attach a click handler to a non-
 * interactive element without a corresponding keyboard handler.
 * Non-interactive means: any element that isn't a native interactive
 * element (a[href], button, input, select, textarea, area[href])
 * and doesn't have role="button" / role="link".
 *
 * The WCAG failure pattern: `<div onClick={…}>` in React or
 * `<div onclick="…">` in HTML. Mouse users can click it; keyboard
 * users can't reach it or press Enter to activate it.
 *
 * v0.0.x covers JSX (the dominant source of this problem in React
 * codebases). HTML detection is simpler and added here too for
 * completeness.
 */

import { defineRule } from "../../api/plugin.ts";
import {
  findHtmlElementsByTag,
  findJsxElementsByTag,
  getHtmlAttribute,
  getJsxAttributeString,
  hasHtmlAttribute,
  hasJsxAttribute,
  walkHtmlElements,
  walkJsxElements,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, TsxModule } from "../../types/ast.ts";

/** HTML tags that are natively interactive and therefore exempt. */
const NATIVELY_INTERACTIVE_TAGS: ReadonlySet<string> = new Set([
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
]);

export const rule = defineRule({
  id: "keyboard/handler-missing",
  satisfies: ["wcag22:2.1.1", "wcag21:2.1.1"],
  severity: "error",
  scope: "node",
  appliesTo: {
    fileExtensions: [".html", ".htm", ".tsx", ".jsx"],
  },
  docs: {
    description:
      "Elements with onClick must be reachable by keyboard: either use a native button/link or attach an onKeyDown/onKeyUp and set tabIndex.",
    rationale:
      "Mouse users can click anywhere; keyboard users can't. An onClick on a bare <div> means the functionality is invisible to people who navigate with the keyboard — blind users, motor-impaired users, and anyone without a mouse. The fix is almost always to use a <button> instead.",
    goodExample: `<button type="button" onClick={handleDelete}>Delete</button>`,
    badExample: `<div onClick={handleDelete}>Delete</div>`,
    normativeQuote: "All functionality of the content is operable through a keyboard interface.",
    references: [
      "https://www.w3.org/TR/WCAG22/#keyboard",
      "https://www.w3.org/WAI/WCAG22/Techniques/general/G202",
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

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function checkHtml(doc: HtmlDocument, emit: Emit): void {
  for (const el of walkHtmlElements(doc)) {
    const violation = checkOneHtmlElement(el);
    if (violation) emit(violation);
  }
  for (const anchor of findHtmlElementsByTag(doc, "a")) {
    const violation = checkOneHtmlAnchor(anchor);
    if (violation) emit(violation);
  }
}

function checkOneHtmlElement(el: import("../../types/ast.ts").HtmlElement): {
  severity: "error";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
} | null {
  if (!hasHtmlAttribute(el, "onclick")) return null;
  if (isNativelyInteractive(el.tagName.toLowerCase())) return null;
  // role="button"/etc. does NOT exempt — see module doc comment.
  if (hasHtmlAttribute(el, "onkeydown") || hasHtmlAttribute(el, "onkeyup")) return null;
  return {
    severity: "error",
    location: { filePath: "", line: el.loc.start.line, column: el.loc.start.column },
    message: `<${el.tagName}> has onclick but no keyboard handler — keyboard users can't activate it.`,
    suggestion: buildSuggestion(el.tagName, getHtmlAttribute(el, "role") ?? null),
  };
}

function checkOneHtmlAnchor(anchor: import("../../types/ast.ts").HtmlElement): {
  severity: "error";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
} | null {
  if (hasHtmlAttribute(anchor, "href")) return null;
  if (!hasHtmlAttribute(anchor, "onclick")) return null;
  if (hasHtmlAttribute(anchor, "onkeydown") || hasHtmlAttribute(anchor, "onkeyup")) return null;
  return {
    severity: "error",
    location: { filePath: "", line: anchor.loc.start.line, column: anchor.loc.start.column },
    message: `<a> without href but with onclick is not keyboard-focusable. Add href, change to <button>, or set tabindex.`,
    suggestion:
      'Replace with <button type="button"> if the element triggers an action, or add a real href if it navigates.',
  };
}

// ---------------------------------------------------------------------------
// JSX
// ---------------------------------------------------------------------------

function checkJsx(module: TsxModule, emit: Emit): void {
  for (const el of walkJsxElements(module)) {
    const violation = checkOneJsxElement(el);
    if (violation) emit(violation);
  }
  for (const anchor of findJsxElementsByTag(module, "a")) {
    const violation = checkOneJsxAnchor(anchor);
    if (violation) emit(violation);
  }
}

function checkOneJsxElement(el: import("../../types/ast.ts").JsxElement): {
  severity: "error" | "warning" | "info";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
} | null {
  if (!hasJsxAttribute(el, "onClick")) return null;
  if (isNativelyInteractive(el.tagName.toLowerCase())) return null;
  if (hasJsxAttribute(el, "onKeyDown") || hasJsxAttribute(el, "onKeyUp")) return null;
  // PascalCase components (ActionButton, ResetButton, etc.) likely wrap
  // a native interactive element internally. We can't see through the
  // component boundary — emit as "info" (not error/warning) so it's
  // visible but doesn't cry wolf. Agents can verify by reading the
  // component source; humans review at their discretion.
  if (isPascalCaseComponent(el.tagName)) {
    return {
      severity: "info",
      location: { filePath: "", line: el.loc.start.line, column: el.loc.start.column },
      message: `<${el.tagName}> has onClick — verify it renders a native interactive element (button/a) internally.`,
      suggestion: `If <${el.tagName}> renders a <button> or <a> internally, this is fine. If it renders a <div> or <span>, add onKeyDown/onKeyUp handling and tabIndex={0}.`,
    };
  }
  return {
    severity: "error",
    location: { filePath: "", line: el.loc.start.line, column: el.loc.start.column },
    message: `<${el.tagName}> has onClick but no keyboard handler — keyboard users can't activate it.`,
    suggestion: buildSuggestion(el.tagName, getJsxAttributeString(el, "role")),
  };
}

function checkOneJsxAnchor(anchor: import("../../types/ast.ts").JsxElement): {
  severity: "error";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
} | null {
  if (hasJsxAttribute(anchor, "href")) return null;
  if (!hasJsxAttribute(anchor, "onClick")) return null;
  if (hasJsxAttribute(anchor, "onKeyDown") || hasJsxAttribute(anchor, "onKeyUp")) return null;
  return {
    severity: "error",
    location: { filePath: "", line: anchor.loc.start.line, column: anchor.loc.start.column },
    message: `<a> without href but with onClick is not keyboard-focusable.`,
    suggestion:
      'Replace with <button type="button"> if it triggers an action, or add a real href if it navigates.',
  };
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function isNativelyInteractive(tagName: string): boolean {
  return NATIVELY_INTERACTIVE_TAGS.has(tagName);
}

function isPascalCaseComponent(tagName: string): boolean {
  const first = tagName[0];
  return first !== undefined && first >= "A" && first <= "Z";
}

function buildSuggestion(tagName: string, role: string | null): string {
  if (role) {
    return `This <${tagName}> has role="${role}" but no keyboard handler. Add onKeyDown/onKeyUp handling Enter and Space keys, and ensure the element has tabIndex={0} so it's focusable.`;
  }
  return `The simplest fix is to change <${tagName}> to <button type="button"> — buttons are focusable, announce as "button" to screen readers, and fire onClick on Enter/Space automatically.`;
}
