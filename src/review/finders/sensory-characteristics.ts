/**
 * Candidate finder: review/sensory-characteristics
 * Criteria: wcag22:1.3.3, wcag21:1.3.3
 * Spec: https://www.w3.org/TR/WCAG22/#sensory-characteristics
 *
 * Finds text content that references sensory characteristics (shape,
 * color, size, visual location, orientation, or sound) as the only
 * way to identify or understand content. A human reviewer must verify
 * that a non-sensory alternative exists.
 */

import { defineCandidateFinder } from "../../api/plugin.ts";
import {
  htmlTextContent,
  jsxTextContent,
  walkHtmlElements,
  walkJsxElements,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, TsxModule } from "../../types/ast.ts";
import type { ReviewCandidate } from "../../types/review.ts";

const CRITERION_IDS = ["wcag22:1.3.3", "wcag21:1.3.3"] as const;

/**
 * Pattern matching sensory-only instruction words. Case-insensitive.
 * Matches phrases like "above", "below", "right side", "left side",
 * "click the red", "the green", "the round", "shaped like", etc.
 */
const SENSORY_PATTERN =
  /\b(above|below|right side|left side|click the red|the green\b|the blue\b|the red\b|the round\b|the square\b|shaped like)\b/i;

export const finder = defineCandidateFinder({
  id: "review/sensory-characteristics",
  criterionIds: [...CRITERION_IDS],
  scope: "node",
  appliesTo: { fileExtensions: [".html", ".htm", ".tsx", ".jsx"] },
  docs: {
    description:
      "Finds text content referencing sensory characteristics (shape, color, position) that may be the sole means of conveying information.",
    reviewPrompt:
      "Verify that instructions do not rely solely on sensory characteristics like shape, color, size, visual location, orientation, or sound.",
    references: ["https://www.w3.org/TR/WCAG22/#sensory-characteristics"],
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
    const text = htmlTextContent(el);
    if (!(text && SENSORY_PATTERN.test(text))) continue;
    const hasDirectText = el.children.some(
      (c) => c.kind === "HtmlText" && SENSORY_PATTERN.test(c.value),
    );
    if (!hasDirectText) continue;
    emitSensoryCandidates(filePath, el.loc.start, text, candidates);
  }
}

function findJsxCandidates(root: TsxModule, filePath: string, candidates: ReviewCandidate[]): void {
  for (const el of walkJsxElements(root)) {
    const text = jsxTextContent(el);
    if (!(text && SENSORY_PATTERN.test(text))) continue;
    const hasDirectText = el.children.some(
      (c) => c.kind === "JsxText" && SENSORY_PATTERN.test(c.value),
    );
    if (!hasDirectText) continue;
    emitSensoryCandidates(filePath, el.loc.start, text, candidates);
  }
}

function emitSensoryCandidates(
  filePath: string,
  loc: { line: number; column: number },
  text: string,
  candidates: ReviewCandidate[],
): void {
  for (const criterionId of CRITERION_IDS) {
    candidates.push({
      criterionId,
      location: { filePath, line: loc.line, column: loc.column },
      reason: "text references sensory characteristic -- verify a non-sensory alternative exists",
      snippet: text.slice(0, 120),
    });
  }
}
