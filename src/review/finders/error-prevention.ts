/**
 * Candidate finder: review/error-prevention
 * Criteria: wcag22:3.3.4, wcag21:3.3.4, section508:3.3.4, en301549:9.3.3.4
 * Spec: https://www.w3.org/TR/WCAG22/#error-prevention-legal-financial-data
 *
 * Flags native `<form>` elements that look like high-impact submissions
 * (checkout, payment, transfer, delete, etc.) when the same file shows
 * no static confirmation or review signal.
 *
 * Signal is intentionally narrow:
 *   - Only native `<form>` elements, not wrapper components.
 *   - Form intent must be visible in `action|class|className|id|name`.
 *   - The file is suppressed if it already contains any obvious review
 *     affordance: a confirm/consent checkbox, a confirm/review submit
 *     button, an alert dialog or `Confirm*`/`AreYouSure*`/`Modal*`
 *     element, or an `onSubmit` handler that calls `confirm(...)` or
 *     toggles `showConfirm`/`setShowConfirm`.
 *
 * Review finder — biased toward false positives. Output is a checklist
 * of places to verify, not a list of failures.
 */

import { defineCandidateFinder } from "../../api/plugin.ts";
import {
  getHtmlAttribute,
  getJsxAttribute,
  htmlTextContent,
  jsxTextContent,
  walkHtmlElements,
  walkJsxElements,
} from "../../engine/ast-helpers.ts";
import type {
  HtmlDocument,
  HtmlElement,
  HtmlNode,
  JsxAttribute,
  JsxElement,
  JsxNode,
  TsxModule,
} from "../../types/ast.ts";
import type { ReviewCandidate } from "../../types/review.ts";

const CRITERION_IDS = [
  "wcag22:3.3.4",
  "wcag21:3.3.4",
  "section508:3.3.4",
  "en301549:9.3.3.4",
] as const;

const HTML_FORM_SIGNAL_ATTRS = ["action", "class", "id", "name"] as const;
const JSX_FORM_SIGNAL_ATTRS = ["action", "class", "className", "id", "name"] as const;
const CONSENT_SIGNAL_ATTRS = ["aria-label", "id", "name"] as const;
const DIALOG_COMPONENT_PREFIXES = ["areyousure", "confirm", "modal"] as const;

const GENERIC_RISK_KEYWORDS =
  /\b(?:billing|cancel|checkout|delete|payment|purchase|subscribe|transfer)\b/i;

const CONSENT_KEYWORDS = /\b(?:accept|agree|confirm|consent|terms)\b/i;
const ORDER_CONTEXT_KEYWORDS =
  /\b(?:checkout|confirm|details|form|payment|place|purchase|review|summary)\b/i;
const REVIEW_BUTTON_KEYWORDS = /\b(?:confirm|review|verify)\b/i;
const CONFIRM_HANDLER_PATTERN =
  /\bwindow\s*\.\s*confirm\s*\(|\bconfirm\s*\(|\bshowConfirm\b|\bsetShowConfirm\b/;

interface TriggerMatch {
  readonly attribute: string;
  readonly value: string;
}

export const finder = defineCandidateFinder({
  id: "review/error-prevention",
  criterionIds: [...CRITERION_IDS],
  scope: "node",
  appliesTo: { fileExtensions: [".html", ".htm", ".tsx", ".jsx"] },
  docs: {
    description:
      "Finds high-impact native forms whose file shows no static review, confirmation, or consent signal before submission.",
    reviewPrompt:
      "Verify that this submission gives the user a chance to review, confirm, or reverse the action before it becomes final. For financial, legal, destructive, or important data changes, a visible review step, confirmation dialog, or equivalent safeguard should exist and remain usable with keyboard and assistive technology.",
    references: [
      "https://www.w3.org/TR/WCAG22/#error-prevention-legal-financial-data",
      "https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html",
    ],
  },
  find(ctx) {
    const candidates: ReviewCandidate[] = [];
    if (ctx.language === "html") {
      findHtmlCandidates(ctx.ast as HtmlDocument, ctx.filePath, candidates);
    } else if (ctx.language === "tsx" || ctx.language === "jsx") {
      findJsxCandidates(ctx.ast as TsxModule, ctx.filePath, candidates);
    }
    return candidates;
  },
});

function findHtmlCandidates(
  root: HtmlDocument,
  filePath: string,
  candidates: ReviewCandidate[],
): void {
  if (hasHtmlFileLevelConfirmationSignal(root)) return;
  scanHtmlChildren(root.children, filePath, candidates);
}

function findJsxCandidates(root: TsxModule, filePath: string, candidates: ReviewCandidate[]): void {
  if (hasJsxFileLevelConfirmationSignal(root)) return;
  scanJsxChildren(root.jsxElements, filePath, candidates);
}

function hasHtmlFileLevelConfirmationSignal(root: HtmlDocument): boolean {
  return (
    hasHtmlConsentCheckbox(root) ||
    hasHtmlReviewSubmitButton(root) ||
    hasHtmlSubmitConfirmationHandler(root)
  );
}

function hasJsxFileLevelConfirmationSignal(root: TsxModule): boolean {
  return (
    hasJsxConsentCheckbox(root) ||
    hasJsxReviewSubmitButton(root) ||
    hasJsxSubmitConfirmationHandler(root)
  );
}

function scanHtmlChildren(
  children: readonly HtmlNode[],
  filePath: string,
  candidates: ReviewCandidate[],
): void {
  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    if (child?.kind !== "HtmlElement") continue;
    emitHtmlCandidate(child, children, index, filePath, candidates);
    scanHtmlChildren(child.children, filePath, candidates);
  }
}

function scanJsxChildren(
  children: readonly JsxNode[] | readonly JsxElement[],
  filePath: string,
  candidates: ReviewCandidate[],
): void {
  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    if (child?.kind !== "JsxElement") continue;
    emitJsxCandidate(child, children, index, filePath, candidates);
    scanJsxChildren(child.children, filePath, candidates);
  }
}

