/**
 * Rule: forms/labels-required
 * Satisfies: wcag22:3.3.2, wcag21:3.3.2
 * Spec: https://www.w3.org/TR/WCAG22/#labels-or-instructions
 *
 * > Labels or instructions are provided when content requires user input.
 *
 * Source: https://www.w3.org/TR/WCAG22/#labels-or-instructions
 *
 * This rule flags form controls without an accessible name. A form
 * control is considered labeled when any of the following are true:
 *   1. It has a non-empty `aria-label` attribute
 *   2. It has an `aria-labelledby` referencing another element
 *   3. Its `id` is referenced by a `<label for="…">` somewhere in
 *      the same document
 *   4. It's wrapped inside a `<label>` element (implicit label)
 *   5. It's `type="hidden"`, `type="submit"`, `type="reset"`, or
 *      `type="button"` — these have intrinsic or author-specified
 *      accessible names (value attribute)
 *
 * Covers: <input> (except hidden/submit/reset/button types),
 * <select>, <textarea>. Does NOT cover custom widgets built with
 * div/span + ARIA — those are covered by aria/name-role-value.
 */

import { defineRule } from "../../api/plugin.ts";
import {
  findHtmlElementsByTag,
  getHtmlAttribute,
  getJsxAttribute,
  getJsxAttributeString,
  hasHtmlAttribute,
  hasJsxAttribute,
  walkHtmlElements,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, HtmlElement, JsxElement, TsxModule } from "../../types/ast.ts";

const LABELABLE_TAGS: ReadonlySet<string> = new Set(["input", "select", "textarea"]);

const IMPLICIT_SUBMIT_TYPES: ReadonlySet<string> = new Set([
  "hidden",
  "submit",
  "reset",
  "button",
  "image",
]);

