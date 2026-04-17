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
 * Clear sensory-only phrases — color, shape, or side-based identification
 * that is effectively always a 1.3.3 concern in UI copy.
 */
const SENSORY_PATTERN =
  /\b(right side|left side|click the red|the green\b|the blue\b|the red\b|the round\b|the square\b|shaped like)\b/i;

/**
 * Directional cues ("above"/"below") are sensory *only* when used as a
 * positional-only identifier. Two narrow patterns catch the real 1.3.3
 * case without flagging prose where the word merely modifies a noun
 * ("the prompt below", "the topic below"):
 *
 *   A. Instructional verb IMMEDIATELY followed by "above"/"below" with
 *      no intervening object ("click below", "see above", "tap below
 *      to continue"). The negative lookbehind excludes noun-phrase
 *      uses of polysemous verbs — "the view above" / "a view below"
 *      treat "view" as a noun ("the vista"), not an instruction.
 *   B. UI-element noun followed by "above"/"below" ("button above",
 *      "section below") — the directional word is the disambiguator.
 */
const DIRECTIONAL_VERB_PATTERN =
  /(?<!\b(?:the|a|an|this|that|my|your|his|her|its|our|their|any|some|no)\s)\b(?:click|press|tap|see|view|scroll)\s+(?:the\s+)?(above|below)\b/i;

const DIRECTIONAL_NOUN_PATTERN =
  /\b(?:button|link|icon|image|card|section|panel|menu|dialog|form|field|input|option|tab|box|arrow)s?\s+(above|below)\b/i;

function matchSensory(text: string): string | undefined {
  return (
    SENSORY_PATTERN.exec(text)?.[0] ??
    DIRECTIONAL_VERB_PATTERN.exec(text)?.[0] ??
    DIRECTIONAL_NOUN_PATTERN.exec(text)?.[0]
  );
}

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
    const matched = text ? matchSensory(text) : undefined;
    if (!matched) continue;
    const hasDirectText = el.children.some(
      (c) => c.kind === "HtmlText" && matchSensory(c.value) !== undefined,
    );
    if (!hasDirectText) continue;
    emitSensoryCandidates(filePath, el.loc.start, text as string, matched, candidates);
  }
}

function findJsxCandidates(root: TsxModule, filePath: string, candidates: ReviewCandidate[]): void {
  for (const el of walkJsxElements(root)) {
    const text = jsxTextContent(el);
    const matched = text ? matchSensory(text) : undefined;
    if (!matched) continue;
    const hasDirectText = el.children.some(
      (c) => c.kind === "JsxText" && matchSensory(c.value) !== undefined,
    );
    if (!hasDirectText) continue;
    emitSensoryCandidates(filePath, el.loc.start, text as string, matched, candidates);
  }
}

function emitSensoryCandidates(
  filePath: string,
  loc: { line: number; column: number },
  text: string,
  matchedPhrase: string,
  candidates: ReviewCandidate[],
): void {
  const reason = `text references sensory characteristic "${matchedPhrase}" -- verify a non-sensory alternative exists`;
  for (const criterionId of CRITERION_IDS) {
    // Confidence "low": regex on visible text. "Click below" and
    // "the button above" match even when the surrounding UI does
    // carry a non-sensory alternative (icon, heading, landmark).
    // The finder is a prompt to verify, not evidence of a failure.
    candidates.push({
      criterionId,
      location: { filePath, line: loc.line, column: loc.column },
      reason,
      snippet: text.slice(0, 120),
      confidence: "low",
    });
  }
}
