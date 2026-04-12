/**
 * Candidate finder: review/no-keyboard-trap
 * Criteria: wcag22:2.1.2, wcag21:2.1.2
 * Spec: https://www.w3.org/TR/WCAG22/#no-keyboard-trap
 *
 * Finds elements that may trap keyboard focus: dialogs, modals, and
 * elements with tabindex manipulation. A human reviewer must verify
 * that keyboard focus can exit without requiring a mouse.
 */

import { defineCandidateFinder } from "../../api/plugin.ts";
import {
  getHtmlAttribute,
  getJsxAttributeString,
  hasHtmlAttribute,
  hasJsxAttribute,
  walkHtmlElements,
  walkJsxElements,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, HtmlElement, JsxElement, TsxModule } from "../../types/ast.ts";
import type { ReviewCandidate } from "../../types/review.ts";

const CRITERION_IDS = ["wcag22:2.1.2", "wcag21:2.1.2"] as const;

function isHtmlTrapCandidate(el: HtmlElement): string | null {
  const tag = el.tagName.toLowerCase();
  if (tag === "dialog") return "dialog element";

  const role = getHtmlAttribute(el, "role");
  if (role === "dialog" || role === "alertdialog") return `element with role="${role}"`;

  if (getHtmlAttribute(el, "aria-modal") === "true") return 'element with aria-modal="true"';

  if (hasHtmlAttribute(el, "tabindex")) {
    const val = getHtmlAttribute(el, "tabindex");
    if (val !== null && val !== "0" && val !== "-1") return `element with tabindex="${val}"`;
  }

  return null;
}

function isJsxTrapCandidate(el: JsxElement): string | null {
  if (el.tagName === "dialog") return "dialog element";

  const role = getJsxAttributeString(el, "role");
  if (role === "dialog" || role === "alertdialog") return `element with role="${role}"`;

  if (getJsxAttributeString(el, "aria-modal") === "true") {
    return 'element with aria-modal="true"';
  }

  if (hasJsxAttribute(el, "tabIndex")) {
    const val = getJsxAttributeString(el, "tabIndex");
    if (val !== null && val !== "0" && val !== "-1") return `element with tabIndex="${val}"`;
  }

  return null;
}

export const finder = defineCandidateFinder({
  id: "review/no-keyboard-trap",
  criterionIds: [...CRITERION_IDS],
  scope: "node",
  appliesTo: { fileExtensions: [".html", ".htm", ".tsx", ".jsx"] },
  docs: {
    description:
      "Finds dialog, modal, and tabindex-manipulated elements that may trap keyboard focus.",
    reviewPrompt:
      "Verify that keyboard focus can be moved away from each component using only the keyboard, without requiring a mouse or other pointing device.",
    references: ["https://www.w3.org/TR/WCAG22/#no-keyboard-trap"],
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

function findHtmlCandidates(
  root: HtmlDocument,
  filePath: string,
  candidates: ReviewCandidate[],
): void {
  for (const el of walkHtmlElements(root)) {
    const desc = isHtmlTrapCandidate(el);
    if (desc) {
      for (const criterionId of CRITERION_IDS) {
        candidates.push({
          criterionId,
          location: {
            filePath,
            line: el.loc.start.line,
            column: el.loc.start.column,
          },
          reason: `${desc} -- verify keyboard focus can exit without mouse`,
        });
      }
    }
  }
}

function findJsxCandidates(root: TsxModule, filePath: string, candidates: ReviewCandidate[]): void {
  for (const el of walkJsxElements(root)) {
    const desc = isJsxTrapCandidate(el);
    if (desc) {
      for (const criterionId of CRITERION_IDS) {
        candidates.push({
          criterionId,
          location: {
            filePath,
            line: el.loc.start.line,
            column: el.loc.start.column,
          },
          reason: `${desc} -- verify keyboard focus can exit without mouse`,
        });
      }
    }
  }
}
