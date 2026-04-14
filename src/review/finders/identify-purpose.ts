/**
 * Candidate finder: review/identify-purpose
 * Criteria: wcag22:1.3.6 (identify purpose, AAA)
 *
 * Spec: https://www.w3.org/TR/WCAG22/#identify-purpose
 *       https://www.w3.org/TR/WCAG22/#input-purposes
 *
 * Surfaces form controls that collect user information but have no
 * `autocomplete` attribute. 1.3.6 requires that the purpose of user
 * interface components collecting information about the user can be
 * programmatically determined — in practice the `autocomplete` token
 * from the WCAG Input Purposes list is the primary mechanism.
 *
 * Not every input needs autocomplete — a search box doesn't — so this
 * is a review candidate, not a violation. Per CLAUDE.md §1 the finder
 * points at every control that could plausibly collect a purpose; the
 * reviewer decides whether the WCAG Input Purposes list covers it.
 */

import { defineCandidateFinder } from "../../api/plugin.ts";
import {
  findHtmlElementsByTag,
  findJsxElementsByTag,
  getHtmlAttribute,
  getJsxAttributeString,
  hasHtmlAttribute,
  hasJsxAttribute,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, HtmlElement, JsxElement, TsxModule } from "../../types/ast.ts";
import type { ReviewCandidate } from "../../types/review.ts";

const CRITERION_IDS = ["wcag22:1.3.6", "wcag21:1.3.6"] as const;

/**
 * Input `type` values that commonly collect user information matching
 * the WCAG Input Purposes list. Types like "button", "submit", "reset",
 * "hidden", "file", "checkbox", "radio", "range", "color" don't.
 */
const PURPOSABLE_INPUT_TYPES: ReadonlySet<string> = new Set([
  "text",
  "email",
  "tel",
  "url",
  "password",
  "search",
  "number",
  "date",
  "month",
  "week",
  "time",
  "datetime-local",
]);

const REASON = `no autocomplete attribute — if this control collects information matching a WCAG Input Purpose (e.g., name, email, tel, street-address, cc-number, bday), set autocomplete="<token>" so the purpose can be programmatically determined`;

export const finder = defineCandidateFinder({
  id: "review/identify-purpose",
  criterionIds: [...CRITERION_IDS],
  scope: "node",
  appliesTo: { fileExtensions: [".html", ".htm", ".tsx", ".jsx"] },
  docs: {
    description:
      "Finds <input>, <select>, and <textarea> controls without an autocomplete attribute — candidates for WCAG 1.3.6 review.",
    reviewPrompt:
      "For each control, determine whether it collects information from the user that matches an item on the WCAG Input Purposes list (name, email, address, billing, payment, etc.). If so, add the corresponding `autocomplete` token. Controls that do not collect personal information (search boxes, non-PII form fields) are out of scope.",
    references: [
      "https://www.w3.org/TR/WCAG22/#identify-purpose",
      "https://www.w3.org/TR/WCAG22/#input-purposes",
    ],
  },
  find(ctx) {
    const out: ReviewCandidate[] = [];
    if (ctx.language === "html") {
      collectHtml(ctx.ast as HtmlDocument, ctx.filePath, out);
    } else if (ctx.language === "tsx" || ctx.language === "jsx") {
      collectJsx(ctx.ast as TsxModule, ctx.filePath, out);
    }
    return out;
  },
});

function collectHtml(root: HtmlDocument, filePath: string, out: ReviewCandidate[]): void {
  for (const el of findHtmlElementsByTag(root, "input")) {
    if (!htmlInputNeedsReview(el)) continue;
    emitHtml(el, filePath, out);
  }
  for (const el of findHtmlElementsByTag(root, "select")) {
    if (hasHtmlAttribute(el, "autocomplete")) continue;
    emitHtml(el, filePath, out);
  }
  for (const el of findHtmlElementsByTag(root, "textarea")) {
    if (hasHtmlAttribute(el, "autocomplete")) continue;
    emitHtml(el, filePath, out);
  }
}

function collectJsx(root: TsxModule, filePath: string, out: ReviewCandidate[]): void {
  for (const el of findJsxElementsByTag(root, "input")) {
    if (!jsxInputNeedsReview(el)) continue;
    emitJsx(el, filePath, out);
  }
  for (const el of findJsxElementsByTag(root, "select")) {
    if (hasJsxAttribute(el, "autoComplete") || hasJsxAttribute(el, "autocomplete")) continue;
    emitJsx(el, filePath, out);
  }
  for (const el of findJsxElementsByTag(root, "textarea")) {
    if (hasJsxAttribute(el, "autoComplete") || hasJsxAttribute(el, "autocomplete")) continue;
    emitJsx(el, filePath, out);
  }
}

function htmlInputNeedsReview(el: HtmlElement): boolean {
  const type = (getHtmlAttribute(el, "type") ?? "text").toLowerCase();
  if (!PURPOSABLE_INPUT_TYPES.has(type)) return false;
  return !hasHtmlAttribute(el, "autocomplete");
}

function jsxInputNeedsReview(el: JsxElement): boolean {
  const type = (getJsxAttributeString(el, "type") ?? "text").toLowerCase();
  if (!PURPOSABLE_INPUT_TYPES.has(type)) return false;
  return !(hasJsxAttribute(el, "autoComplete") || hasJsxAttribute(el, "autocomplete"));
}

function emitHtml(el: HtmlElement, filePath: string, out: ReviewCandidate[]): void {
  for (const id of CRITERION_IDS) {
    out.push({
      criterionId: id,
      location: { filePath, line: el.loc.start.line, column: el.loc.start.column },
      reason: `<${el.tagName.toLowerCase()}> ${REASON}`,
    });
  }
}

function emitJsx(el: JsxElement, filePath: string, out: ReviewCandidate[]): void {
  for (const id of CRITERION_IDS) {
    out.push({
      criterionId: id,
      location: { filePath, line: el.loc.start.line, column: el.loc.start.column },
      reason: `<${el.tagName}> ${REASON}`,
    });
  }
}
