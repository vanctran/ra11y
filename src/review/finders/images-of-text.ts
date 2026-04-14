/**
 * Candidate finder: review/images-of-text
 * Criteria: wcag22:1.4.5, wcag21:1.4.5, section508:1.4.5, en301549:9.1.4.5
 * Spec: https://www.w3.org/TR/WCAG22/#images-of-text
 *
 * Surfaces `<img>` elements that look like baked-in text:
 *   - short alt text (1-5 words) repeated in surrounding visible text
 *   - class/src names suggesting logo, banner, heading, title, or header art
 *
 * WCAG 1.4.5 permits images of text only when the presentation is
 * essential or customizable. A static finder cannot decide whether an
 * image is actually required, but it can highlight places where text
 * appears likely to be embedded in raster artwork.
 *
 * Review finder — biased toward false positives. Output is a checklist
 * of places to verify, not a list of failures.
 */

import { defineCandidateFinder } from "../../api/plugin.ts";
import {
  getHtmlAttribute,
  getJsxAttribute,
  htmlTextContent,
  jsxTextContent,
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
  "wcag22:1.4.5",
  "wcag21:1.4.5",
  "section508:1.4.5",
  "en301549:9.1.4.5",
] as const;

const IMAGE_OF_TEXT_HINT = /\b(logo|banner|heading|title|header)\b/;

