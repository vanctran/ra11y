/**
 * Candidate finder: review/section-headings
 * Criteria: wcag22:2.4.10, wcag21:2.4.10
 * Spec: https://www.w3.org/TR/WCAG22/#section-headings
 *
 * Flags `<section>` regions that expose neither a programmatic label
 * (`aria-label` / `aria-labelledby`) nor any descendant heading
 * element (`h1`-`h6`). A human reviewer should confirm the section is
 * intentionally unnamed or add a heading that organizes its content.
 *
 * Review finder — biased toward false positives.
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

const CRITERION_IDS = ["wcag22:2.4.10", "wcag21:2.4.10"] as const;

const HEADING_TAGS: ReadonlySet<string> = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

export const finder = defineCandidateFinder({
  id: "review/section-headings",
  criterionIds: [...CRITERION_IDS],
  scope: "node",
  appliesTo: { fileExtensions: [".html", ".htm", ".tsx", ".jsx"] },
  docs: {
    description:
      "Finds section elements that have neither a heading descendant nor an aria-label/aria-labelledby name, which may mean the content is not organized by a section heading.",
    reviewPrompt:
      "Verify that this section is organized by a visible heading or another equivalent label. If the section is intentionally a named region, confirm aria-label or aria-labelledby provides the right name; otherwise add an h1-h6 heading that introduces the section content.",
    references: ["https://www.w3.org/TR/WCAG22/#section-headings"],
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
  for (const el of walkHtmlElements(root)) {
    if (el.tagName.toLowerCase() !== "section") continue;
    if (hasHtmlAttribute(el, "aria-label") || hasHtmlAttribute(el, "aria-labelledby")) continue;
    if (hasHtmlHeadingDescendant(el)) continue;
    pushForAllCriteria(candidates, filePath, el.loc.start.line, el.loc.start.column);
  }
}

function findJsxCandidates(root: TsxModule, filePath: string, candidates: ReviewCandidate[]): void {
  for (const el of walkJsxElements(root)) {
    if (el.tagName !== "section") continue;
    if (hasJsxAttribute(el, "aria-label") || hasJsxAttribute(el, "aria-labelledby")) continue;
    if (hasJsxHeadingDescendant(el)) continue;
    pushForAllCriteria(candidates, filePath, el.loc.start.line, el.loc.start.column);
  }
}

function hasHtmlHeadingDescendant(section: HtmlElement): boolean {
  for (const child of walkHtmlElements(section)) {
    if (isHeadingTag(child.tagName)) return true;
  }
  return false;
}

function hasJsxHeadingDescendant(section: JsxElement): boolean {
  for (const child of section.children) {
    if (child.kind !== "JsxElement") continue;
    if (isHeadingTag(child.tagName)) return true;
    if (hasJsxHeadingDescendant(child)) return true;
  }
  return false;
}

function isHeadingTag(tagName: string): boolean {
  return HEADING_TAGS.has(tagName.toLowerCase());
}

function pushForAllCriteria(
  candidates: ReviewCandidate[],
  filePath: string,
  line: number,
  column: number,
): void {
  const reason =
    "<section> has no descendant heading and no aria-label/aria-labelledby -- verify the section is organized with a heading or equivalent label";
  for (const criterionId of CRITERION_IDS) {
    candidates.push({ criterionId, location: { filePath, line, column }, reason });
  }
}
