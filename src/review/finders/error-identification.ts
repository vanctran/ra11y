/**
 * Candidate finder: review/error-identification
 * Criteria: wcag22:3.3.1, wcag21:3.3.1
 * Spec: https://www.w3.org/TR/WCAG22/#error-identification
 *
 * Surfaces native form controls carrying a literal `aria-invalid="true"`
 * (or `aria-invalid={true}` in JSX) that expose no programmatic
 * association to an error description — neither `aria-describedby` nor
 * `aria-errormessage` is present on the element. WCAG 3.3.1 requires
 * that when an input error is automatically detected, the item is
 * identified and the error is described to the user in text. A human
 * reviewer must confirm the described text exists, is meaningful, and
 * reaches the user.
 *
 * The signal is intentionally narrow:
 *   - Only native intrinsic controls (input, select, textarea) — skipping
 *     PascalCase wrappers where the attribute forwarding is invisible to
 *     static analysis.
 *   - Only literal "true" / {true} values — not variable expressions.
 *   - Missing BOTH aria-describedby and aria-errormessage — either one
 *     is sufficient association under ARIA 1.2, so either one passes
 *     the static check.
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
  walkHtmlElements,
  walkJsxElements,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, HtmlElement, JsxElement, TsxModule } from "../../types/ast.ts";
import type { ReviewCandidate } from "../../types/review.ts";

const CRITERION_IDS = ["wcag22:3.3.1", "wcag21:3.3.1"] as const;

const NATIVE_FORM_TAGS: ReadonlySet<string> = new Set(["input", "select", "textarea"]);

export const finder = defineCandidateFinder({
  id: "review/error-identification",
  criterionIds: [...CRITERION_IDS],
  scope: "node",
  appliesTo: { fileExtensions: [".html", ".htm", ".tsx", ".jsx"] },
  docs: {
    description:
      'Finds native form controls marked aria-invalid="true" without any programmatic link to an error description (neither aria-describedby nor aria-errormessage).',
    reviewPrompt:
      "Verify that the error for this invalid control is described to the user in text, is reachable by a screen reader, and is announced when the error is detected. Either wire aria-describedby to a live-region node containing the error text, or use aria-errormessage — whichever matches the surrounding pattern. If the wiring happens through a component hook (react-hook-form, formik, shadcn FormMessage), confirm it resolves at runtime.",
    references: [
      "https://www.w3.org/TR/WCAG22/#error-identification",
      "https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html",
      "https://www.w3.org/TR/wai-aria-1.2/#aria-errormessage",
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
  for (const el of walkHtmlElements(root)) {
    if (!isNativeFormControl(el.tagName)) continue;
    if (isHiddenInput(el)) continue;
    const ariaInvalid = getHtmlAttribute(el, "aria-invalid");
    if (!isLiteralTrue(ariaInvalid)) continue;
    if (hasHtmlAttribute(el, "aria-describedby") || hasHtmlAttribute(el, "aria-errormessage"))
      continue;
    pushForAllCriteria(candidates, filePath, el.loc.start.line, el.loc.start.column, el.tagName);
  }
}

function findJsxCandidates(root: TsxModule, filePath: string, candidates: ReviewCandidate[]): void {
  for (const el of walkJsxElements(root)) {
    // JSX convention: only lowercase intrinsic tags are native HTML controls.
    // PascalCase wrappers forward props via hooks or spreads invisible here.
    if (!NATIVE_FORM_TAGS.has(el.tagName)) continue;
    if (isHiddenJsxInput(el)) continue;
    if (!hasLiteralTrueAriaInvalid(el)) continue;
    if (hasJsxAttribute(el, "aria-describedby") || hasJsxAttribute(el, "aria-errormessage"))
      continue;
    pushForAllCriteria(candidates, filePath, el.loc.start.line, el.loc.start.column, el.tagName);
  }
}

function isNativeFormControl(tagName: string): boolean {
  return NATIVE_FORM_TAGS.has(tagName.toLowerCase());
}

function isHiddenInput(el: HtmlElement): boolean {
  if (el.tagName.toLowerCase() !== "input") return false;
  const type = getHtmlAttribute(el, "type");
  return type !== null && type.toLowerCase() === "hidden";
}

function isHiddenJsxInput(el: JsxElement): boolean {
  if (el.tagName.toLowerCase() !== "input") return false;
  const attr = getJsxAttribute(el, "type");
  if (!attr?.value) return false;
  const literal = jsxAttrStringLiteral(attr.value);
  return literal !== null && literal.toLowerCase() === "hidden";
}

function isLiteralTrue(value: string | null): boolean {
  return value !== null && value.toLowerCase() === "true";
}

function hasLiteralTrueAriaInvalid(el: JsxElement): boolean {
  const attr = getJsxAttribute(el, "aria-invalid");
  if (!attr?.value) return false;
  if (attr.value.kind === "StringLiteral") {
    return attr.value.value.toLowerCase() === "true";
  }
  // Expression: accept the bare boolean `{true}` and the
  // string-literal-in-braces form `{"true"}` / `{'true'}`. Both render
  // identically in the DOM. Anything else (variables, function calls,
  // ternaries) is out of scope for this static finder.
  const literal = jsxAttrStringLiteral(attr.value);
  if (literal !== null) return literal.toLowerCase() === "true";
  const raw = attr.value.raw;
  const inner = raw.startsWith("{") && raw.endsWith("}") ? raw.slice(1, -1) : raw;
  return inner.trim() === "true";
}

/**
 * Extracts a string literal value from a JsxAttributeValue, accepting
 * both the plain StringLiteral form (`foo="bar"`) and the expression
 * form wrapping a quoted literal (`foo={"bar"}` or `foo={'bar'}`).
 * Returns null when the value is a non-literal expression (variable,
 * call, etc.), so callers can decide whether to treat it as "unknown."
 */
function jsxAttrStringLiteral(value: {
  kind: "StringLiteral" | "Expression";
  value?: string;
  raw?: string;
}): string | null {
  if (value.kind === "StringLiteral") return value.value ?? null;
  if (!value.raw) return null;
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

function pushForAllCriteria(
  candidates: ReviewCandidate[],
  filePath: string,
  line: number,
  column: number,
  tagName: string,
): void {
  const reason = `<${tagName}> has aria-invalid="true" but no aria-describedby or aria-errormessage — verify the error is described in text and programmatically associated`;
  for (const criterionId of CRITERION_IDS) {
    candidates.push({ criterionId, location: { filePath, line, column }, reason });
  }
}
