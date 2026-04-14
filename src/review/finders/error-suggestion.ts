/**
 * Candidate finder: review/error-suggestion
 * Criteria: wcag22:3.3.3, wcag21:3.3.3, section508:3.3.3, en301549:9.3.3.3
 * Spec: https://www.w3.org/TR/WCAG22/#error-suggestion
 *
 * Surfaces native `<input>` controls that clearly have built-in
 * validation constraints (`required`, `pattern`, or
 * `type="email|url|tel"`) and appear to show an error message with no
 * corrective suggestion. WCAG 3.3.3 expects more than "Invalid" or
 * "Required field" — the message should tell the user how to fix the
 * input.
 *
 * Signal is intentionally narrow:
 *   - Only intrinsic `<input>` elements, not PascalCase wrappers.
 *   - Only three association paths: `aria-describedby`, adjacent
 *     `role="alert"`, and adjacent error-class message nodes.
 *   - Only short, error-like text with no suggestion words such as
 *     "enter", "format", "minimum", or "example".
 *
 * Review finder — biased toward false positives. Output is a checklist
 * of places to verify, not a list of failures.
 */

import { defineCandidateFinder } from "../../api/plugin.ts";
import {
  getHtmlAttribute,
  getJsxAttribute,
  hasHtmlAttribute,
  hasJsxAttribute,
  htmlTextContent,
  jsxTextContent,
  walkHtmlElements,
  walkJsxElements,
} from "../../engine/ast-helpers.ts";
import type {
  HtmlDocument,
  HtmlElement,
  HtmlNode,
  JsxAttributeValue,
  JsxElement,
  JsxNode,
  TsxModule,
} from "../../types/ast.ts";
import type { ReviewCandidate } from "../../types/review.ts";

const CRITERION_IDS = [
  "wcag22:3.3.3",
  "wcag21:3.3.3",
  "section508:3.3.3",
  "en301549:9.3.3.3",
] as const;

const VALIDATION_INPUT_TYPES: ReadonlySet<string> = new Set(["email", "tel", "url"]);

const HELPFUL_CUES = [
  "try",
  "must",
  "should",
  "enter",
  "example",
  "e.g.",
  "e.g",
  "minimum",
  "maximum",
  "at least",
  "no more than",
  "format",
  "character",
  "characters",
] as const;

const ERROR_KEYWORDS = /\b(?:invalid|required|error)\b|not valid/;

interface MessageMatch {
  readonly association: string;
  readonly text: string;
}

type HtmlIdIndex = Map<string, HtmlElement[]>;
type JsxIdIndex = Map<string, JsxElement[]>;

