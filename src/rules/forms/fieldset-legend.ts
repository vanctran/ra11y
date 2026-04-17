/**
 * Rule: forms/fieldset-legend
 * Satisfies: wcag22:1.3.1, wcag21:1.3.1, wcag22:3.3.2, wcag21:3.3.2
 * Spec: https://www.w3.org/TR/WCAG22/#info-and-relationships
 *
 * > Information, structure, and relationships conveyed through
 * > presentation can be programmatically determined or are available
 * > in text.
 *
 * Source: https://www.w3.org/TR/WCAG22/#info-and-relationships
 *
 * Flags `<fieldset>` elements that lack a <legend> as their first
 * element child AND have no `aria-label` / `aria-labelledby` fallback.
 *
 * Why: a fieldset exists to group related form controls (a set of
 * radios, a set of checkboxes, an address block). Screen readers
 * announce the legend as the group's accessible name — "Shipping
 * speed, radio group, 3 items" — so a nameless fieldset is a
 * structure-without-name failure of 1.3.1 and a label-less input
 * collection failure of 3.3.2.
 *
 * HTML spec (4.10.16): "If a fieldset element has a legend element
 * child, the element must be the fieldset's first element child."
 * We don't reimplement HTML structural validation here — a legend
 * that exists but isn't first is a validator job, not an a11y rule
 * job. The accessible name still resolves, so we defer.
 *
 * Exceptions (NOT flagged):
 *   - fieldset has a non-empty aria-label
 *   - fieldset has aria-labelledby (we don't resolve the target, we
 *     trust the authoring intent)
 *   - fieldset's first element child is a <legend> with non-empty
 *     trimmed text content
 *
 * Flagged cases:
 *   - no <legend> child at all, no aria-label[-ledby]
 *   - <legend> present but empty or whitespace-only and no aria-*
 *   - <legend> is not the first element child (still an a11y concern
 *     only if empty or missing — a mispositioned-but-present legend
 *     with text is handled as a no-op here)
 */

import { defineRule } from "../../api/plugin.ts";
import {
  findHtmlElementsByTag,
  findJsxElementsByTag,
  getHtmlAttribute,
  getJsxAttribute,
  getJsxAttributeString,
  hasHtmlAttribute,
  hasJsxAttribute,
  htmlTextContent,
  jsxTextContent,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, HtmlElement, JsxElement, TsxModule } from "../../types/ast.ts";

export const rule = defineRule({
  id: "forms/fieldset-legend",
  satisfies: ["wcag22:1.3.1", "wcag21:1.3.1", "wcag22:3.3.2", "wcag21:3.3.2"],
  severity: "error",
  scope: "node",
  fixClass: "verify-in-source",
  appliesTo: {
    fileExtensions: [".html", ".htm", ".tsx", ".jsx"],
  },
  docs: {
    description:
      "<fieldset> elements must have a non-empty <legend> as their first element child, or an aria-label / aria-labelledby fallback, so the group has an accessible name.",
    rationale:
      "A fieldset groups related controls (radios, checkboxes, address parts). Screen readers announce the legend as the group's accessible name — 'Shipping speed, radio group, 3 items'. Without a legend, users hear only 'radio group' with no clue what the choice is about, and the structural relationship conveyed visually is lost programmatically.",
    goodExample: `<fieldset>\n  <legend>Shipping speed</legend>\n  <label><input type="radio" name="speed" value="std"> Standard</label>\n  <label><input type="radio" name="speed" value="exp"> Express</label>\n</fieldset>`,
    badExample: `<fieldset>\n  <label><input type="radio" name="speed" value="std"> Standard</label>\n  <label><input type="radio" name="speed" value="exp"> Express</label>\n</fieldset>`,
    normativeQuote:
      "Information, structure, and relationships conveyed through presentation can be programmatically determined or are available in text.",
    references: [
      "https://www.w3.org/TR/WCAG22/#info-and-relationships",
      "https://www.w3.org/TR/WCAG22/#labels-or-instructions",
      "https://html.spec.whatwg.org/multipage/form-elements.html#the-fieldset-element",
      "https://www.w3.org/WAI/WCAG22/Techniques/html/H71",
    ],
  },
  check(ctx) {
    if (ctx.language === "html") {
      checkHtml(ctx.ast as HtmlDocument, (v) => ctx.emit(v));
    } else if (
      ctx.language === "tsx" ||
      ctx.language === "jsx" ||
      ctx.language === "ts" ||
      ctx.language === "js"
    ) {
      checkJsx(ctx.ast as TsxModule, (v) => ctx.emit(v));
    }
  },
});

type Emit = (v: {
  severity: "error" | "warning" | "info";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
}) => void;

type Reason = "missing" | "empty";

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function checkHtml(doc: HtmlDocument, emit: Emit): void {
  for (const fieldset of findHtmlElementsByTag(doc, "fieldset")) {
    if (hasHtmlAriaName(fieldset)) continue;
    const reason = diagnoseHtmlLegend(fieldset);
    if (reason === null) continue;
    emit(buildViolation(reason, fieldset.loc.start, describeHtmlFieldset(fieldset)));
  }
}

function hasHtmlAriaName(fieldset: HtmlElement): boolean {
  const ariaLabel = getHtmlAttribute(fieldset, "aria-label");
  if (ariaLabel !== null && ariaLabel.trim().length > 0) return true;
  if (hasHtmlAttribute(fieldset, "aria-labelledby")) return true;
  return false;
}

