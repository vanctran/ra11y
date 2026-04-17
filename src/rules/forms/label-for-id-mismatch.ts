/**
 * Rule: forms/label-for-id-mismatch
 * Satisfies: wcag22:1.3.1, wcag21:1.3.1, wcag22:3.3.2, wcag21:3.3.2, wcag22:4.1.2, wcag21:4.1.2
 * Spec: https://www.w3.org/TR/WCAG22/#labels-or-instructions
 *
 * > Labels or instructions are provided when content requires user input.
 *
 * Source: https://www.w3.org/TR/WCAG22/#labels-or-instructions
 *
 * Flags `<label for="X">` whose `X` does not resolve to any element
 * with `id="X"` in the same document. A dangling label-for reference
 * means the label is not programmatically associated with any control:
 *
 *   - Screen readers will not announce the label when the user tabs
 *     to the control ("label for 'email' — email input field").
 *   - Click-to-focus on the label does not focus the control, so
 *     sighted motor-impaired users lose the expanded hit target.
 *   - Voice-control users who say "click Email" cannot reach the
 *     control through its label.
 *
 * Implementation notes:
 *
 *   1. The rule is document-scoped (`afterFile`). Both the label and
 *      the target must live in the same file for the check to be
 *      meaningful — cross-file references via id are impossible to
 *      validate statically.
 *
 *   2. HTML id lookup is compared **case-sensitively**. The HTML
 *      spec defines ids as ASCII case-sensitive, and CSS/DOM APIs
 *      match that (`document.getElementById` is case-sensitive,
 *      `#foo` selectors are case-sensitive in standards mode).
 *      Browsers in legacy quirks mode historically matched ids
 *      case-insensitively, but we intentionally follow the spec so
 *      that authored content is portable across modes and engines.
 *
 *   3. If a label both sets a (broken) `for` AND wraps a control
 *      descendant (the "implicit association" form), the implicit
 *      wrapping wins at runtime — but we still flag the broken
 *      `for`, because it is dead code that will bite the next person
 *      who refactors the markup.
 *
 *   4. JSX uses `htmlFor` (React's rename of `for`). The check
 *      accepts both spellings so rules work uniformly across
 *      Babel/SWC/TSC output shapes.
 *
 *   5. A label with no `for` at all is a different rule's problem
 *      (forms/labels-required covers unlabeled controls). We only
 *      fire when `for` is present, non-empty, and points nowhere.
 */

import { defineRule } from "../../api/plugin.ts";
import {
  findHtmlElementsByTag,
  findJsxElementsByTag,
  getHtmlAttribute,
  getJsxAttributeString,
  walkHtmlElements,
  walkJsxElements,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, HtmlElement, JsxElement, TsxModule } from "../../types/ast.ts";