export const finder = defineCandidateFinder({
  id: "review/error-suggestion",
  criterionIds: [...CRITERION_IDS],
  scope: "node",
  appliesTo: { fileExtensions: [".html", ".htm", ".tsx", ".jsx"] },
  docs: {
    description:
      'Finds constrained native <input> controls whose associated error text is short and error-like ("Invalid", "Required field") but offers no corrective suggestion.',
    reviewPrompt:
      "Verify the highlighted error tells the user what to do next, not just that something is wrong. A good error usually includes the missing step or format to use, such as what to enter, the expected pattern, or the allowed minimum/maximum. If the real suggestion is injected at runtime, confirm it reaches both visual users and assistive technology.",
    references: [
      "https://www.w3.org/TR/WCAG22/#error-suggestion",
      "https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html",
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
  const idIndex = indexHtmlIds(root);
  scanHtmlChildren(root.children, idIndex, filePath, candidates);
}

function indexHtmlIds(root: HtmlDocument): HtmlIdIndex {
  const out: HtmlIdIndex = new Map();
  for (const element of walkHtmlElements(root)) {
    const id = normalizeToken(getHtmlAttribute(element, "id"));
    if (!id) continue;
    appendToArrayMap(out, id, element);
  }
  return out;
}

function scanHtmlChildren(
  children: readonly HtmlNode[],
  idIndex: HtmlIdIndex,
  filePath: string,
  candidates: ReviewCandidate[],
): void {
  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    if (child?.kind !== "HtmlElement") continue;
    emitHtmlCandidate(child, children, index, idIndex, filePath, candidates);
    scanHtmlChildren(child.children, idIndex, filePath, candidates);
  }
}

function emitHtmlCandidate(
  element: HtmlElement,
  siblings: readonly HtmlNode[],
  index: number,
  idIndex: HtmlIdIndex,
  filePath: string,
  candidates: ReviewCandidate[],
): void {
  if (!isRelevantHtmlInput(element)) return;
  const match = matchHtmlMessage(element, siblings, index, idIndex);
  if (!match) return;
  pushForAllCriteria(candidates, filePath, element.loc.start.line, element.loc.start.column, match);
}

function matchHtmlMessage(
  element: HtmlElement,
  siblings: readonly HtmlNode[],
  index: number,
  idIndex: HtmlIdIndex,
): MessageMatch | null {
  const describedByMatch = matchHtmlDescribedBy(element, idIndex);
  if (describedByMatch) return describedByMatch;
  return matchHtmlAdjacentMessage(siblings, index);
}

function matchHtmlDescribedBy(element: HtmlElement, idIndex: HtmlIdIndex): MessageMatch | null {
  for (const id of tokenizeAttribute(getHtmlAttribute(element, "aria-describedby"))) {
    const targets = idIndex.get(id);
    if (!targets) continue;
    for (const target of targets) {
      const text = bareHtmlMessageText(target);
      if (!text) continue;
      return { association: `aria-describedby="#${id}"`, text };
    }
  }
  return null;
}

function matchHtmlAdjacentMessage(
  siblings: readonly HtmlNode[],
  index: number,
): MessageMatch | null {
  const next = nearestHtmlElementSibling(siblings, index, 1);
  const nextMatch = matchHtmlMessageElement(next);
  if (nextMatch) return nextMatch;
  const previous = nearestHtmlElementSibling(siblings, index, -1);
  return matchHtmlMessageElement(previous);
}

function matchHtmlMessageElement(element: HtmlElement | null): MessageMatch | null {
  if (!element) return null;
  const role = normalizeLower(getHtmlAttribute(element, "role"));
  if (role === "alert") {
    const text = bareHtmlMessageText(element);
    if (text) return { association: 'adjacent role="alert"', text };
  }
  if (!hasHtmlErrorClass(element)) return null;
  const text = bareHtmlMessageText(element);
  if (!text) return null;
  return { association: "adjacent error-class message", text };
}

function nearestHtmlElementSibling(
  siblings: readonly HtmlNode[],
  index: number,
  direction: -1 | 1,
): HtmlElement | null {
  for (
    let cursor = index + direction;
    cursor >= 0 && cursor < siblings.length;
    cursor += direction
  ) {
    const sibling = siblings[cursor];
    if (!sibling) break;
    if (sibling.kind === "HtmlComment" || sibling.kind === "HtmlDoctype") continue;
    if (sibling.kind === "HtmlText") {
      if (sibling.value.trim().length === 0) continue;
      return null;
    }
    return sibling;
  }
  return null;
}

function bareHtmlMessageText(element: HtmlElement): string | null {
  return bareMessageText(htmlTextContent(element));
}

function hasHtmlErrorClass(element: HtmlElement): boolean {
  return hasErrorClassHint(getHtmlAttribute(element, "class"));
}

function isRelevantHtmlInput(element: HtmlElement): boolean {
  if (element.tagName.toLowerCase() !== "input") return false;
  if (hasHtmlAttribute(element, "required")) return true;
  if (hasHtmlAttribute(element, "pattern")) return true;
  return isValidationInputType(getHtmlAttribute(element, "type"));
}

function findJsxCandidates(root: TsxModule, filePath: string, candidates: ReviewCandidate[]): void {
  const idIndex = indexJsxIds(root);
  for (let index = 0; index < root.jsxElements.length; index++) {
    const element = root.jsxElements[index];
    if (!element) continue;
    scanJsxElement(element, root.jsxElements, index, idIndex, filePath, candidates);
  }
}

function indexJsxIds(root: TsxModule): JsxIdIndex {
  const out: JsxIdIndex = new Map();
  for (const element of walkJsxElements(root)) {
    const id = normalizeToken(getLiteralJsxAttribute(element, "id"));
    if (!id) continue;
    appendToArrayMap(out, id, element);
  }
  return out;
}

function scanJsxElement(
  element: JsxElement,
  siblings: readonly JsxNode[],
  index: number,
  idIndex: JsxIdIndex,
  filePath: string,
  candidates: ReviewCandidate[],
): void {
  emitJsxCandidate(element, siblings, index, idIndex, filePath, candidates);
  for (let childIndex = 0; childIndex < element.children.length; childIndex++) {
    const child = element.children[childIndex];
    if (child?.kind !== "JsxElement") continue;
    scanJsxElement(child, element.children, childIndex, idIndex, filePath, candidates);
  }
}

function emitJsxCandidate(
  element: JsxElement,
  siblings: readonly JsxNode[],
  index: number,
  idIndex: JsxIdIndex,
  filePath: string,
  candidates: ReviewCandidate[],
): void {
  if (!isRelevantJsxInput(element)) return;
  const match = matchJsxMessage(element, siblings, index, idIndex);
  if (!match) return;
  pushForAllCriteria(candidates, filePath, element.loc.start.line, element.loc.start.column, match);
}

function matchJsxMessage(
  element: JsxElement,
  siblings: readonly JsxNode[],
  index: number,
  idIndex: JsxIdIndex,
): MessageMatch | null {
  const describedByMatch = matchJsxDescribedBy(element, idIndex);
  if (describedByMatch) return describedByMatch;
  return matchJsxAdjacentMessage(siblings, index);
}

function matchJsxDescribedBy(element: JsxElement, idIndex: JsxIdIndex): MessageMatch | null {
  for (const id of tokenizeAttribute(getLiteralJsxAttribute(element, "aria-describedby"))) {
    const targets = idIndex.get(id);
    if (!targets) continue;
    for (const target of targets) {
      const text = bareJsxMessageText(target);
      if (!text) continue;
      return { association: `aria-describedby="#${id}"`, text };
    }
  }
  return null;
}

function matchJsxAdjacentMessage(siblings: readonly JsxNode[], index: number): MessageMatch | null {
  const next = nearestJsxElementSibling(siblings, index, 1);
  const nextMatch = matchJsxMessageElement(next);
  if (nextMatch) return nextMatch;
  const previous = nearestJsxElementSibling(siblings, index, -1);
  return matchJsxMessageElement(previous);
}

function matchJsxMessageElement(element: JsxElement | null): MessageMatch | null {
  if (!element) return null;
  const role = normalizeLower(getLiteralJsxAttribute(element, "role"));
  if (role === "alert") {
    const text = bareJsxMessageText(element);
    if (text) return { association: 'adjacent role="alert"', text };
  }
  if (!hasJsxErrorClass(element)) return null;
  const text = bareJsxMessageText(element);
  if (!text) return null;
  return { association: "adjacent error-class message", text };
}

function nearestJsxElementSibling(
  siblings: readonly JsxNode[],
  index: number,
  direction: -1 | 1,
): JsxElement | null {
  for (
    let cursor = index + direction;
    cursor >= 0 && cursor < siblings.length;
    cursor += direction
  ) {
    const sibling = siblings[cursor];
    if (!sibling) break;
    if (sibling.kind === "JsxText") {
      if (sibling.value.trim().length === 0) continue;
      return null;
    }
    if (sibling.kind === "JsxExpression") return null;
    return sibling;
  }
  return null;
}

function bareJsxMessageText(element: JsxElement): string | null {
  return bareMessageText(jsxTextContent(element));
}

function hasJsxErrorClass(element: JsxElement): boolean {
  return hasErrorClassHint(
    getLiteralJsxAttribute(element, "className") ?? getLiteralJsxAttribute(element, "class"),
  );
}

function isRelevantJsxInput(element: JsxElement): boolean {
  if (element.tagName !== "input") return false;
  if (hasJsxAttribute(element, "required")) return true;
  if (hasJsxAttribute(element, "pattern")) return true;
  return isValidationInputType(getLiteralJsxAttribute(element, "type"));
}

function isValidationInputType(typeValue: string | null): boolean {
  const lowered = normalizeLower(typeValue);
  return lowered !== null && VALIDATION_INPUT_TYPES.has(lowered);
}

function hasErrorClassHint(value: string | null): boolean {
  const normalized = normalizeLower(value);
  if (!normalized) return false;
  return normalized.includes("error") || normalized.includes("invalid-feedback");
}

function bareMessageText(value: string): string | null {
  const text = collapseWhitespace(value);
  if (!text) return null;
  const normalized = normalizeLower(text);
  if (!normalized) return null;
  if (!ERROR_KEYWORDS.test(normalized)) return null;
  if (containsHelpfulCue(normalized)) return null;
  if (normalized.split(" ").length > 6) return null;
  if (normalized.length > 64) return null;
  return text;
}

function containsHelpfulCue(normalizedText: string): boolean {
  for (const cue of HELPFUL_CUES) {
    if (normalizedText.includes(cue)) return true;
  }
  return false;
}

function tokenizeAttribute(value: string | null): readonly string[] {
  if (value === null) return [];
  return value
    .split(/\s+/)
    .map((token) => normalizeToken(token))
    .filter((token): token is string => token !== null);
}

function getLiteralJsxAttribute(element: JsxElement, name: string): string | null {
  const attr = getJsxAttribute(element, name);
  if (!attr?.value) return null;
  return jsxLiteralString(attr.value);
}

function jsxLiteralString(value: JsxAttributeValue): string | null {
  if (value.kind === "StringLiteral") return value.value;
  const trimmed = value.raw.trim();
  if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (
    (inner.startsWith('"') && inner.endsWith('"')) ||
    (inner.startsWith("'") && inner.endsWith("'"))
  ) {
    return inner.slice(1, -1);
  }
  return null;
}

function normalizeLower(value: string | null): string | null {
  const collapsed = collapseWhitespace(value);
  return collapsed ? collapsed.toLowerCase() : null;
}

function normalizeToken(value: string | null): string | null {
  return collapseWhitespace(value);
}

function collapseWhitespace(value: string | null): string | null {
  if (value === null) return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > 0 ? collapsed : null;
}

function appendToArrayMap<T>(map: Map<string, T[]>, key: string, value: T): void {
  const current = map.get(key);
  if (current) {
    current.push(value);
    return;
  }
  map.set(key, [value]);
}

function pushForAllCriteria(
  candidates: ReviewCandidate[],
  filePath: string,
  line: number,
  column: number,
  match: MessageMatch,
): void {
  const reason = `<input> has a constrained validation path, but the associated message via ${match.association} is bare text "${match.text}" with no corrective suggestion`;
  for (const criterionId of CRITERION_IDS) {
    candidates.push({ criterionId, location: { filePath, line, column }, reason });
  }
}