function emitHtmlCandidate(
  element: HtmlElement,
  siblings: readonly HtmlNode[],
  index: number,
  filePath: string,
  candidates: ReviewCandidate[],
): void {
  const trigger = matchHtmlRiskyForm(element);
  if (!trigger || hasHtmlSiblingDialogSignal(siblings, index)) return;
  pushForAllCriteria(
    candidates,
    filePath,
    element.loc.start.line,
    element.loc.start.column,
    renderReason(trigger),
  );
}

function emitJsxCandidate(
  element: JsxElement,
  siblings: readonly JsxNode[] | readonly JsxElement[],
  index: number,
  filePath: string,
  candidates: ReviewCandidate[],
): void {
  const trigger = matchJsxRiskyForm(element);
  if (!trigger || hasJsxSiblingDialogSignal(siblings, index)) return;
  pushForAllCriteria(
    candidates,
    filePath,
    element.loc.start.line,
    element.loc.start.column,
    renderReason(trigger),
  );
}

function matchHtmlRiskyForm(element: HtmlElement): TriggerMatch | null {
  if (element.tagName.toLowerCase() !== "form") return null;
  return matchHtmlRiskAttributes(element, HTML_FORM_SIGNAL_ATTRS);
}

function matchJsxRiskyForm(element: JsxElement): TriggerMatch | null {
  if (element.tagName !== "form") return null;
  return matchJsxRiskAttributes(element, JSX_FORM_SIGNAL_ATTRS);
}

function hasHtmlConsentCheckbox(root: HtmlDocument): boolean {
  for (const element of walkHtmlElements(root)) {
    if (!isHtmlCheckbox(element)) continue;
    if (matchHtmlAttributes(element, CONSENT_SIGNAL_ATTRS, CONSENT_KEYWORDS)) return true;
  }
  return false;
}

function hasJsxConsentCheckbox(root: TsxModule): boolean {
  for (const element of walkJsxElements(root)) {
    if (!isJsxCheckbox(element)) continue;
    if (matchJsxAttributes(element, CONSENT_SIGNAL_ATTRS, CONSENT_KEYWORDS)) return true;
  }
  return false;
}

function hasHtmlReviewSubmitButton(root: HtmlDocument): boolean {
  for (const element of walkHtmlElements(root)) {
    if (!isHtmlSubmitButton(element)) continue;
    if (REVIEW_BUTTON_KEYWORDS.test(normalizeWords(htmlTextContent(element)))) return true;
  }
  return false;
}

function hasJsxReviewSubmitButton(root: TsxModule): boolean {
  for (const element of walkJsxElements(root)) {
    if (!isJsxSubmitButton(element)) continue;
    if (REVIEW_BUTTON_KEYWORDS.test(normalizeWords(jsxTextContent(element)))) return true;
  }
  return false;
}

function hasHtmlSubmitConfirmationHandler(root: HtmlDocument): boolean {
  for (const element of walkHtmlElements(root)) {
    if (element.tagName.toLowerCase() !== "form") continue;
    const onSubmit = getHtmlAttribute(element, "onsubmit");
    if (onSubmit && CONFIRM_HANDLER_PATTERN.test(onSubmit)) return true;
  }
  return false;
}

function hasJsxSubmitConfirmationHandler(root: TsxModule): boolean {
  for (const element of walkJsxElements(root)) {
    if (element.tagName !== "form") continue;
    const onSubmit = getJsxAttributeText(element, "onSubmit");
    if (onSubmit && CONFIRM_HANDLER_PATTERN.test(onSubmit)) return true;
  }
  return false;
}

function matchHtmlAttributes(
  element: HtmlElement,
  attrs: readonly string[],
  pattern: RegExp,
): TriggerMatch | null {
  for (const attr of attrs) {
    const value = getHtmlAttribute(element, attr);
    if (value === null) continue;
    if (!matchesNormalizedPattern(value, pattern)) continue;
    return { attribute: attr, value };
  }
  return null;
}

function matchHtmlRiskAttributes(
  element: HtmlElement,
  attrs: readonly string[],
): TriggerMatch | null {
  for (const attr of attrs) {
    const value = getHtmlAttribute(element, attr);
    if (value === null) continue;
    if (!matchesRiskAttribute(attr, value)) continue;
    return { attribute: attr, value };
  }
  return null;
}

