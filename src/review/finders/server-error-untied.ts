/**
 * Candidate finder: review/server-error-untied
 * Criterion: wcag22:3.3.1
 * Spec: https://www.w3.org/TR/WCAG22/#error-identification
 *
 * Surfaces server-validation error messages (live-region / alert nodes)
 * that appear next to a native form control whose wiring does not make
 * the pairing obvious to assistive technology. WCAG 3.3.1 requires that
 * when an input error is detected the item in error is identified and
 * the error is described to the user in text; if the described text
 * lives in a sibling `<p role="alert">` or `<div aria-live="polite">`
 * but the control carries no `aria-invalid` and no `aria-describedby`
 * that points at the alert's id, a screen reader user may never hear
 * the error tied to the field they just touched.
 *
 * Shape of the heuristic:
 *
 *   1. Walk every JSX / HTML element whose `role="alert"` is a literal
 *      string or whose `aria-live` is a non-empty string literal
 *      (`"polite"` / `"assertive"` / `"off"` is rejected — "off" is an
 *      active suppression, not an error surface).
 *   2. Inspect the element's direct siblings under the same parent.
 *   3. Fire a candidate when at least one direct-sibling native form
 *      control (`<input>`, `<textarea>`, `<select>`) lacks BOTH
 *      `aria-invalid` and an `aria-describedby` whose token set
 *      contains the alert's id (when the alert has one).
 *   4. If the alert has no id, the sibling can still be untied — we
 *      only require `aria-invalid` to be absent to fire, because
 *      `aria-describedby` cannot possibly point at an id that doesn't
 *      exist. The agent reads the file and decides whether the pairing
 *      is real or whether the error should grow an id.
 *
 * Review finder — biased toward false positives. The cross-element
 * pairing question is exactly the kind of thing agents investigate
 * better than static heuristics. The finder points at a file:line;
 * the agent verifies.
 *
 * Design choices aligned with AI-first doctrine
 * (docs/kb/architecture/ai-first-consumer.md):
 *
 * - **Loose on purpose.** No attempt to be clever about "what the
 *   author really meant" — an alert beside a field without visible
 *   wiring is the question we're asking, and the agent's next read
 *   resolves it.
 * - **Confidence: "medium".** The two missing-attribute checks are
 *   deterministic, but the author's intent is not — the error region
 *   may belong to a different field, may be wired through a
 *   component hook (react-hook-form, shadcn FormMessage), or may be
 *   a transient page-level toast that legitimately isn't tied to a
 *   specific control. The agent reads the surrounding code and
 *   decides.
 * - **Native intrinsics only.** PascalCase component wrappers are
 *   skipped — attribute forwarding is invisible here, and the
 *   companion `forms/required-indicator-missing` rule covers the
 *   wrapper-definition side of the same coin.
 */

