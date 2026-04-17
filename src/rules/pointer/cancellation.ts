/**
 * Rule: pointer/cancellation
 * Satisfies: wcag22:2.5.2, wcag21:2.5.2
 * Spec: https://www.w3.org/TR/WCAG22/#pointer-cancellation
 *
 * > For functionality that can be operated using a single pointer, at
 * > least one of the following is true: No Down-Event, Abort or Undo,
 * > Up Reversal, Essential.
 *
 * Source: https://www.w3.org/TR/WCAG22/#pointer-cancellation
 *
 * Flags HTML/JSX elements that have `onmousedown` or `ontouchstart`
 * (React: `onMouseDown`, `onTouchStart`) without also having a
 * corresponding up-event handler (`onclick`, `onmouseup`, `ontouchend`
 * / React: `onClick`, `onMouseUp`, `onTouchEnd`). The down-event-only
 * pattern means users can't abort an action by moving the pointer away
 * before release.
 *
 * Severity: warning — we can't statically distinguish essential actions
 * (e.g., drawing, gaming) from accidental down-only handlers.
 *
 * v0.0.x covers JSX (React) and HTML inline handlers.
 */

import { defineRule } from "../../api/plugin.ts";
import {
  hasHtmlAttribute,
  hasJsxAttribute,
  walkHtmlElements,
  walkJsxElements,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, HtmlElement, JsxElement, TsxModule } from "../../types/ast.ts";

/** Down-event attributes that trigger on press (HTML, lowercase). */
const HTML_DOWN_EVENTS: readonly string[] = ["onmousedown", "ontouchstart"];

/** Up/click attributes that allow abort (HTML, lowercase). */
const HTML_UP_EVENTS: readonly string[] = ["onclick", "onmouseup", "ontouchend"];

/** Down-event attributes in React/JSX (camelCase). */
const JSX_DOWN_EVENTS: readonly string[] = ["onMouseDown", "onTouchStart"];

/** Up/click attributes in React/JSX (camelCase). */
const JSX_UP_EVENTS: readonly string[] = ["onClick", "onMouseUp", "onTouchEnd"];

export const rule = defineRule({
  id: "pointer/cancellation",
  satisfies: ["wcag22:2.5.2", "wcag21:2.5.2"],
  severity: "warning",
  scope: "node",
  fixClass: "verify-in-source",
  appliesTo: {
    fileExtensions: [".html", ".htm", ".tsx", ".jsx"],
  },
  docs: {
    description:
      "Elements with pointer down-event handlers (onMouseDown, onTouchStart) must also have an up-event or click handler so users can abort by moving the pointer away.",
    rationale:
      "When functionality fires on pointer-down only, users with motor impairments can't cancel an accidental activation by sliding their finger or pointer off the target before releasing. The up-event or click pattern gives them an escape hatch.",
    goodExample: `<button onMouseDown={highlight} onClick={activate}>Go</button>`,
    badExample: `<div onMouseDown={activate}>Go</div>`,
    normativeQuote:
      "For functionality that can be operated using a single pointer, at least one of the following is true: No Down-Event, Abort or Undo, Up Reversal, Essential.",
    references: [
      "https://www.w3.org/TR/WCAG22/#pointer-cancellation",
      "https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html",
    ],
  },
  check(ctx) {
    if (ctx.language === "html") {
      checkHtml(ctx.ast as HtmlDocument, (v) => ctx.emit(v));
    } else if (ctx.language === "tsx" || ctx.language === "jsx") {
      checkJsx(ctx.ast as TsxModule, (v) => ctx.emit(v));
    }
  },
});

type Emit = (v: {
  severity: "warning";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
}) => void;

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function checkHtml(doc: HtmlDocument, emit: Emit): void {
  for (const el of walkHtmlElements(doc)) {
    checkOneHtmlElement(el, emit);
  }
}

function checkOneHtmlElement(el: HtmlElement, emit: Emit): void {
  const downEvents = HTML_DOWN_EVENTS.filter((attr) => hasHtmlAttribute(el, attr));
  if (downEvents.length === 0) return;
  const hasUp = HTML_UP_EVENTS.some((attr) => hasHtmlAttribute(el, attr));
  if (hasUp) return;

  const downList = downEvents.join(", ");
  emit({
    severity: "warning",
    location: { filePath: "", line: el.loc.start.line, column: el.loc.start.column },
    message: `<${el.tagName}> has ${downList} without a corresponding up-event handler — users can't abort accidental activation.`,
    suggestion: buildHtmlSuggestion(el.tagName, downEvents),
  });
}

// ---------------------------------------------------------------------------
// JSX
// ---------------------------------------------------------------------------

function checkJsx(module: TsxModule, emit: Emit): void {
  for (const el of walkJsxElements(module)) {
    checkOneJsxElement(el, emit);
  }
}

function checkOneJsxElement(el: JsxElement, emit: Emit): void {
  const downEvents = JSX_DOWN_EVENTS.filter((attr) => hasJsxAttribute(el, attr));
  if (downEvents.length === 0) return;
  const hasUp = JSX_UP_EVENTS.some((attr) => hasJsxAttribute(el, attr));
  if (hasUp) return;

  const downList = downEvents.join(", ");
  emit({
    severity: "warning",
    location: { filePath: "", line: el.loc.start.line, column: el.loc.start.column },
    message: `<${el.tagName}> has ${downList} without a corresponding up-event handler — users can't abort accidental activation.`,
    suggestion: buildJsxSuggestion(el.tagName, downEvents),
  });
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

function buildHtmlSuggestion(tagName: string, downEvents: readonly string[]): string {
  const upMap: Record<string, string> = {
    onmousedown: "onmouseup or onclick",
    ontouchstart: "ontouchend",
  };
  const fixes = downEvents.map((d) => `add ${upMap[d] ?? "onclick"} alongside ${d}`);
  return `On <${tagName}>, ${fixes.join("; ")}. Move the primary action to the up-event so users can abort by moving the pointer away before releasing.`;
}

function buildJsxSuggestion(tagName: string, downEvents: readonly string[]): string {
  const upMap: Record<string, string> = {
    onMouseDown: "onMouseUp or onClick",
    onTouchStart: "onTouchEnd",
  };
  const fixes = downEvents.map((d) => `add ${upMap[d] ?? "onClick"} alongside ${d}`);
  return `On <${tagName}>, ${fixes.join("; ")}. Move the primary action to the up-event so users can abort by moving the pointer away before releasing.`;
}
