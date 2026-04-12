/**
 * Rule: focus/tabindex-positive
 * Satisfies: wcag22:2.4.3, wcag21:2.4.3
 * Spec: https://www.w3.org/TR/WCAG22/#focus-order
 *
 * > If a Web page can be navigated sequentially and the navigation
 * > sequences affect meaning or operation, focusable components
 * > receive focus in an order that preserves meaning and operability.
 *
 * Source: https://www.w3.org/TR/WCAG22/#focus-order
 *
 * Flags any element declaring a positive `tabindex` / `tabIndex`
 * (>= 1). Positive values override the document's natural focus
 * order and create a second, parallel tab sequence that is almost
 * impossible to keep consistent with the visual/DOM order as the
 * page evolves. The universally recommended values are:
 *
 *   - `tabindex="0"` — include the element in the natural order
 *     at its DOM position (how you make a non-interactive element
 *     focusable).
 *   - `tabindex="-1"` — remove the element from sequential
 *     navigation while keeping it programmatically focusable (for
 *     `.focus()` calls and roving-tabindex patterns).
 *
 * Document-scoped: the rule walks every element once per file and
 * does not need cross-element context. Works on HTML and JSX.
 *
 * JSX expression values: the in-house TSX parser exposes
 * `value.kind === "Expression"` with a `raw` field containing the
 * literal source text of the braced expression (e.g., `{5}`, `{ 2 }`,
 * `{someVar}`). When the expression's interior, after stripping the
 * braces and whitespace, is a pure integer literal, we parse it and
 * flag it the same way as a string-literal value. When the interior
 * is anything else (variable reference, function call, template
 * literal), we skip — we can't know statically whether it resolves
 * to a positive integer, and flagging every runtime expression would
 * drown real violations in noise. This is the same tradeoff
 * eslint-plugin-jsx-a11y makes for similar rules.
 */

import { defineRule } from "../../api/plugin.ts";
import {
  getJsxAttribute,
  getJsxAttributeString,
  walkHtmlElements,
  walkJsxElements,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, HtmlElement, JsxElement, TsxModule } from "../../types/ast.ts";

/** React uses camelCase `tabIndex`; HTML uses lowercase `tabindex`. Accept both. */
const JSX_ATTR_NAMES: readonly string[] = ["tabIndex", "tabindex"];

