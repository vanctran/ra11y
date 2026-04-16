/**
 * Candidate finder: review/on-input-change
 * Criteria: wcag22:3.2.1, wcag21:3.2.1, wcag22:3.2.2, wcag21:3.2.2
 * Spec: https://www.w3.org/TR/WCAG22/#on-focus
 *       https://www.w3.org/TR/WCAG22/#on-input
 *
 * Surfaces every focus/blur/change event handler for manual review and
 * annotates each candidate with a confidence tier based on what static
 * analysis can see. When the handler's inline source text contains a
 * navigation/submission call (`router.push`, `window.location.*`,
 * `.submit()`, etc.) we call the candidate "high confidence: static
 * nav/submit call detected" — the reviewer should confirm the context
 * change is expected on this event. When no such call is visible — or
 * the handler is a bare identifier we can't inspect — we call it "low
 * confidence: handler opaque / no static nav signal detected" so the
 * reviewer can decide in seconds.
 *
 * Why this finder surfaces the low-confidence tier instead of staying
 * silent: WCAG 3.2.1/3.2.2 covers *every* focus/input event handler,
 * not just ones whose body we can see. A handler that is a reference
 * (`onChange={handleChange}`) can still do anything the referenced
 * function does — the absence of a grep match here is not evidence of
 * safety, and silent-dropping those candidates leaves a user-facing
 * regression invisible to an agent consuming this tool. CLAUDE.md §1
 * ("Surface, don't suppress"; "Labeled buckets are suppression too")
 * makes the call: surface all handlers; encode the analysis-depth
 * signal in `reason` so the agent can triage per-candidate.
 *
 * Review finder — biased toward false positives. The output is a
 * checklist of places to verify, not a list of failures.
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
      "Surfaces every focus/blur/change handler and tiers the candidate by confidence. High-confidence candidates have a statically detectable navigation or submission call in the handler source; low-confidence candidates cover handlers whose source shows no such call or whose body is opaque (bare identifier reference).",
    reviewPrompt:
      "Verify that triggering this handler (on focus, blur, or value change) is expected behavior and announced to the user. If it navigates or submits unexpectedly, refactor so the context change is triggered only by an explicit user action. For low-confidence candidates, open the handler's definition and confirm the body doesn't invoke a router, window.location, or form.submit() that the static scan couldn't see from the attribute alone.",
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

/**
 * True when the handler expression looks like a bare identifier
 * reference (`onChange={handleChange}`) or property access
 * (`onChange={this.handleChange}`) — i.e., a function reference whose
 * body is not visible in the attribute source. Arrow and function
 * expressions written inline still count as "body visible" even when
 * the body turns out to be empty.
 */
function looksLikeFunctionReference(source: string): boolean {
  const trimmed = stripOuterBraces(source);
  if (trimmed.length === 0) return false;
  if (trimmed.includes("=>")) return false;
  if (/\bfunction\b/.test(trimmed)) return false;
  // Bare identifier or dotted property chain, optionally followed by
  // `.bind(...)` / `.call(...)`. The body isn't inline either way.
  return /^[$_A-Za-z][\w$]*(?:\.[$_A-Za-z][\w$]*)*(?:\([^)]*\))?$/.test(trimmed);
}

/**
 * Strips the outer JSX expression braces the TSX parser captures as
 * part of an attribute's `.raw` (it preserves `{handleChange}` verbatim
 * so downstream tools can see the full slice). HTML handlers are
 * unaffected — they were parsed out of a quoted string.
 */
function stripOuterBraces(source: string): string {
  const trimmed = source.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function emit(
  filePath: string,
  el: { loc: { start: { line: number; column: number } } },
  handler: string,
  tag: string,
  source: string,
  candidates: ReviewCandidate[],
): void {
  const label = detectContextChange(source);
  const reason = label
    ? `${handler} handler on <${tag}> invokes ${label} -- verify the context change is expected on this event (high confidence: static nav/submit call detected in handler body)`
    : looksLikeFunctionReference(source)
      ? `${handler} handler on <${tag}> passes a function reference ("${truncate(source)}") -- verify the referenced body does not invoke a router, window.location, or .submit() that would trigger an unexpected context change (low confidence: handler body not inline, static analysis cannot inspect it)`
      : `${handler} handler on <${tag}> -- no static navigation or submission signal detected in the handler source; verify the handler does not trigger an unexpected context change (low confidence: inline body visible but patterns may vary)`;
  for (const criterionId of criteriaForHandler(handler)) {
    candidates.push({
      criterionId,
      location: { filePath, line: el.loc.start.line, column: el.loc.start.column },
      reason,
    });
  }
}

const MAX_REF_SNIPPET_LEN = 60;

function truncate(source: string): string {
  const trimmed = stripOuterBraces(source);
  if (trimmed.length <= MAX_REF_SNIPPET_LEN) return trimmed;
  return `${trimmed.slice(0, MAX_REF_SNIPPET_LEN - 1)}…`;
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
      emit(filePath, el, attr, el.tagName, source, candidates);
    }
  }
}

function findJsxCandidates(root: TsxModule, filePath: string, candidates: ReviewCandidate[]): void {
  for (const el of walkJsxElements(root)) {
    for (const attr of JSX_HANDLER_ATTRS) {
      const node = getJsxAttribute(el, attr);
      if (!node?.value || node.value.kind !== "Expression") continue;
      emit(filePath, el, attr, el.tagName, node.value.raw, candidates);
    }
  }
}
