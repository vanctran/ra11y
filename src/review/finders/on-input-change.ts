/**
 * Candidate finder: review/on-input-change
 * Criteria: wcag22:3.2.1, wcag21:3.2.1, wcag22:3.2.2, wcag21:3.2.2
 * Spec: https://www.w3.org/TR/WCAG22/#on-focus
 *       https://www.w3.org/TR/WCAG22/#on-input
 *
 * Finds focus/blur/change event handlers that might cause an
 * unexpected context change. Static-analysis signal: inspect the
 * handler's inline body for calls that actually navigate, submit, or
 * reload. If we can see the body and it contains such a call, emit
 * a candidate with specific detail. Otherwise stay silent — flagging
 * every onChange because "it could do anything" is noise, not review.
 */

import { defineCandidateFinder } from "../../api/plugin.ts";
import {
  getHtmlAttribute,
  getJsxAttribute,
  hasHtmlAttribute,
  walkHtmlElements,
  walkJsxElements,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, TsxModule } from "../../types/ast.ts";
import type { ReviewCandidate } from "../../types/review.ts";

const ON_FOCUS_CRITERIA = ["wcag22:3.2.1", "wcag21:3.2.1"] as const;
const ON_INPUT_CRITERIA = ["wcag22:3.2.2", "wcag21:3.2.2"] as const;
const ALL_CRITERION_IDS = [...ON_FOCUS_CRITERIA, ...ON_INPUT_CRITERIA] as const;

const HTML_HANDLER_ATTRS = ["onfocus", "onblur", "onchange"] as const;
const JSX_HANDLER_ATTRS = ["onFocus", "onBlur", "onChange"] as const;

/**
 * Source-text patterns that strongly indicate a context change if
 * invoked during focus/blur/input. Each pattern has a short label used
 * in the candidate reason. Case-sensitive — "Location" wouldn't match
 * common JavaScript APIs, and "SubmitButton" is a component, not a
 * submit() call.
 */
const NAVIGATION_PATTERNS: readonly { readonly pattern: RegExp; readonly label: string }[] = [
  { pattern: /\brouter\s*\.\s*(?:push|replace|back|forward)\s*\(/, label: "router navigation" },
  {
    pattern: /\b(?:history)\s*\.\s*(?:push|replace|back|forward|go)\s*\(/,
    label: "history navigation",
  },
  { pattern: /\bnavigate\s*\(/, label: "navigate() call" },
  { pattern: /\bredirect(?:To)?\s*\(/, label: "redirect() call" },
  {
    pattern: /\b(?:window\s*\.\s*)?location\s*\.\s*(?:href|assign|replace|reload)\b/,
    label: "window.location change",
  },
  { pattern: /\bwindow\s*\.\s*open\s*\(/, label: "window.open() call" },
  { pattern: /\.\s*submit\s*\(\s*\)/, label: ".submit() call" },
] as const;

function criteriaForHandler(handler: string): readonly string[] {
  return handler.toLowerCase() === "onchange" ? ON_INPUT_CRITERIA : ON_FOCUS_CRITERIA;
}

export const finder = defineCandidateFinder({
  id: "review/on-input-change",
  criterionIds: [...ALL_CRITERION_IDS],
  scope: "node",
  appliesTo: { fileExtensions: [".html", ".htm", ".tsx", ".jsx"] },
  docs: {
    description:
      "Finds focus/blur/change handlers whose inline body invokes a navigation, submission, or reload API — i.e., a statically detectable context change.",
    reviewPrompt:
      "Verify that triggering this handler (on focus, blur, or value change) is expected behavior and announced to the user. If it navigates or submits unexpectedly, refactor so the context change is triggered only by an explicit user action.",
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

/**
 * Detects a context-change pattern in the handler source text.
 * Returns the matched label, or undefined if none found.
 */
function detectContextChange(source: string): string | undefined {
  for (const { pattern, label } of NAVIGATION_PATTERNS) {
    if (pattern.test(source)) return label;
  }
  return undefined;
}

function emit(
  filePath: string,
  el: { loc: { start: { line: number; column: number } } },
  handler: string,
  tag: string,
  matchedLabel: string,
  candidates: ReviewCandidate[],
): void {
  const reason = `${handler} handler on <${tag}> invokes ${matchedLabel} — verify the context change is expected on this event`;
  for (const criterionId of criteriaForHandler(handler)) {
    candidates.push({
      criterionId,
      location: { filePath, line: el.loc.start.line, column: el.loc.start.column },
      reason,
    });
  }
}

function findHtmlCandidates(
  root: HtmlDocument,
  filePath: string,
  candidates: ReviewCandidate[],
): void {
  for (const el of walkHtmlElements(root)) {
    for (const attr of HTML_HANDLER_ATTRS) {
      if (!hasHtmlAttribute(el, attr)) continue;
      const source = getHtmlAttribute(el, attr);
      if (!source) continue;
      const label = detectContextChange(source);
      if (!label) continue;
      emit(filePath, el, attr, el.tagName, label, candidates);
    }
  }
}

function findJsxCandidates(root: TsxModule, filePath: string, candidates: ReviewCandidate[]): void {
  for (const el of walkJsxElements(root)) {
    for (const attr of JSX_HANDLER_ATTRS) {
      const node = getJsxAttribute(el, attr);
      if (!node?.value || node.value.kind !== "Expression") continue;
      const label = detectContextChange(node.value.raw);
      if (!label) continue;
      emit(filePath, el, attr, el.tagName, label, candidates);
    }
  }
}
