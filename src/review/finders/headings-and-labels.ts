/**
 * Candidate finder: review/headings-and-labels
 * Criteria: wcag22:2.4.6, wcag21:2.4.6, section508:2.4.6, en301549:9.2.4.6
 * Spec: https://www.w3.org/TR/WCAG22/#headings-and-labels
 *
 * Flags headings (h1-h6) and form labels whose visible text is one of a
 * short list of generic phrases ("Overview", "Section", "Click here",
 * "Label", etc.) that do not describe the topic or purpose of the
 * content they head or label. A human reviewer must confirm whether
 * the text is load-bearing in context.
 *
 * Review finder — biased toward false positives. The output is a
 * checklist of places to verify, not a list of failures.
 */

import { defineCandidateFinder } from "../../api/plugin.ts";
import {
  htmlTextContent,
  jsxTextContent,
  walkHtmlElements,
  walkJsxElements,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, HtmlElement, JsxElement, TsxModule } from "../../types/ast.ts";
import type { ReviewCandidate } from "../../types/review.ts";

const CRITERION_IDS = [
  "wcag22:2.4.6",
  "wcag21:2.4.6",
  "section508:2.4.6",
  "en301549:9.2.4.6",
] as const;

const HEADING_TAGS: ReadonlySet<string> = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/**
 * Phrases that rarely describe the topic or purpose of the heading's
 * content. Matched case-insensitively against the trimmed text. The
 * `page 2` / `page N` variant catches pagination-style headings that
 * name the ordinal but not the content.
 */
const GENERIC_HEADING =
  /^(?:overview|section|details|summary|description|introduction|intro|untitled|welcome|home|info|information|content|contents|about|more|other|new|title|click here|more info|read more|learn more|page(?:\s*\d+)?)$/i;

/**
 * Generic label phrases. Includes the heading list plus label-specific
 * words ("label", "field", "text", "value", "input") and common
 * placeholder-style phrases ("enter text", "type here").
 */
const GENERIC_LABEL =
  /^(?:label|field|text|value|input|enter text|type here|overview|section|details|summary|description|introduction|intro|untitled|welcome|home|info|information|content|contents|about|more|other|new|title|click here|more info|read more|learn more)$/i;

export const finder = defineCandidateFinder({
  id: "review/headings-and-labels",
  criterionIds: [...CRITERION_IDS],
  scope: "node",
  appliesTo: { fileExtensions: [".html", ".htm", ".tsx", ".jsx"] },
  docs: {
    description:
      "Finds headings (h1-h6) and labels whose text is a generic phrase (Overview, Section, Click here, Label, Field...) that probably does not describe the topic or purpose of the content.",
    reviewPrompt:
      "Verify that this heading or label describes the topic or purpose of the content it heads. If the text is generic (Overview, Click here, Field...) and a screen-reader user hitting it cold would not know what follows, rewrite it so the meaning is clear without surrounding context.",
    references: [
      "https://www.w3.org/TR/WCAG22/#headings-and-labels",
      "https://www.access-board.gov/ict/",
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

function findHtmlCandidates(
  root: HtmlDocument,
  filePath: string,
  candidates: ReviewCandidate[],
): void {
  for (const el of walkHtmlElements(root)) {
    const tag = el.tagName.toLowerCase();
    if (HEADING_TAGS.has(tag)) {
      const text = htmlTextContent(el);
      if (text && GENERIC_HEADING.test(text)) emitHeading(filePath, el, tag, text, candidates);
      continue;
    }
    if (tag === "label") {
      const text = htmlTextContent(el);
      if (text && GENERIC_LABEL.test(text)) emitLabel(filePath, el, text, candidates);
    }
  }
}

function findJsxCandidates(root: TsxModule, filePath: string, candidates: ReviewCandidate[]): void {
  for (const el of walkJsxElements(root)) {
    const tag = el.tagName;
    if (HEADING_TAGS.has(tag)) {
      const text = jsxTextContent(el);
      if (text && GENERIC_HEADING.test(text)) emitHeading(filePath, el, tag, text, candidates);
      continue;
    }
    if (tag === "label") {
      const text = jsxTextContent(el);
      if (text && GENERIC_LABEL.test(text)) emitLabel(filePath, el, text, candidates);
    }
  }
}

function emitHeading(
  filePath: string,
  el: HtmlElement | JsxElement,
  tag: string,
  text: string,
  candidates: ReviewCandidate[],
): void {
  const reason = `<${tag}> text "${text}" is a generic phrase -- verify the heading describes the topic or purpose of the content it heads`;
  for (const criterionId of CRITERION_IDS) {
    candidates.push({
      criterionId,
      location: { filePath, line: el.loc.start.line, column: el.loc.start.column },
      reason,
    });
  }
}

function emitLabel(
  filePath: string,
  el: HtmlElement | JsxElement,
  text: string,
  candidates: ReviewCandidate[],
): void {
  const reason = `<label> text "${text}" is a generic phrase -- verify the label describes the purpose of the form control`;
  for (const criterionId of CRITERION_IDS) {
    candidates.push({
      criterionId,
      location: { filePath, line: el.loc.start.line, column: el.loc.start.column },
      reason,
    });
  }
}