/**
 * Walks the fieldset's immediate children and returns:
 *   - null  when a non-empty <legend> exists anywhere among them
 *           (mispositioned but still usable as an accessible name)
 *   - "empty"   when a <legend> exists but has no text content
 *   - "missing" when no <legend> child exists at all
 */
function diagnoseHtmlLegend(fieldset: HtmlElement): Reason | null {
  let sawEmptyLegend = false;
  for (const child of fieldset.children) {
    if (child.kind !== "HtmlElement") continue;
    if (child.tagName.toLowerCase() !== "legend") continue;
    if (htmlTextContent(child).length > 0) return null;
    sawEmptyLegend = true;
  }
  return sawEmptyLegend ? "empty" : "missing";
}

function describeHtmlFieldset(fieldset: HtmlElement): string {
  const id = getHtmlAttribute(fieldset, "id");
  if (id && id.trim().length > 0) return `<fieldset id="${id}">`;
  const name = getHtmlAttribute(fieldset, "name");
  if (name && name.trim().length > 0) return `<fieldset name="${name}">`;
  return "<fieldset>";
}

// ---------------------------------------------------------------------------
// JSX
// ---------------------------------------------------------------------------

function checkJsx(module: TsxModule, emit: Emit): void {
  for (const fieldset of findJsxElementsByTag(module, "fieldset")) {
    if (hasJsxAriaName(fieldset)) continue;
    const reason = diagnoseJsxLegend(fieldset);
    if (reason === null) continue;
    const subject = describeJsxFieldset(fieldset);
    if (fieldset.hasSpreadProps) {
      emit(buildPrimitiveViolation(fieldset.loc.start, subject));
      continue;
    }
    emit(buildViolation(reason, fieldset.loc.start, subject));
  }
}

function hasJsxAriaName(fieldset: JsxElement): boolean {
  const ariaLabel = getJsxAttributeString(fieldset, "aria-label");
  if (ariaLabel !== null && ariaLabel.trim().length > 0) return true;
  if (hasJsxAttribute(fieldset, "aria-labelledby")) return true;
  // Runtime expression value — can't statically verify; assume OK so we
  // don't spam false positives on dynamic labels.
  const ariaAttr = getJsxAttribute(fieldset, "aria-label");
  if (ariaAttr?.value?.kind === "Expression") return true;
  return false;
}

function diagnoseJsxLegend(fieldset: JsxElement): Reason | null {
  let sawEmptyLegend = false;
  for (const child of fieldset.children) {
    if (child.kind !== "JsxElement") continue;
    if (child.tagName !== "legend") continue;
    if (jsxTextContent(child).length > 0) return null;
    // JSX expression children (e.g., <legend>{title}</legend>) can't be
    // statically resolved; trust them and treat as non-empty.
    if (hasJsxExpressionChild(child)) return null;
    sawEmptyLegend = true;
  }
  return sawEmptyLegend ? "empty" : "missing";
}

function hasJsxExpressionChild(element: JsxElement): boolean {
  for (const child of element.children) {
    if (child.kind === "JsxExpression") return true;
  }
  return false;
}

function describeJsxFieldset(fieldset: JsxElement): string {
  const id = getJsxAttributeString(fieldset, "id");
  if (id && id.trim().length > 0) return `<fieldset id="${id}">`;
  const name = getJsxAttributeString(fieldset, "name");
  if (name && name.trim().length > 0) return `<fieldset name="${name}">`;
  return "<fieldset>";
}

// ---------------------------------------------------------------------------
// Violation builders
// ---------------------------------------------------------------------------

function buildViolation(
  reason: Reason,
  loc: { line: number; column: number },
  subject: string,
): {
  severity: "error";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
} {
  return {
    severity: "error",
    location: { filePath: "", line: loc.line, column: loc.column },
    message: buildMessage(reason, subject),
    suggestion: buildSuggestion(reason, subject),
  };
}

function buildPrimitiveViolation(
  loc: { line: number; column: number },
  subject: string,
): {
  severity: "info";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
} {
  return {
    severity: "info",
    location: { filePath: "", line: loc.line, column: loc.column },
    message: `${subject} has no <legend> child but receives {...spread} props — this looks like a component primitive. Whether a <legend> is rendered depends on what the caller passes. Verify at usage sites.`,
    suggestion: `If the primitive is always consumed with a <legend> child (or an aria-label on the wrapping component), this is fine — add \`{/* ra11y-disable forms/fieldset-legend */}\` at the top of the file to silence this info note. Otherwise ensure every call site provides a legend or aria-label.`,
  };
}

function buildMessage(reason: Reason, subject: string): string {
  if (reason === "empty") {
    return `${subject} has an empty <legend> — screen readers will announce "group" with no name for the controls inside.`;
  }
  return `${subject} has no <legend> child — screen readers will announce "group" with no name for the controls inside.`;
}

function buildSuggestion(reason: Reason, subject: string): string {
  const base = subject.startsWith("<fieldset ") ? subject : "<fieldset>";
  if (reason === "empty") {
    return `Put descriptive text inside the <legend>, e.g. ${base}\\n  <legend>Shipping speed</legend>\\n  …\\n</fieldset>. If the group's name is already provided visually elsewhere, use aria-labelledby="<that-element-id>" on the fieldset instead.`;
  }
  return `Add a <legend> as the first child of the fieldset: ${base}\\n  <legend>Shipping speed</legend>\\n  …\\n</fieldset>. If a visible heading already labels the group, use aria-labelledby="<heading-id>" on the fieldset; if there is no visible label, use aria-label="Shipping speed".`;
}