export const finder = defineCandidateFinder({
  id: "review/images-of-text",
  criterionIds: [...CRITERION_IDS],
  scope: "node",
  appliesTo: { fileExtensions: [".html", ".htm", ".tsx", ".jsx"] },
  docs: {
    description:
      "Finds <img> elements whose short alt text is duplicated in surrounding text, or whose src/class names suggest logo/banner/heading/title/header artwork.",
    reviewPrompt:
      "Verify the highlighted image is not conveying text that should instead be real HTML text styled with CSS. If the image is a true logo, brand mark, or otherwise essential presentation, document that exception. Otherwise confirm equivalent live text is available and the image is not the only way the words are presented.",
    references: [
      "https://www.w3.org/TR/WCAG22/#images-of-text",
      "https://www.w3.org/WAI/WCAG22/Understanding/images-of-text.html",
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
  scanHtmlChildren(root.children, null, filePath, candidates);
}

function scanHtmlChildren(
  children: readonly HtmlNode[],
  parentText: string | null,
  filePath: string,
  candidates: ReviewCandidate[],
): void {
  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    if (child?.kind !== "HtmlElement") continue;
    emitHtmlImageCandidate(child, children, index, parentText, filePath, candidates);
    scanHtmlChildren(child.children, htmlTextContent(child), filePath, candidates);
  }
}

function emitHtmlImageCandidate(
  element: HtmlElement,
  siblings: readonly HtmlNode[],
  index: number,
  parentText: string | null,
  filePath: string,
  candidates: ReviewCandidate[],
): void {
  if (element.tagName.toLowerCase() !== "img") return;
  const alt = shortImageText(getHtmlAttribute(element, "alt"));
  const signals = collectSignals(
    alt,
    parentText,
    adjacentHtmlText(siblings, index),
    keywordHint(getHtmlAttribute(element, "class"), getHtmlAttribute(element, "src")),
  );
  if (signals.length === 0) return;
  pushForAllCriteria(
    candidates,
    filePath,
    element.loc.start.line,
    element.loc.start.column,
    renderReason(signals),
  );
}

function findJsxCandidates(root: TsxModule, filePath: string, candidates: ReviewCandidate[]): void {
  for (const element of root.jsxElements) {
    scanJsxElement(element, null, -1, null, filePath, candidates);
  }
}

function scanJsxElement(
  element: JsxElement,
  siblings: readonly JsxNode[] | null,
  index: number,
  parentText: string | null,
  filePath: string,
  candidates: ReviewCandidate[],
): void {
  emitJsxImageCandidate(element, siblings, index, parentText, filePath, candidates);
  const currentText = jsxTextContent(element);
  for (let childIndex = 0; childIndex < element.children.length; childIndex++) {
    const child = element.children[childIndex];
    if (child?.kind !== "JsxElement") continue;
    scanJsxElement(child, element.children, childIndex, currentText, filePath, candidates);
  }
}

function emitJsxImageCandidate(
  element: JsxElement,
  siblings: readonly JsxNode[] | null,
  index: number,
  parentText: string | null,
  filePath: string,
  candidates: ReviewCandidate[],
): void {
  if (element.tagName !== "img") return;
  const alt = shortImageText(literalJsxAttribute(element, "alt"));
  const signals = collectSignals(
    alt,
    parentText,
    adjacentJsxText(siblings, index),
    keywordHint(
      literalJsxAttribute(element, "className") ?? literalJsxAttribute(element, "class"),
      literalJsxAttribute(element, "src"),
    ),
  );
  if (signals.length === 0) return;
  pushForAllCriteria(
    candidates,
    filePath,
    element.loc.start.line,
    element.loc.start.column,
    renderReason(signals),
  );
}

function adjacentHtmlText(siblings: readonly HtmlNode[], index: number): readonly string[] {
  const out: string[] = [];
  const previous = siblings[index - 1];
  if (previous?.kind === "HtmlText") out.push(previous.value);
  const next = siblings[index + 1];
  if (next?.kind === "HtmlText") out.push(next.value);
  return out;
}

function adjacentJsxText(siblings: readonly JsxNode[] | null, index: number): readonly string[] {
  if (!siblings || index < 0) return [];
  const out: string[] = [];
  const previous = siblings[index - 1];
  if (previous?.kind === "JsxText") out.push(previous.value);
  const next = siblings[index + 1];
  if (next?.kind === "JsxText") out.push(next.value);
  return out;
}

function collectSignals(
  alt: ImageText | null,
  parentText: string | null,
  siblingText: readonly string[],
  keywordSignal: string | null,
): readonly string[] {
  const signals: string[] = [];
  const repeatedText = repeatedTextSignal(alt, parentText, siblingText);
  if (repeatedText) signals.push(repeatedText);
  if (keywordSignal) signals.push(keywordSignal);
  return signals;
}

function repeatedTextSignal(
  alt: ImageText | null,
  parentText: string | null,
  siblingText: readonly string[],
): string | null {
  if (!alt) return null;
  for (const text of siblingText) {
    if (containsWholePhrase(text, alt.normalized)) {
      return `short alt text "${alt.raw}" is repeated in an immediate sibling text node`;
    }
  }
  if (parentText && containsWholePhrase(parentText, alt.normalized)) {
    return `short alt text "${alt.raw}" is repeated in surrounding text`;
  }
  return null;
}

function keywordHint(classValue: string | null, srcValue: string | null): string | null {
  const classKeyword = keywordMatch(classValue);
  if (classKeyword) return `class suggests "${classKeyword}" artwork`;
  const srcKeyword = keywordMatch(fileNameFromPath(srcValue));
  if (srcKeyword) return `src filename suggests "${srcKeyword}" artwork`;
  return null;
}

function keywordMatch(value: string | null): string | null {
  const normalized = normalizeForMatch(value);
  if (!normalized) return null;
  const match = normalized.match(IMAGE_OF_TEXT_HINT);
  return match?.[1] ?? null;
}

function fileNameFromPath(value: string | null): string | null {
  if (value === null) return null;
  const path = value.split("?")[0]?.split("#")[0] ?? value;
  const parts = path.split("/");
  return parts[parts.length - 1] ?? null;
}

function containsWholePhrase(haystack: string, needle: string): boolean {
  const normalized = normalizeForMatch(haystack);
  if (!normalized) return false;
  return ` ${normalized} `.includes(` ${needle} `);
}

function shortImageText(value: string | null): ImageText | null {
  const raw = collapseWhitespace(value);
  if (!raw) return null;
  const normalized = normalizeForMatch(raw);
  if (!normalized) return null;
  const words = normalized.split(" ");
  if (words.length < 1 || words.length > 5) return null;
  return { raw, normalized };
}

function literalJsxAttribute(element: JsxElement, name: string): string | null {
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

function collapseWhitespace(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeForMatch(value: string | null): string | null {
  const collapsed = collapseWhitespace(value);
  if (!collapsed) return null;
  const normalized = collapsed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return normalized.length > 0 ? normalized : null;
}

function renderReason(signals: readonly string[]): string {
  return `<img> ${signals.join("; ")} — verify text is not baked into the image when equivalent styled HTML text could be used`;
}

function pushForAllCriteria(
  candidates: ReviewCandidate[],
  filePath: string,
  line: number,
  column: number,
  reason: string,
): void {
  for (const criterionId of CRITERION_IDS) {
    candidates.push({ criterionId, location: { filePath, line, column }, reason });
  }
}

interface ImageText {
  readonly raw: string;
  readonly normalized: string;
}
