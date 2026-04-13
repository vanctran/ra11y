/**
 * Candidate finder: review/on-input-change
 * Criteria: wcag22:3.2.1, wcag21:3.2.1, wcag22:3.2.2, wcag21:3.2.2
 * Spec: https://www.w3.org/TR/WCAG22/#on-focus
 *       https://www.w3.org/TR/WCAG22/#on-input
 *
 * Finds elements with focus/blur/change event handlers that might
 * trigger unexpected context changes (navigation, form submission,
 * dialog opening, etc.). A human reviewer must verify that no
 * unexpected context change occurs.
 */

import { defineCandidateFinder } from "../../api/plugin.ts";
import {
  hasHtmlAttribute,
  hasJsxAttribute,
  walkHtmlElements,
  walkJsxElements,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, HtmlElement, JsxElement, TsxModule } from "../../types/ast.ts";
import type { ReviewCandidate } from "../../types/review.ts";

const ALL_CRITERION_IDS = ["wcag22:3.2.1", "wcag21:3.2.1", "wcag22:3.2.2", "wcag21:3.2.2"] as const;

const ON_FOCUS_CRITERIA = ["wcag22:3.2.1", "wcag21:3.2.1"] as const;
const ON_INPUT_CRITERIA = ["wcag22:3.2.2", "wcag21:3.2.2"] as const;

/** HTML event attribute names (lowercase). */
const HTML_HANDLER_ATTRS = ["onfocus", "onblur", "onchange"] as const;

/** JSX event prop names (camelCase). */
const JSX_HANDLER_ATTRS = ["onFocus", "onBlur", "onChange"] as const;

const HANDLER_DESCRIPTIONS: Record<string, string> = {
  onfocus: "onfocus handler",
  onblur: "onblur handler",
  onchange: "onchange handler",
  onFocus: "onFocus handler",
  onBlur: "onBlur handler",
  onChange: "onChange handler",
};

function criteriaForHandler(handler: string): readonly string[] {
  const lower = handler.toLowerCase();
  if (lower === "onchange") return ON_INPUT_CRITERIA;
  return ON_FOCUS_CRITERIA;
}

function findHtmlHandlers(el: HtmlElement): string[] {
  const found: string[] = [];
  for (const attr of HTML_HANDLER_ATTRS) {
    if (hasHtmlAttribute(el, attr)) found.push(attr);
  }
  return found;
}

function findJsxHandlers(el: JsxElement): string[] {
  const found: string[] = [];
  for (const attr of JSX_HANDLER_ATTRS) {
    if (hasJsxAttribute(el, attr)) found.push(attr);
  }
  return found;
}

export const finder = defineCandidateFinder({
  id: "review/on-input-change",
  criterionIds: [...ALL_CRITERION_IDS],
  scope: "node",
  appliesTo: { fileExtensions: [".html", ".htm", ".tsx", ".jsx"] },
  docs: {
    description:
      "Finds elements with focus, blur, or change event handlers that may cause unexpected context changes.",
    reviewPrompt:
      "Verify that receiving focus (onfocus), losing focus (onblur), or changing a value (onchange) does not cause an unexpected context change such as navigation, form submission, or opening a new window.",
    references: [
      "https://www.w3.org/TR/WCAG22/#on-focus",
      "https://www.w3.org/TR/WCAG22/#on-input",
    ],
  },
  find(ctx) {
    const candidates: ReviewCandidate[] = [];
    if (ctx.language === "html")
      findHtmlCandidates(ctx.ast as HtmlDocument, ctx.filePath, candidates);
    else if (ctx.language === "tsx" || ctx.language === "jsx")
      findJsxCandidates(ctx.ast as TsxModule, ctx.filePath, candidates);
    return candidates;
  },
});

function reasonFor(handler: string, tag: string): string {
  return `${HANDLER_DESCRIPTIONS[handler]} on <${tag}> -- verify it does not cause an unexpected context change`;
}

function findHtmlCandidates(
  root: HtmlDocument,
  filePath: string,
  candidates: ReviewCandidate[],
): void {
  for (const el of walkHtmlElements(root)) {
    const handlers = findHtmlHandlers(el);
    for (const handler of handlers) {
      for (const criterionId of criteriaForHandler(handler)) {
        candidates.push({
          criterionId,
          location: {
            filePath,
            line: el.loc.start.line,
            column: el.loc.start.column,
          },
          reason: reasonFor(handler, el.tagName),
        });
      }
    }
  }
}

function findJsxCandidates(root: TsxModule, filePath: string, candidates: ReviewCandidate[]): void {
  for (const el of walkJsxElements(root)) {
    const handlers = findJsxHandlers(el);
    for (const handler of handlers) {
      for (const criterionId of criteriaForHandler(handler)) {
        candidates.push({
          criterionId,
          location: {
            filePath,
            line: el.loc.start.line,
            column: el.loc.start.column,
          },
          reason: reasonFor(handler, el.tagName),
        });
      }
    }
  }
}
