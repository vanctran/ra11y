/**
 * Rule: forms/non-empty-label
 * Satisfies: wcag22:2.4.6, wcag21:2.4.6, wcag22:1.3.1, wcag21:1.3.1
 * Spec: https://www.w3.org/TR/WCAG22/#headings-and-labels
 *
 * > Headings and labels describe topic or purpose.
 *
 * Flags `<label>` elements that exist in the markup but whose text
 * content is empty or whitespace-only. Empty labels defeat the
 * purpose — screen readers announce the control with no name, and
 * `forms/labels-required` thinks the control is labeled because a
 * `<label for="…">` points at it.
 *
 * Covers: HTML `<label>` and JSX `<label>` elements (including
 * lowercase JSX — PascalCase components like `<FormLabel>` render
 * opaque content we can't resolve at static-analysis time and stay
 * out of scope here).
 *
 * Whitespace-only content, comments-only, and a single `<br>` child
 * all count as empty. An `aria-label` attribute on the label element
 * itself does NOT rescue it — the attribute names the label, not
 * the control it labels, and browsers still announce the referenced
 * control by the (empty) label's text content.
 */

import { defineRule } from "../../api/plugin.ts";
import {
  findHtmlElementsByTag,
  findJsxElementsByTag,
  htmlTextContent,
  jsxTextContent,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, HtmlElement, JsxElement, TsxModule } from "../../types/ast.ts";

export const rule = defineRule({
  id: "forms/non-empty-label",
  satisfies: ["wcag22:2.4.6", "wcag21:2.4.6", "wcag22:1.3.1", "wcag21:1.3.1"],
  severity: "error",
  scope: "document",
  fixClass: "guidance",
  appliesTo: {
    fileExtensions: [".html", ".htm", ".tsx", ".jsx"],
  },
  docs: {
    description:
      "<label> elements must contain descriptive text. Empty labels announce controls as unnamed and defeat assistive-tech navigation.",
    rationale:
      "Screen readers announce a form control by the text of its associated <label>. An empty label means the user hears 'edit' or 'combobox' with no hint as to what to type. An empty label is often a bug — someone wrapped `<input>` in `<label>` then forgot to add the visible text, or they pushed label text into a sibling div that styles as a label but isn't one.",
    goodExample: '<label for="email">Email address</label><input id="email">',
    badExample: '<label for="email"></label><input id="email">',
    normativeQuote: "Headings and labels describe topic or purpose.",
    references: [
      "https://www.w3.org/TR/WCAG22/#headings-and-labels",
      "https://www.w3.org/WAI/WCAG22/Techniques/general/G131",
    ],
  },
  afterFile(ctx) {
    if (ctx.language === "html") {
      for (const label of findHtmlElementsByTag(ctx.ast as HtmlDocument, "label")) {
        if (isEmptyHtml(label)) ctx.emit(emitHtml(label));
      }
      return;
    }
    if (ctx.language === "tsx" || ctx.language === "jsx") {
      checkJsxLabels(ctx.ast as TsxModule, (v) => ctx.emit(v));
    }
  },
});

function checkJsxLabels(
  module: TsxModule,
  emit: (v: ReturnType<typeof emitJsx> | ReturnType<typeof emitJsxPrimitive>) => void,
): void {
  for (const label of findJsxElementsByTag(module, "label")) {
    if (!isEmptyJsx(label)) continue;
    emit(label.hasSpreadProps ? emitJsxPrimitive(label) : emitJsx(label));
  }
}

function isEmptyHtml(label: HtmlElement): boolean {
  return htmlTextContent(label).trim().length === 0;
}

function isEmptyJsx(label: JsxElement): boolean {
  return jsxTextContent(label).trim().length === 0;
}

function emitHtml(label: HtmlElement) {
  return {
    severity: "error" as const,
    location: {
      filePath: "",
      line: label.loc.start.line,
      column: label.loc.start.column,
    },
    message: "<label> is empty — add visible text that describes the control it labels.",
    suggestion:
      "Put the human-readable label text inside the <label> element. If the visible text lives in a sibling (e.g. a styled <div>), either move it inside the <label> or use aria-labelledby on the form control to point at the sibling's id.",
  };
}

function emitJsx(label: JsxElement) {
  return {
    severity: "error" as const,
    location: {
      filePath: "",
      line: label.loc.start.line,
      column: label.loc.start.column,
    },
    message: "<label> is empty — add visible text that describes the control it labels.",
    suggestion:
      'Put the human-readable label text as a child of the <label> element, e.g. <label htmlFor="email">Email</label>. If the label comes from a prop, assert it\'s non-empty at the component boundary.',
  };
}

function emitJsxPrimitive(label: JsxElement) {
  return {
    severity: "info" as const,
    location: {
      filePath: "",
      line: label.loc.start.line,
      column: label.loc.start.column,
    },
    message:
      "<label> has no visible children but receives {...spread} props — this looks like a component primitive. Whether the label is empty at render time depends on what the caller passes. Verify at usage sites.",
    suggestion:
      "If the component is only ever called with text children, this is fine — add `{/* ra11y-disable forms/non-empty-label */}` at the top of the file to silence this info note. Otherwise ensure every call site passes label text.",
  };
}
