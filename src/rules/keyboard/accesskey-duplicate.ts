/**
 * Rule: keyboard/accesskey-duplicate
 * Satisfies: wcag22:2.1.1, wcag21:2.1.1
 * Spec: https://www.w3.org/TR/WCAG22/#keyboard
 *
 * > All functionality of the content is operable through a keyboard
 * > interface without requiring specific timings for individual
 * > keystrokes.
 *
 * Source: https://www.w3.org/TR/WCAG22/#keyboard
 *
 * Flags multiple elements in the same document that share an
 * `accesskey` binding. Access keys are browser-level keyboard
 * shortcuts — e.g., Alt+M focuses the element with `accesskey="m"`.
 * When two elements claim the same key, browser behavior is
 * undefined: users can only reach one of them, and which one wins
 * varies between engines.
 *
 * While WCAG 2.1.4 (Character Key Shortcuts) is the more directly
 * "shortcut-shaped" criterion, it only addresses disabling or
 * remapping single-character shortcuts. Colliding accesskeys are a
 * straight 2.1.1 keyboard-operability failure: a keyboard user
 * literally cannot operate functionality that's been shadowed.
 *
 * Two subtleties handled here:
 *   1. Comparison is case-insensitive. `accesskey="M"` and
 *      `accesskey="m"` both bind to Alt+M in every major browser.
 *   2. HTML's accesskey attribute accepts a space-separated list of
 *      fallback characters (the UA picks the first one that doesn't
 *      collide with a system shortcut). Each token is a distinct
 *      binding, so `accesskey="s a"` declares two bindings (`s` and
 *      `a`), both of which must be checked against the running set.
 *
 * Document-scoped: needs to see every accesskey in the file before
 * it can decide anything.
 */

import { defineRule } from "../../api/plugin.ts";
import {
  getHtmlAttribute,
  getJsxAttributeString,
  walkHtmlElements,
  walkJsxElements,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, JsxElement, TsxModule } from "../../types/ast.ts";

export const rule = defineRule({
  id: "keyboard/accesskey-duplicate",
  satisfies: ["wcag22:2.1.1", "wcag21:2.1.1", "wcag22:2.1.4", "wcag21:2.1.4"],
  severity: "error",
  scope: "document",
  fixClass: "mechanical",
  appliesTo: {
    fileExtensions: [".html", ".htm", ".tsx", ".jsx"],
  },
  docs: {
    description:
      "Access keys must be unique within a document. Two elements sharing the same accesskey leave browser behavior undefined and make one of them unreachable by keyboard.",
    rationale:
      "Access keys bind browser-level keyboard shortcuts (e.g., Alt+S) directly to a single element. When multiple elements claim the same key, the browser can only route the shortcut to one of them — the other becomes unreachable via that shortcut. Comparison is case-insensitive because Alt+S and Alt+Shift+S resolve to the same binding across major engines, and HTML's accesskey attribute accepts a space-separated list of fallback characters, each of which creates its own binding.",
    goodExample: `<button accesskey="s">Save (Alt+S)</button>\n<button accesskey="c">Cancel (Alt+C)</button>`,
    badExample: `<button accesskey="s">Save</button>\n<button accesskey="S">Send</button>`,
    normativeQuote:
      "All functionality of the content is operable through a keyboard interface without requiring specific timings for individual keystrokes.",
    references: [
      "https://www.w3.org/TR/WCAG22/#keyboard",
      "https://html.spec.whatwg.org/multipage/interaction.html#the-accesskey-attribute",
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

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface Binding {
  readonly tagName: string;
  readonly line: number;
  readonly column: number;
}

type Emit = (v: {
  severity: "error" | "warning" | "info";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
}) => void;

/** Splits an accesskey attribute value into lowercase tokens. Empty list means "no bindings". */
function parseAccesskeyTokens(raw: string | null): readonly string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const token of raw.split(/\s+/)) {
    if (token.length === 0) continue;
    out.push(token.toLowerCase());
  }
  return out;
}

function formatMessage(tagName: string, token: string, first: Binding): string {
  return `Duplicate accesskey="${token}" on <${tagName}> — already bound by <${first.tagName}> on line ${first.line}. Only one element can receive Alt+${token.toUpperCase()}.`;
}

function formatSuggestion(token: string, first: Binding): string {
  return `Pick a different accesskey for this element, or remove the attribute entirely. The earlier binding is on <${first.tagName}> at line ${first.line}, column ${first.column} — either that one or this one will be unreachable via Alt+${token.toUpperCase()} depending on the browser. Access-key comparison is case-insensitive, so "${token}" and "${token.toUpperCase()}" collide.`;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function checkHtml(doc: HtmlDocument, emit: Emit): void {
  const seen = new Map<string, Binding>();
  for (const element of walkHtmlElements(doc)) {
    const raw = getHtmlAttribute(element, "accesskey");
    const tokens = parseAccesskeyTokens(raw);
    if (tokens.length === 0) continue;
    const position: Binding = {
      tagName: element.tagName,
      line: element.loc.start.line,
      column: element.loc.start.column,
    };
    reportTokens(tokens, position, seen, emit);
  }
}

// ---------------------------------------------------------------------------
// JSX
// ---------------------------------------------------------------------------

function checkJsx(module: TsxModule, emit: Emit): void {
  const seen = new Map<string, Binding>();
  for (const element of walkJsxElements(module)) {
    const token = jsxAccesskeyAttribute(element);
    const tokens = parseAccesskeyTokens(token);
    if (tokens.length === 0) continue;
    const position: Binding = {
      tagName: element.tagName,
      line: element.loc.start.line,
      column: element.loc.start.column,
    };
    reportTokens(tokens, position, seen, emit);
  }
}

/**
 * JSX spells the attribute `accessKey` (React-style camelCase) but the raw
 * attribute name after the lexer may retain either casing. Try both.
 */
function jsxAccesskeyAttribute(element: JsxElement): string | null {
  const camel = getJsxAttributeString(element, "accessKey");
  if (camel !== null) return camel;
  return getJsxAttributeString(element, "accesskey");
}

// ---------------------------------------------------------------------------
// Emission loop (shared)
// ---------------------------------------------------------------------------

function reportTokens(
  tokens: readonly string[],
  position: Binding,
  seen: Map<string, Binding>,
  emit: Emit,
): void {
  for (const token of tokens) {
    const first = seen.get(token);
    if (!first) {
      seen.set(token, position);
      continue;
    }
    emit({
      severity: "error",
      location: { filePath: "", line: position.line, column: position.column },
      message: formatMessage(position.tagName, token, first),
      suggestion: formatSuggestion(token, first),
    });
  }
}