export const rule = defineRule({
  id: "focus/tabindex-positive",
  satisfies: ["wcag22:2.4.3", "wcag21:2.4.3"],
  severity: "error",
  scope: "document",
  appliesTo: {
    fileExtensions: [".html", ".htm", ".tsx", ".jsx"],
  },
  docs: {
    description:
      'Elements must not use a positive tabindex. Only tabindex="0" (include at natural position) and tabindex="-1" (programmatic focus only) are acceptable.',
    rationale:
      "A positive tabindex creates a second, parallel tab order on top of the document's natural order. Focused elements jump across the page in the author-declared sequence before falling back to DOM order, which is deeply disorienting for keyboard and screen-reader users and impossible to keep consistent as the page changes. Every major accessibility style guide — WAI-ARIA Authoring Practices, WebAIM, MDN — treats positive tabindex as an anti-pattern.",
    goodExample: `<div tabindex="0" role="button">Focusable at document order</div>\n<div tabindex="-1">Programmatic focus only</div>`,
    badExample: `<a href="/" tabindex="5">Fifth in tab order</a>`,
    normativeQuote:
      "If a Web page can be navigated sequentially and the navigation sequences affect meaning or operation, focusable components receive focus in an order that preserves meaning and operability.",
    references: [
      "https://www.w3.org/TR/WCAG22/#focus-order",
      "https://webaim.org/techniques/keyboard/tabindex",
      "https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/tabindex",
    ],
  },
  afterFile(ctx) {
    if (ctx.language === "html") {
      checkHtml(ctx.ast as HtmlDocument, (v) => ctx.emit(v));
      return;
    }
    if (
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
// HTML branch
// ---------------------------------------------------------------------------

function checkHtml(doc: HtmlDocument, emit: Emit): void {
  for (const element of walkHtmlElements(doc)) {
    const raw = findHtmlTabindex(element);
    if (raw === null) continue;
    const parsed = parseTabindex(raw);
    if (parsed === null || parsed < 1) continue;
    emitViolation(element.tagName, parsed, raw, element.loc.start, emit);
  }
}

/** Looks up `tabindex` (case-insensitive) on an HTML element. */
function findHtmlTabindex(element: HtmlElement): string | null {
  for (const attr of element.attributes) {
    if (attr.name.toLowerCase() === "tabindex") return attr.value;
  }
  return null;
}

// ---------------------------------------------------------------------------
// JSX branch
// ---------------------------------------------------------------------------

function checkJsx(module: TsxModule, emit: Emit): void {
  for (const element of walkJsxElements(module)) {
    const parsed = readJsxTabindex(element);
    if (parsed === null) continue;
    const { value, rawText } = parsed;
    if (value < 1) continue;
    emitViolation(element.tagName, value, rawText, element.loc.start, emit);
  }
}

interface JsxTabindexRead {
  readonly value: number;
  readonly rawText: string;
}

/**
 * Reads the first `tabIndex` / `tabindex` attribute on a JSX element
 * and decodes it to a numeric value when possible. Returns `null`
 * when the attribute is absent, shorthand, or a non-numeric
 * expression (variable, function call, …) — those cases produce no
 * violation because we can't decide them statically.
 */
function readJsxTabindex(element: JsxElement): JsxTabindexRead | null {
  for (const name of JSX_ATTR_NAMES) {
    const attr = getJsxAttribute(element, name);
    if (!attr) continue;
    const stringValue = getJsxAttributeString(element, name);
    if (stringValue !== null) {
      const parsed = parseTabindex(stringValue);
      if (parsed === null) return null;
      return { value: parsed, rawText: stringValue };
    }
    if (attr.value?.kind === "Expression") {
      return readJsxExpressionTabindex(attr.value.raw);
    }
    // Shorthand `<div tabIndex />` — not a numeric value, skip.
    return null;
  }
  return null;
}

/**
 * Parses a JSX expression-attribute raw source (including the braces)
 * like `{5}`, `{ -1 }`, `{01}`, `{someVar}`. Returns a numeric value
 * only when the interior is a pure integer literal; returns `null`
 * for anything dynamic.
 */
function readJsxExpressionTabindex(raw: string): JsxTabindexRead | null {
  const stripped = stripBraces(raw).trim();
  if (stripped.length === 0) return null;
  if (!/^-?\d+$/.test(stripped)) return null;
  const value = Number.parseInt(stripped, 10);
  if (!Number.isFinite(value)) return null;
  return { value, rawText: stripped };
}

function stripBraces(raw: string): string {
  // The parser's expression `raw` field is the full `{...}` including
  // the outer braces; strip exactly one pair.
  let out = raw;
  if (out.startsWith("{")) out = out.slice(1);
  if (out.endsWith("}")) out = out.slice(0, -1);
  return out;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Parses a raw tabindex string into a number. Accepts leading/trailing
 * whitespace; rejects non-numeric content. `"01"` parses to `1`, not
 * `01`, which matches browser behavior — `Number.parseInt(s, 10)`.
 * Returns `null` when the string is empty or not a valid integer.
 */
function parseTabindex(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (!/^-?\d+$/.test(trimmed)) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) ? n : null;
}

function emitViolation(
  tagName: string,
  value: number,
  rawText: string,
  loc: { line: number; column: number },
  emit: Emit,
): void {
  emit({
    severity: "error",
    location: { filePath: "", line: loc.line, column: loc.column },
    message: `<${tagName}> has tabindex="${rawText}" (parsed as ${value}). Positive tabindex values create a parallel tab order that overrides the document's natural order and is almost impossible to keep consistent.`,
    suggestion: `Remove tabindex from <${tagName}> and let it receive focus at its natural DOM position, or use tabindex="0" if the element is non-interactive but needs to be focusable. Use tabindex="-1" only for programmatic focus (e.g., roving-tabindex patterns).`,
  });
}
