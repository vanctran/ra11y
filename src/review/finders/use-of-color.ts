/**
 * Candidate finder: review/use-of-color
 * Criteria: wcag22:1.4.1, wcag21:1.4.1, section508:1194.22.c, en301549:9.1.4.1
 * Spec: https://www.w3.org/TR/WCAG22/#use-of-color
 *
 * Flags JSX/HTML elements whose className signals status purely through
 * color (red/green/amber/success/danger/warning) and that have no
 * sibling icon, no text child with a status word, and no aria-label.
 * A human reviewer must confirm a non-color signal is present.
 *
 * Review finder — biased toward false positives. The output is a
 * checklist of places to verify, not a list of failures.
 */

import { defineCandidateFinder } from "../../api/plugin.ts";
import {
  getJsxAttributeString,
  hasHtmlAttribute,
  hasJsxAttribute,
  jsxTextContent,
  walkHtmlElements,
  walkJsxElements,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, HtmlElement, JsxElement, TsxModule } from "../../types/ast.ts";
import type { ReviewCandidate } from "../../types/review.ts";

const CRITERION_IDS = [
  "wcag22:1.4.1",
  "wcag21:1.4.1",
  "section508:1194.22.c",
  "en301549:9.1.4.1",
] as const;

/**
 * Tailwind-ish color utility names commonly used to convey status.
 * Matches `{prefix}-{hue}-{shade}` and a few semantic keywords.
 * Case-insensitive; tested against the className string.
 */
const STATUS_COLOR_CLASS =
  /\b(?:bg|text|border|ring|fill|stroke)-(?:red|rose|green|emerald|lime|yellow|amber|orange|success|danger|warning|error|destructive)(?:-\d{2,3})?\b/i;

/**
 * Status words that, if present in visible text or aria-label, signal a
 * non-color-only treatment. If any of these appear in the element's
 * text content or label, the color likely isn't the sole indicator.
 */
const STATUS_WORD_TEXT =
  /\b(error|errors|warning|warnings|success|successful|failed|failure|passed|invalid|valid|required|danger|alert|critical|complete|incomplete|pending|approved|rejected)\b/i;

/** JSX components conventionally rendering an icon or glyph. */
const ICON_COMPONENT_TAG = /^(?:[A-Z]\w*)?(?:Icon|Glyph|Symbol|Svg|Image)$/;

export const finder = defineCandidateFinder({
  id: "review/use-of-color",
  criterionIds: [...CRITERION_IDS],
  scope: "node",
  appliesTo: { fileExtensions: [".html", ".htm", ".tsx", ".jsx"] },
  docs: {
    description:
      "Finds elements whose className uses a status color (red/green/warning/danger) without an adjacent icon or status word, which may convey meaning by color alone.",
    reviewPrompt:
      "Verify that the color on this element is not the only cue. A sighted user without color perception must still be able to tell the state — look for an icon, a text label, or aria-label that duplicates the signal.",
    references: ["https://www.w3.org/TR/WCAG22/#use-of-color", "https://www.access-board.gov/ict/"],
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
    const className = getHtmlClass(el);
    const matched = className ? STATUS_COLOR_CLASS.exec(className)?.[0] : undefined;
    if (!matched) continue;
    if (htmlElementHasNonColorSignal(el)) continue;
    emit(filePath, el.loc.start, matched, candidates);
  }
}

function findJsxCandidates(root: TsxModule, filePath: string, candidates: ReviewCandidate[]): void {
  for (const el of walkJsxElements(root)) {
    const className = getJsxAttributeString(el, "className");
    const matched = className ? STATUS_COLOR_CLASS.exec(className)?.[0] : undefined;
    if (!matched) continue;
    if (jsxElementHasNonColorSignal(el)) continue;
    emit(filePath, el.loc.start, matched, candidates);
  }
}

function getHtmlClass(el: HtmlElement): string | null {
  for (const attr of el.attributes) {
    if (attr.name.toLowerCase() === "class") return attr.value ?? "";
  }
  return null;
}

function htmlElementHasNonColorSignal(el: HtmlElement): boolean {
  if (hasHtmlAttribute(el, "aria-label")) return true;
  if (hasHtmlAttribute(el, "title")) return true;
  const text = collectHtmlText(el);
  if (text && STATUS_WORD_TEXT.test(text)) return true;
  for (const child of el.children) {
    if (child.kind === "HtmlElement") {
      const tag = child.tagName.toLowerCase();
      if (tag === "svg" || tag === "img" || tag === "i") return true;
    }
  }
  return false;
}

function jsxElementHasNonColorSignal(el: JsxElement): boolean {
  if (hasJsxAttribute(el, "aria-label")) return true;
  if (hasJsxAttribute(el, "title")) return true;
  const text = jsxTextContent(el);
  if (text && STATUS_WORD_TEXT.test(text)) return true;
  for (const child of el.children) {
    if (child.kind === "JsxElement" && ICON_COMPONENT_TAG.test(child.tagName)) return true;
  }
  return false;
}

function collectHtmlText(el: HtmlElement): string {
  let out = "";
  for (const child of el.children) {
    if (child.kind === "HtmlText") out += child.value;
  }
  return out;
}

function emit(
  filePath: string,
  loc: { line: number; column: number },
  matched: string,
  candidates: ReviewCandidate[],
): void {
  const reason = `className uses status color "${matched}" with no visible text, icon, or aria-label -- verify color is not the sole signal`;
  for (const criterionId of CRITERION_IDS) {
    candidates.push({
      criterionId,
      location: { filePath, line: loc.line, column: loc.column },
      reason,
    });
  }
}