function matchJsxAttributes(
  element: JsxElement,
  attrs: readonly string[],
  pattern: RegExp,
): TriggerMatch | null {
  for (const attr of attrs) {
    const value = getJsxAttributeText(element, attr);
    if (value === null) continue;
    if (!matchesNormalizedPattern(value, pattern)) continue;
    return { attribute: attr, value };
  }
  return null;
}

function matchJsxRiskAttributes(
  element: JsxElement,
  attrs: readonly string[],
): TriggerMatch | null {
  for (const attr of attrs) {
    const value = getJsxAttributeText(element, attr);
    if (value === null) continue;
    if (!matchesRiskAttribute(attr, value)) continue;
    return { attribute: attr, value };
  }
  return null;
}

function isHtmlCheckbox(element: HtmlElement): boolean {
  return (
    element.tagName.toLowerCase() === "input" &&
    normalizeWords(getHtmlAttribute(element, "type")) === "checkbox"
  );
}

function isJsxCheckbox(element: JsxElement): boolean {
  return (
    element.tagName === "input" &&
    normalizeWords(getJsxAttributeText(element, "type")) === "checkbox"
  );
}

function isHtmlSubmitButton(element: HtmlElement): boolean {
  return (
    element.tagName.toLowerCase() === "button" &&
    normalizeWords(getHtmlAttribute(element, "type")) === "submit"
  );
}

function isJsxSubmitButton(element: JsxElement): boolean {
  return (
    element.tagName === "button" &&
    normalizeWords(getJsxAttributeText(element, "type")) === "submit"
  );
}

function getJsxAttributeText(element: JsxElement, name: string): string | null {
  const attr = getJsxAttribute(element, name);
  return jsxAttributeText(attr);
}

function jsxAttributeText(attr: JsxAttribute | null): string | null {
  if (!attr?.value) return null;
  return attr.value.kind === "StringLiteral" ? attr.value.value : attr.value.raw;
}

function hasHtmlSiblingDialogSignal(siblings: readonly HtmlNode[], index: number): boolean {
  for (let cursor = 0; cursor < siblings.length; cursor++) {
    if (cursor === index) continue;
    const sibling = siblings[cursor];
    if (!sibling) continue;
    if (isHtmlDialogElement(sibling)) return true;
  }
  return false;
}

function hasJsxSiblingDialogSignal(
  siblings: readonly JsxNode[] | readonly JsxElement[],
  index: number,
): boolean {
  for (let cursor = 0; cursor < siblings.length; cursor++) {
    if (cursor === index) continue;
    const sibling = siblings[cursor];
    if (!sibling) continue;
    if (isJsxDialogElement(sibling)) return true;
  }
  return false;
}

function isHtmlDialogElement(node: HtmlNode): boolean {
  return (
    node.kind === "HtmlElement" &&
    (normalizeWords(getHtmlAttribute(node, "role")) === "alertdialog" ||
      isDialogComponentName(node.tagName))
  );
}

function isJsxDialogElement(node: JsxNode | JsxElement): boolean {
  return (
    node.kind === "JsxElement" &&
    (normalizeWords(getJsxAttributeText(node, "role")) === "alertdialog" ||
      isDialogComponentName(node.tagName))
  );
}

function isDialogComponentName(tagName: string): boolean {
  const compact = tagName.replace(/[^a-z0-9]+/gi, "").toLowerCase();
  return DIALOG_COMPONENT_PREFIXES.some((prefix) => compact.startsWith(prefix));
}

function matchesNormalizedPattern(value: string | null, pattern: RegExp): boolean {
  if (!value) return false;
  return pattern.test(normalizeWords(value));
}

function matchesRiskAttribute(attribute: string, value: string | null): boolean {
  if (!value) return false;
  const normalized = normalizeWords(value);
  if (GENERIC_RISK_KEYWORDS.test(normalized)) return true;
  if (!/\border\b/.test(normalized)) return false;
  if (attribute === "class" || attribute === "className") {
    return ORDER_CONTEXT_KEYWORDS.test(normalized);
  }
  return true;
}

function normalizeWords(value: string | null): string {
  if (!value) return "";
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function renderReason(trigger: TriggerMatch): string {
  return `<form> looks like a high-impact submission via ${trigger.attribute}="${trigger.value}" but no static review, confirmation, or consent signal was found in this file`;
}

function pushForAllCriteria(
  candidates: ReviewCandidate[],
  filePath: string,
  line: number,
  column: number,
  reason: string,
): void {
  for (const criterionId of CRITERION_IDS) {
    // Confidence "low": the "high-impact submission" signal rides on
    // keyword matches in action/class/id/name plus a file-scoped
    // absence-of-confirm heuristic. Real checkout forms match; so do
    // plain forms whose names happen to include "confirm" or "cancel."
    // Biased toward false positives by design (see docstring).
    candidates.push({
      criterionId,
      location: { filePath, line, column },
      reason,
      confidence: "low",
    });
  }
}