export const rule = defineRule({
  id: "forms/label-for-id-mismatch",
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
  fixClass: "mechanical",
  appliesTo: {
    fileExtensions: [".html", ".htm", ".tsx", ".jsx"],
  },
  docs: {
    description:
      "A <label for='X'> must point to an element with id='X' in the same document. A dangling reference breaks screen-reader announcements and label-click-to-focus behavior.",
    rationale:
      "When a label's `for` attribute does not match any element's `id`, the label is not programmatically associated with any control. Screen readers will not pair the label text with the control, clicking the label will not focus the control, and voice-control users cannot reach the control by speaking its label. Because id lookup is case-sensitive per the HTML spec, a typo like for='emai' vs id='email' silently breaks the association at runtime with no visible indication.",
    goodExample: `<label for="email">Email address</label>\n<input id="email" type="email">`,
    badExample: `<label for="emai">Email address</label>\n<input id="email" type="email">`,
    normativeQuote: "Labels or instructions are provided when content requires user input.",
    references: [
      "https://www.w3.org/TR/WCAG22/#labels-or-instructions",
      "https://www.w3.org/TR/WCAG22/#info-and-relationships",
      "https://www.w3.org/TR/WCAG22/#name-role-value",
      "https://html.spec.whatwg.org/multipage/forms.html#the-label-element",
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
// HTML
// ---------------------------------------------------------------------------

function checkHtml(doc: HtmlDocument, emit: Emit): void {
  const ids = collectHtmlIds(doc);
  for (const label of findHtmlElementsByTag(doc, "label")) {
    const target = getHtmlAttribute(label, "for");
    if (target === null || target.length === 0) continue;
    if (ids.has(target)) continue;
    emit({
      severity: "error",
      location: {
        filePath: "",
        line: label.loc.start.line,
        column: label.loc.start.column,
      },
      message: buildMessage(target),
      suggestion: buildSuggestion(target, ids, htmlLabelWrapsControl(label)),
    });
  }
}

function collectHtmlIds(doc: HtmlDocument): Set<string> {
  const ids = new Set<string>();
  for (const el of walkHtmlElements(doc)) {
    const id = getHtmlAttribute(el, "id");
    if (id !== null && id.length > 0) ids.add(id);
  }
  return ids;
}

function htmlLabelWrapsControl(label: HtmlElement): boolean {
  for (const descendant of walkHtmlElements(label)) {
    const tag = descendant.tagName.toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea") return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// JSX
// ---------------------------------------------------------------------------

function checkJsx(module: TsxModule, emit: Emit): void {
  const ids = collectJsxIds(module);
  for (const label of findJsxElementsByTag(module, "label")) {
    const target = getJsxLabelFor(label);
    if (target === null || target.length === 0) continue;
    if (ids.has(target)) continue;
    emit({
      severity: "error",
      location: {
        filePath: "",
        line: label.loc.start.line,
        column: label.loc.start.column,
      },
      message: buildMessage(target),
      suggestion: buildSuggestion(target, ids, jsxLabelWrapsControl(label)),
    });
  }
}

/** React uses `htmlFor`; authors sometimes still write `for`. Accept both. */
function getJsxLabelFor(label: JsxElement): string | null {
  return getJsxAttributeString(label, "htmlFor") ?? getJsxAttributeString(label, "for");
}

function collectJsxIds(module: TsxModule): Set<string> {
  const ids = new Set<string>();
  for (const el of walkJsxElements(module)) {
    const id = getJsxAttributeString(el, "id");
    if (id !== null && id.length > 0) ids.add(id);
  }
  return ids;
}

function jsxLabelWrapsControl(label: JsxElement): boolean {
  for (const descendant of walkJsxDescendants(label)) {
    const tag = descendant.tagName.toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea") return true;
  }
  return false;
}

function* walkJsxDescendants(element: JsxElement): Iterable<JsxElement> {
  for (const child of element.children) {
    if (child.kind === "JsxElement") {
      yield child;
      yield* walkJsxDescendants(child);
    }
  }
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function buildMessage(target: string): string {
  return `<label for="${target}"> does not match any element's id in this document — the label is not associated with any control.`;
}

function buildSuggestion(target: string, ids: ReadonlySet<string>, wrapsControl: boolean): string {
  const nearest = findNearestId(target, ids);
  const base = nearest
    ? `Did you mean id="${nearest}"? Either change the label to <label for="${nearest}"> or rename the control's id to "${target}".`
    : `Add id="${target}" to the control this label describes, or change the for attribute to an id that already exists.`;
  if (wrapsControl) {
    return `${base} Note: this label also wraps a form control, so implicit association will still work at runtime — but the dangling for="${target}" is dead code and will mislead future refactors.`;
  }
  return base;
}

/**
 * Returns the existing id whose string is closest to `target` by
 * Levenshtein distance, provided the distance is ≤2 (typical typo
 * range). Returns null if no id is within distance. Comparing only
 * against already-collected ids keeps this cheap.
 */
function findNearestId(target: string, ids: ReadonlySet<string>): string | null {
  let best: string | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const id of ids) {
    const d = levenshtein(target, id);
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  const MAX_TYPO_DISTANCE = 2;
  return bestDist <= MAX_TYPO_DISTANCE ? best : null;
}

/** Standard Levenshtein edit distance. O(n*m) space and time. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const del = (prev[j] ?? 0) + 1;
      const ins = (curr[j - 1] ?? 0) + 1;
      const sub = (prev[j - 1] ?? 0) + cost;
      curr[j] = Math.min(del, ins, sub);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[n] ?? 0;
}