export const rule = defineRule({
  id: "forms/labels-required",
  satisfies: [
    "wcag22:1.3.1",
    "wcag21:1.3.1",
    "wcag22:3.3.2",
    "wcag21:3.3.2",
    "wcag22:4.1.2",
    "wcag21:4.1.2",
  ],
  severity: "error",
  scope: "document",
  fixClass: "verify-in-source",
  appliesTo: {
    fileExtensions: [".html", ".htm", ".tsx", ".jsx"],
  },
  docs: {
    description:
      "Form controls must have an accessible name — a <label>, aria-label, or aria-labelledby.",
    rationale:
      "Screen readers announce a form control's accessible name when the user tabs to it. Without a label, users hear 'edit' or 'combobox' and have no way to know what to type. A missing label is also a sighted-user problem: inputs without visible labels rely on placeholder text that disappears when the user starts typing.",
    goodExample: `<label for="email">Email</label>\n<input id="email" type="email">`,
    badExample: `<input type="email" placeholder="Email">`,
    normativeQuote: "Labels or instructions are provided when content requires user input.",
    references: [
      "https://www.w3.org/TR/WCAG22/#labels-or-instructions",
      "https://www.w3.org/WAI/WCAG22/Techniques/general/G131",
    ],
  },
  afterFile(ctx) {
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

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function checkHtml(doc: HtmlDocument, emit: Emit): void {
  const labelFors = collectLabelFors(doc);
  const implicitLabelIds = collectImplicitlyLabeledIds(doc);

  for (const tag of LABELABLE_TAGS) {
    for (const el of findHtmlElementsByTag(doc, tag)) {
      if (isExcludedHtmlControl(el)) continue;
      if (htmlHasLabel(el, labelFors, implicitLabelIds)) continue;
      emit({
        severity: "error",
        location: {
          filePath: "",
          line: el.loc.start.line,
          column: el.loc.start.column,
        },
        message: buildMessage(el.tagName, getHtmlAttribute(el, "type")),
        suggestion: buildSuggestion(
          el.tagName,
          getHtmlAttribute(el, "type"),
          getHtmlAttribute(el, "id"),
        ),
      });
    }
  }
}

function collectLabelFors(doc: HtmlDocument): Set<string> {
  const fors = new Set<string>();
  for (const label of findHtmlElementsByTag(doc, "label")) {
    const forAttr = getHtmlAttribute(label, "for");
    if (forAttr && forAttr.length > 0) fors.add(forAttr);
  }
  return fors;
}

function collectImplicitlyLabeledIds(doc: HtmlDocument): Set<string> {
  const ids = new Set<string>();
  for (const label of findHtmlElementsByTag(doc, "label")) {
    for (const descendant of walkHtmlElements(label)) {
      if (!LABELABLE_TAGS.has(descendant.tagName.toLowerCase())) continue;
      const id = getHtmlAttribute(descendant, "id");
      if (id) ids.add(id);
      // Wrapped control without an id still counts — use a placeholder
      // marker via the element's range so we can check identity later.
      ids.add(`__range:${descendant.range.start}`);
    }
  }
  return ids;
}

function isExcludedHtmlControl(el: HtmlElement): boolean {
  if (el.tagName.toLowerCase() !== "input") return false;
  const type = getHtmlAttribute(el, "type")?.toLowerCase();
  if (!type) return false;
  return IMPLICIT_SUBMIT_TYPES.has(type);
}

function htmlHasLabel(
  el: HtmlElement,
  labelFors: ReadonlySet<string>,
  implicitIds: ReadonlySet<string>,
): boolean {
  const ariaLabel = getHtmlAttribute(el, "aria-label");
  if (ariaLabel && ariaLabel.trim().length > 0) return true;
  if (hasHtmlAttribute(el, "aria-labelledby")) return true;
  if (hasHtmlAttribute(el, "title")) {
    const title = getHtmlAttribute(el, "title");
    if (title && title.trim().length > 0) return true;
  }
  const id = getHtmlAttribute(el, "id");
  if (id && labelFors.has(id)) return true;
  if (implicitIds.has(`__range:${el.range.start}`)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// JSX
// ---------------------------------------------------------------------------

function checkJsx(module: TsxModule, emit: Emit): void {
  // JSX label/control association: htmlFor attribute on <label> must
  // match id attribute on the control. We collect the htmlFor set
  // first, then check each control. Implicit labeling (control nested
  // inside label) handled by JSX element children structure.
  const labelHtmlFors = collectJsxLabelHtmlFors(module);
  const implicitlyLabeledElementIds = collectJsxImplicitlyLabeledControls(module);

  for (const tag of LABELABLE_TAGS) {
    for (const el of findJsxElementsByTag(module, tag)) {
      if (isExcludedJsxControl(el)) continue;
      if (jsxHasLabel(el, labelHtmlFors, implicitlyLabeledElementIds)) continue;
      emit(buildJsxViolation(el));
    }
  }
}

function buildJsxViolation(el: JsxElement) {
  const type = getJsxAttributeString(el, "type");
  const id = getJsxAttributeString(el, "id");
  const location = { filePath: "", line: el.loc.start.line, column: el.loc.start.column };
  if (el.hasSpreadProps) {
    return {
      severity: "info" as const,
      location,
      message: `<${el.tagName}${type ? ` type="${type}"` : ""}> has no static accessible name but receives {...spread} props — this looks like a component primitive (Input/Textarea wrapper). Whether the control is labeled at render time depends on what the caller passes (aria-label, id matched by an external <label>, etc.). Verify at usage sites.`,
      suggestion: `If the primitive is only consumed by callers that pass a label or aria-label, this is fine — add \`{/* ra11y-disable forms/labels-required */}\` at the top of the file to silence this info note. Otherwise require callers to pass a label via props.`,
    };
  }
  return {
    severity: "error" as const,
    location,
    message: buildMessage(el.tagName, type),
    suggestion: buildSuggestion(el.tagName, type, id),
  };
}

function collectJsxLabelHtmlFors(module: TsxModule): ReadonlySet<string> {
  const fors = new Set<string>();
  for (const label of findJsxElementsByTag(module, "label")) {
    const htmlFor = getJsxAttributeString(label, "htmlFor") ?? getJsxAttributeString(label, "for");
    if (htmlFor && htmlFor.length > 0) {
      fors.add(htmlFor);
      continue;
    }
    // Expression-valued htmlFor like htmlFor={selectId} — we can't resolve
    // the value but we know a label intends to reference a control. Add a
    // sentinel so jsxHasLabel can detect that expression-valued labels exist.
    const htmlForAttr = getJsxAttribute(label, "htmlFor") ?? getJsxAttribute(label, "for");
    if (htmlForAttr?.value?.kind === "Expression") fors.add("__expr__");
  }
  return fors;
}

function collectJsxImplicitlyLabeledControls(module: TsxModule): Set<number> {
  const ranges = new Set<number>();
  for (const label of findJsxElementsByTag(module, "label")) {
    for (const descendant of walkJsxDescendants(label)) {
      if (!LABELABLE_TAGS.has(descendant.tagName.toLowerCase())) continue;
      ranges.add(descendant.range.start);
    }
  }
  return ranges;
}

function* walkJsxDescendants(element: JsxElement): Iterable<JsxElement> {
  for (const child of element.children) {
    if (child.kind === "JsxElement") {
      yield child;
      yield* walkJsxDescendants(child);
    }
  }
}

// Re-implementations scoped to this file so the module doesn't have
// a lint dependency on ast-helpers for findJsxElementsByTag (already
// imported) — but we need walkJsxDescendants because the helper is
// not exported. Keeping these inline is cleaner than plumbing new
// helpers for a single rule.
import { findJsxElementsByTag } from "../../engine/ast-helpers.ts";

function isExcludedJsxControl(el: JsxElement): boolean {
  if (el.tagName.toLowerCase() !== "input") return false;
  const type = getJsxAttributeString(el, "type")?.toLowerCase();
  if (!type) return false;
  return IMPLICIT_SUBMIT_TYPES.has(type);
}

function jsxHasLabel(
  el: JsxElement,
  labelHtmlFors: ReadonlySet<string>,
  implicitIds: ReadonlySet<number>,
): boolean {
  const ariaLabel = getJsxAttributeString(el, "aria-label");
  if (ariaLabel && ariaLabel.trim().length > 0) return true;
  // Expression-valued aria-label like aria-label={t('slider')} — trust the
  // developer is computing a name at runtime. Same tradeoff as alt-text-missing.
  const ariaLabelAttr = getJsxAttribute(el, "aria-label");
  if (ariaLabelAttr?.value?.kind === "Expression") return true;
  if (hasJsxAttribute(el, "aria-labelledby")) return true;
  if (hasJsxAttribute(el, "title")) {
    const title = getJsxAttributeString(el, "title");
    if (title && title.trim().length > 0) return true;
  }
  const id = getJsxAttributeString(el, "id");
  if (id && labelHtmlFors.has(id)) return true;
  // Expression-valued id like id={selectId} paired with a label that has
  // expression-valued htmlFor — we can't verify the match statically
  // but the developer clearly intended the association. Trust it.
  const idAttr = getJsxAttribute(el, "id");
  if (idAttr?.value?.kind === "Expression" && labelHtmlFors.has("__expr__")) return true;
  if (implicitIds.has(el.range.start)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function buildMessage(tagName: string, type: string | null): string {
  const descriptor = type ? `<${tagName} type="${type}">` : `<${tagName}>`;
  return `${descriptor} has no accessible name — screen readers will announce it with no context.`;
}

function buildSuggestion(tagName: string, type: string | null, id: string | null): string {
  const idHint = id ?? "field";
  const labelText = inferLabelFromType(type);
  return `Add a \`<label for="${idHint}">${labelText}</label>\` referencing this ${tagName}'s id, or set an \`aria-label="${labelText}"\` attribute. If the control is decorative or duplicates a visible label, use \`aria-labelledby\` pointing at that element's id.`;
}

function inferLabelFromType(type: string | null): string {
  if (!type) return "Label";
  const map: Readonly<Record<string, string>> = {
    email: "Email",
    password: "Password",
    search: "Search",
    tel: "Phone",
    url: "URL",
    number: "Number",
    date: "Date",
    time: "Time",
    file: "Upload",
    checkbox: "Option",
    radio: "Choice",
  };
  return map[type.toLowerCase()] ?? "Label";
}