import { defineCandidateFinder } from "../../api/plugin.ts";
import {
  getHtmlAttribute,
  getJsxAttribute,
  hasHtmlAttribute,
  hasJsxAttribute,
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

const CRITERION_IDS = ["wcag22:3.3.1"] as const;

const NATIVE_FORM_TAGS: ReadonlySet<string> = new Set(["input", "textarea", "select"]);

/**
 * `aria-live` values that designate an active announcement surface. `"off"`
 * (the ARIA default) is a suppression directive, not an error channel, so it
 * is excluded — an element carrying `aria-live="off"` will not reach a screen
 * reader even if the wiring were perfect.
 */
const ACTIVE_LIVE_VALUES: ReadonlySet<string> = new Set(["polite", "assertive"]);

export const finder = defineCandidateFinder({
  id: "review/server-error-untied",
  criterionIds: [...CRITERION_IDS],
  scope: "node",
  appliesTo: { fileExtensions: [".html", ".htm", ".tsx", ".jsx"] },
  docs: {
    description:
      'Finds alert / live-region nodes (role="alert" or aria-live="polite|assertive") sitting beside a native form control whose wiring does not make the pairing obvious — no aria-invalid on the control, and no aria-describedby that points at the alert\'s id.',
    reviewPrompt:
      "Read the surrounding form and confirm whether this alert region is meant to describe the neighboring field. If it is, wire the control with aria-invalid={hasError} and aria-describedby pointing at the alert's id (add an id to the alert if needed). If the alert belongs to a different field or is a page-level toast unrelated to this control, no change is needed — the candidate can be dismissed by the agent's read.",
    references: [
      "https://www.w3.org/TR/WCAG22/#error-identification",
      "https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html",
      "https://www.w3.org/TR/wai-aria-1.2/#aria-live",
    ],
  },
  find(ctx) {
    const candidates: ReviewCandidate[] = [];
    if (ctx.language === "html") {
      scanHtml(ctx.ast as HtmlDocument, ctx.filePath, candidates);
    } else if (ctx.language === "tsx" || ctx.language === "jsx") {
      scanJsx(ctx.ast as TsxModule, ctx.filePath, candidates);
    }
    return candidates;
  },
});

// ---------------------------------------------------------------------------
// HTML side
// ---------------------------------------------------------------------------

function scanHtml(root: HtmlDocument, filePath: string, candidates: ReviewCandidate[]): void {
  walkHtmlSiblings(root.children, filePath, candidates);
}

function walkHtmlSiblings(
  siblings: readonly HtmlNode[],
  filePath: string,
  candidates: ReviewCandidate[],
): void {
  for (let index = 0; index < siblings.length; index++) {
    const node = siblings[index];
    if (node?.kind !== "HtmlElement") continue;
    if (isHtmlAlertLike(node)) {
      const signal = detectHtmlUntiedSignal(node, siblings, index);
      if (signal !== null) {
        pushCandidate(candidates, filePath, node.loc.start.line, node.loc.start.column, signal);
      }
    }
    walkHtmlSiblings(node.children, filePath, candidates);
  }
}

function isHtmlAlertLike(element: HtmlElement): boolean {
  const role = normalizeLower(getHtmlAttribute(element, "role"));
  if (role === "alert") return true;
  const live = normalizeLower(getHtmlAttribute(element, "aria-live"));
  return live !== null && ACTIVE_LIVE_VALUES.has(live);
}

function detectHtmlUntiedSignal(
  alert: HtmlElement,
  siblings: readonly HtmlNode[],
  alertIndex: number,
): string | null {
  const alertId = normalizeToken(getHtmlAttribute(alert, "id"));
  const surface = describeHtmlAlertSurface(alert);
  for (let i = 0; i < siblings.length; i++) {
    if (i === alertIndex) continue;
    const sibling = siblings[i];
    if (sibling?.kind !== "HtmlElement") continue;
    if (!isNativeFormTag(sibling.tagName)) continue;
    if (isHtmlControlWiredTo(sibling, alertId)) continue;
    return buildReason(surface, alertId, sibling.tagName.toLowerCase());
  }
  return null;
}

function isHtmlControlWiredTo(control: HtmlElement, alertId: string | null): boolean {
  if (!hasHtmlAttribute(control, "aria-invalid")) return false;
  if (alertId === null) return true;
  const describedBy = getHtmlAttribute(control, "aria-describedby");
  return tokenizeIdRefs(describedBy).includes(alertId);
}

function describeHtmlAlertSurface(element: HtmlElement): string {
  const tag = element.tagName.toLowerCase();
  const role = normalizeLower(getHtmlAttribute(element, "role"));
  if (role === "alert") return `<${tag} role="alert">`;
  const live = normalizeLower(getHtmlAttribute(element, "aria-live"));
  return `<${tag} aria-live="${live ?? ""}">`;
}

// ---------------------------------------------------------------------------
// JSX side
// ---------------------------------------------------------------------------

function scanJsx(root: TsxModule, filePath: string, candidates: ReviewCandidate[]): void {
  // `TsxModule.jsxElements` is the list of top-level JSX roots scanned from
  // outside JSX context. Top-level roots aren't siblings under a shared
  // parent element, so we don't inspect them for pairing — we only descend
  // into each root's children and let the children walker see real sibling
  // arrays. A standalone top-level alert with no siblings can't fire the
  // heuristic anyway; the cross-element question requires siblings.
  for (const topLevel of root.jsxElements) {
    walkJsxChildren(topLevel.children, filePath, candidates);
  }
}

function walkJsxChildren(
  siblings: readonly JsxNode[],
  filePath: string,
  candidates: ReviewCandidate[],
): void {
  for (let index = 0; index < siblings.length; index++) {
    const node = siblings[index];
    if (node?.kind !== "JsxElement") continue;
    if (isJsxAlertLike(node)) {
      const signal = detectJsxUntiedSignal(node, siblings, index);
      if (signal !== null) {
        pushCandidate(candidates, filePath, node.loc.start.line, node.loc.start.column, signal);
      }
    }
    walkJsxChildren(node.children, filePath, candidates);
  }
}

function isJsxAlertLike(element: JsxElement): boolean {
  const role = getLiteralJsxAttribute(element, "role");
  if (role !== null && role.toLowerCase() === "alert") return true;
  const live = getLiteralJsxAttribute(element, "aria-live");
  if (live === null) return false;
  return ACTIVE_LIVE_VALUES.has(live.toLowerCase());
}

function detectJsxUntiedSignal(
  alert: JsxElement,
  siblings: readonly JsxNode[],
  alertIndex: number,
): string | null {
  const alertId = normalizeToken(getLiteralJsxAttribute(alert, "id"));
  const surface = describeJsxAlertSurface(alert);
  for (let i = 0; i < siblings.length; i++) {
    if (i === alertIndex) continue;
    const sibling = siblings[i];
    if (sibling?.kind !== "JsxElement") continue;
    // JSX convention: only lowercase intrinsic tags are native HTML
    // controls. PascalCase wrappers forward props via hooks or spreads
    // invisible here, so a case-insensitive match would silently flag
    // `<Input>` as a native control and produce false positives. The
    // companion `forms/required-indicator-missing` rule covers the
    // wrapper-definition side of the same coin.
    if (!NATIVE_FORM_TAGS.has(sibling.tagName)) continue;
    if (isJsxControlWiredTo(sibling, alertId)) continue;
    return buildReason(surface, alertId, sibling.tagName);
  }
  return null;
}

function isJsxControlWiredTo(control: JsxElement, alertId: string | null): boolean {
  if (!hasJsxAttribute(control, "aria-invalid")) return false;
  if (alertId === null) return true;
  const describedBy = getLiteralJsxAttribute(control, "aria-describedby");
  return tokenizeIdRefs(describedBy).includes(alertId);
}

function describeJsxAlertSurface(element: JsxElement): string {
  const role = getLiteralJsxAttribute(element, "role");
  if (role !== null && role.toLowerCase() === "alert") {
    return `<${element.tagName} role="alert">`;
  }
  const live = getLiteralJsxAttribute(element, "aria-live");
  return `<${element.tagName} aria-live="${live ?? ""}">`;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function isNativeFormTag(tagName: string): boolean {
  return NATIVE_FORM_TAGS.has(tagName.toLowerCase());
}

function buildReason(surface: string, alertId: string | null, siblingTag: string): string {
  const idPhrase =
    alertId === null
      ? "no id (so aria-describedby cannot point at it)"
      : `id="${alertId}" but no sibling aria-describedby token references it`;
  return `${surface} sits beside a <${siblingTag}> that has no aria-invalid and ${idPhrase} — verify the error is programmatically associated with the field`;
}

function pushCandidate(
  candidates: ReviewCandidate[],
  filePath: string,
  line: number,
  column: number,
  reason: string,
): void {
  for (const criterionId of CRITERION_IDS) {
    // Confidence "medium": two missing-attribute checks are
    // deterministic, but the pairing intent is not. The alert may
    // belong to a different field, the wiring may be injected at
    // runtime through a hook, or the region may be a page-level
    // toast unrelated to this control. The agent's next read
    // resolves it in seconds.
    candidates.push({
      criterionId,
      location: { filePath, line, column },
      reason,
      confidence: "medium",
    });
  }
}

function tokenizeIdRefs(value: string | null): readonly string[] {
  if (value === null) return [];
  const out: string[] = [];
  for (const raw of value.split(/\s+/)) {
    const normalized = normalizeToken(raw);
    if (normalized !== null) out.push(normalized);
  }
  return out;
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
  if (value === null) return null;
  const collapsed = value.replace(/\s+/g, " ").trim().toLowerCase();
  return collapsed.length > 0 ? collapsed : null;
}

function normalizeToken(value: string | null): string | null {
  if (value === null) return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > 0 ? collapsed : null;
}
