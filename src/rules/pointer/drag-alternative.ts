/**
 * Rule: pointer/drag-alternative
 * Satisfies: wcag22:2.5.7
 * Spec: https://www.w3.org/TR/WCAG22/#dragging-movements
 *
 * > All functionality that uses a dragging movement for operation can be
 * > achieved by a single pointer without dragging, unless dragging is
 * > essential or the functionality is determined by the user agent and
 * > not modified by the author.
 *
 * Source: https://www.w3.org/TR/WCAG22/#dragging-movements
 *
 * New WCAG 2.2 Level AA criterion (NOT in WCAG 2.1).
 *
 * Static-analysis scope: flag JSX/TSX or HTML elements that implement
 * drag behavior without evidence of a click/button alternative in the
 * same file. Detection patterns:
 *
 *   1. Element with `draggable="true"` attribute.
 *   2. JSX/HTML drag event handlers: `onDragStart`, `onDrag`, `onDragEnd`.
 *   3. Pointer/Mouse "down + move" combos: `onPointerDown` + `onPointerMove`,
 *      `onMouseDown` + `onMouseMove`.
 *   4. Imports of popular drag libraries (`react-dnd`, `@dnd-kit/core`,
 *      `react-beautiful-dnd`, `@hello-pangea/dnd`, `react-draggable`,
 *      `interact.js`).
 *
 * Skip (no flag) when:
 *   - The draggable element has `aria-disabled="true"` or `disabled`.
 *   - A click/button alternative is present somewhere in the file
 *     (`onClick`, `<button>`, `role="button"`, `<input type="button">`).
 *   - Element is `<input type="range">` (user-agent determined slider).
 *   - File is CSS (drag is JS-only).
 *
 * Severity is "warning" because the static heuristic has a meaningful
 * false-positive surface — a click alternative may live in a sibling
 * file, a parent component, or a custom hook the scanner can't see.
 */

import { defineRule } from "../../api/plugin.ts";
import {
  getHtmlAttribute,
  getJsxAttributeString,
  hasHtmlAttribute,
  hasJsxAttribute,
  walkHtmlElements,
  walkJsxElements,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, HtmlElement, JsxElement, TsxModule } from "../../types/ast.ts";
import type { EmittedViolation, RuleContext } from "../../types/rule.ts";

/** JSX drag-related event handler names (camelCase). */
const JSX_DRAG_HANDLERS: readonly string[] = ["onDragStart", "onDrag", "onDragEnd", "onDrop"];

/** HTML drag-related event handler names (lowercase). */
const HTML_DRAG_HANDLERS: readonly string[] = ["ondragstart", "ondrag", "ondragend", "ondrop"];

/** JSX pointer/mouse "down + move" handler pairs that imply a drag implementation. */
const JSX_DRAG_PAIRS: readonly (readonly [string, string])[] = [
  ["onPointerDown", "onPointerMove"],
  ["onMouseDown", "onMouseMove"],
  ["onTouchStart", "onTouchMove"],
];

/** HTML pointer/mouse "down + move" handler pairs (lowercase). */
const HTML_DRAG_PAIRS: readonly (readonly [string, string])[] = [
  ["onpointerdown", "onpointermove"],
  ["onmousedown", "onmousemove"],
  ["ontouchstart", "ontouchmove"],
];

/** Popular drag libraries — file-level signal that drag behaviour is being authored. */
const DRAG_LIBRARY_IMPORTS: readonly string[] = [
  "react-dnd",
  "@dnd-kit/core",
  "@dnd-kit/sortable",
  "react-beautiful-dnd",
  "@hello-pangea/dnd",
  "react-draggable",
  "interactjs",
  "interact.js",
];

/** Click/keyboard alternative attributes (JSX). */
const JSX_ALTERNATIVE_ATTRS: readonly string[] = ["onClick", "onKeyDown", "onKeyUp", "onKeyPress"];

/** Click/keyboard alternative attributes (HTML, lowercase). */
const HTML_ALTERNATIVE_ATTRS: readonly string[] = ["onclick", "onkeydown", "onkeyup", "onkeypress"];

/** Tags that natively imply an actionable single-pointer alternative. */
const ALTERNATIVE_TAGS: ReadonlySet<string> = new Set([
  "button",
  "a",
  "input",
  "select",
  "textarea",
]);

export const rule = defineRule({
  id: "pointer/drag-alternative",
  satisfies: ["wcag22:2.5.7"],
  severity: "warning",
  scope: "document",
  appliesTo: {
    fileExtensions: [".html", ".htm", ".tsx", ".jsx", ".ts", ".js"],
  },
  docs: {
    description:
      "All functionality that uses a dragging movement must also be achievable by a single pointer without dragging (e.g., a click, button, or keyboard handler).",
    rationale:
      "Dragging requires sustained motor control across two axes — difficult or impossible for users with tremors, limited dexterity, or who use head pointers, switch input, or eye-gaze. Providing a click/keyboard alternative (up/down arrow buttons next to a sortable list, a 'Move to top' menu item, etc.) makes the same functionality reachable without the drag gesture.",
    goodExample: `<li draggable="true" onDragStart={onDragStart}>
  Item 1
  <button onClick={moveUp} aria-label="Move up">↑</button>
  <button onClick={moveDown} aria-label="Move down">↓</button>
</li>`,
    badExample: `<li draggable="true" onDragStart={onDragStart}>
  Item 1
</li>`,
    normativeQuote:
      "All functionality that uses a dragging movement for operation can be achieved by a single pointer without dragging, unless dragging is essential or the functionality is determined by the user agent and not modified by the author.",
    references: [
      "https://www.w3.org/TR/WCAG22/#dragging-movements",
      "https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html",
    ],
  },
  afterFile(ctx) {
    if (ctx.language === "html") {
      checkHtml(ctx as RuleContext & { ast: HtmlDocument });
      return;
    }
    if (
      ctx.language === "tsx" ||
      ctx.language === "jsx" ||
      ctx.language === "ts" ||
      ctx.language === "js"
    ) {
      checkJsx(ctx as RuleContext & { ast: TsxModule });
      return;
    }
  },
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function isExempt(tag: string, attrType: string | null): boolean {
  // <input type="range"> is user-agent-determined per WCAG 2.5.7 exception.
  if (tag === "input" && attrType === "range") return true;
  return false;
}

function describeDragSignal(signals: readonly string[]): string {
  if (signals.length === 1) return signals[0] ?? "";
  return signals.join(" + ");
}

// ---------------------------------------------------------------------------
// JSX
// ---------------------------------------------------------------------------

function checkJsx(ctx: RuleContext & { ast: TsxModule }): void {
  const module = ctx.ast;
  const elements = [...walkJsxElements(module)];

  // File-level: does anything here look like a single-pointer alternative?
  const fileHasAlternative = elements.some(jsxElementProvidesAlternative);

  // Library-import signal — applies to every flagged element in the file.
  const importedLibrary = detectDragLibraryImport(ctx.source);

  let flaggedAnyElement = false;

  for (const el of elements) {
    const drag = jsxDragSignal(el);
    if (drag.length === 0) continue;
    if (jsxIsExemptElement(el)) continue;
    flaggedAnyElement = true;

    if (fileHasAlternative) continue;

    ctx.emit(buildJsxViolation(el, drag, ctx.filePath));
  }

  // If the file imports a drag library but no element-level handler was
  // detected (e.g., behaviour is wired via hooks/context), still flag the
  // file when no alternative is present.
  if (
    importedLibrary !== null &&
    !flaggedAnyElement &&
    !fileHasAlternative &&
    elements.length > 0
  ) {
    const first = elements[0];
    if (first) {
      ctx.emit({
        severity: "warning",
        location: {
          filePath: ctx.filePath,
          line: first.loc.start.line,
          column: first.loc.start.column,
        },
        message: `File imports drag library "${importedLibrary}" but renders no click, button, or keyboard alternative — drag-only functionality fails WCAG 2.2 SC 2.5.7.`,
        suggestion: `Provide a single-pointer alternative alongside the ${importedLibrary} interactions: e.g., add up/down "Move" buttons, a "Sort A→Z" menu item, or arrow-key handlers so users who cannot drag can still reorder, resize, or move items.`,
      });
    }
  }
}

function jsxDragSignal(el: JsxElement): readonly string[] {
  const signals: string[] = [];
  if (getJsxAttributeString(el, "draggable") === "true") signals.push(`draggable="true"`);
  for (const handler of JSX_DRAG_HANDLERS) {
    if (hasJsxAttribute(el, handler)) signals.push(handler);
  }
  for (const [down, move] of JSX_DRAG_PAIRS) {
    if (hasJsxAttribute(el, down) && hasJsxAttribute(el, move)) {
      signals.push(`${down} + ${move}`);
    }
  }
  return signals;
}

function jsxIsExemptElement(el: JsxElement): boolean {
  if (hasJsxAttribute(el, "disabled")) return true;
  if (getJsxAttributeString(el, "aria-disabled") === "true") return true;
  const type = getJsxAttributeString(el, "type");
  if (isExempt(el.tagName.toLowerCase(), type)) return true;
  return false;
}

function jsxElementProvidesAlternative(el: JsxElement): boolean {
  const tagLower = el.tagName.toLowerCase();
  if (ALTERNATIVE_TAGS.has(tagLower)) return true;
  if (getJsxAttributeString(el, "role") === "button") return true;
  for (const attr of JSX_ALTERNATIVE_ATTRS) {
    if (hasJsxAttribute(el, attr)) return true;
  }
  return false;
}

function buildJsxViolation(
  el: JsxElement,
  signals: readonly string[],
  filePath: string,
): EmittedViolation {
  const tag = el.tagName;
  const signal = describeDragSignal(signals);
  return {
    severity: "warning",
    location: { filePath, line: el.loc.start.line, column: el.loc.start.column },
    message: `<${tag}> implements drag behaviour (${signal}) but no click, button, or keyboard alternative was found in this file — fails WCAG 2.2 SC 2.5.7 (Dragging Movements).`,
    suggestion: buildJsxSuggestion(tag, signals),
  };
}

function buildJsxSuggestion(tag: string, signals: readonly string[]): string {
  const signal = describeDragSignal(signals);
  if (tag.toLowerCase() === "li" || tag.toLowerCase() === "tr") {
    return `This <${tag}> uses ${signal} for reordering. Add up/down arrow <button> elements with onClick, or wire arrow-key handlers (onKeyDown), so users who cannot drag can still reorder.`;
  }
  return `<${tag}> uses ${signal} for drag operation. Add a single-pointer alternative: an onClick handler, a <button> alongside this element, or arrow-key handlers (onKeyDown) that perform the same action without dragging. If dragging is essential (e.g., free-form drawing), suppress this rule with a comment explaining why.`;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function checkHtml(ctx: RuleContext & { ast: HtmlDocument }): void {
  const elements = [...walkHtmlElements(ctx.ast)];
  const fileHasAlternative = elements.some(htmlElementProvidesAlternative);

  for (const el of elements) {
    const drag = htmlDragSignal(el);
    if (drag.length === 0) continue;
    if (htmlIsExemptElement(el)) continue;
    if (fileHasAlternative) continue;

    ctx.emit(buildHtmlViolation(el, drag, ctx.filePath));
  }
}

function htmlDragSignal(el: HtmlElement): readonly string[] {
  const signals: string[] = [];
  if (getHtmlAttribute(el, "draggable") === "true") signals.push(`draggable="true"`);
  for (const handler of HTML_DRAG_HANDLERS) {
    if (hasHtmlAttribute(el, handler)) signals.push(handler);
  }
  for (const [down, move] of HTML_DRAG_PAIRS) {
    if (hasHtmlAttribute(el, down) && hasHtmlAttribute(el, move)) {
      signals.push(`${down} + ${move}`);
    }
  }
  return signals;
}

function htmlIsExemptElement(el: HtmlElement): boolean {
  if (hasHtmlAttribute(el, "disabled")) return true;
  if (getHtmlAttribute(el, "aria-disabled") === "true") return true;
  const type = getHtmlAttribute(el, "type");
  if (isExempt(el.tagName.toLowerCase(), type)) return true;
  return false;
}

function htmlElementProvidesAlternative(el: HtmlElement): boolean {
  const tagLower = el.tagName.toLowerCase();
  if (ALTERNATIVE_TAGS.has(tagLower)) return true;
  if (getHtmlAttribute(el, "role") === "button") return true;
  for (const attr of HTML_ALTERNATIVE_ATTRS) {
    if (hasHtmlAttribute(el, attr)) return true;
  }
  return false;
}

function buildHtmlViolation(
  el: HtmlElement,
  signals: readonly string[],
  filePath: string,
): EmittedViolation {
  const tag = el.tagName;
  const signal = describeDragSignal(signals);
  return {
    severity: "warning",
    location: { filePath, line: el.loc.start.line, column: el.loc.start.column },
    message: `<${tag}> implements drag behaviour (${signal}) but no click, button, or keyboard alternative was found in this file — fails WCAG 2.2 SC 2.5.7 (Dragging Movements).`,
    suggestion: `<${tag}> uses ${signal} for drag operation. Add a single-pointer alternative such as a sibling <button onclick="...">, an onclick handler on this element, or arrow-key handlers (onkeydown) so users who cannot drag can still operate this control.`,
  };
}

// ---------------------------------------------------------------------------
// Drag-library import detection (regex over raw source — TSX parser does
// not surface ImportDeclaration nodes in v0.0.x).
// ---------------------------------------------------------------------------

function detectDragLibraryImport(source: string): string | null {
  for (const lib of DRAG_LIBRARY_IMPORTS) {
    const escaped = lib.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const importRe = new RegExp(
      `(?:import\\b[^;]*?from\\s*['"]${escaped}(?:/[^'"]*)?['"])|(?:require\\(\\s*['"]${escaped}(?:/[^'"]*)?['"]\\s*\\))`,
    );
    if (importRe.test(source)) return lib;
  }
  return null;
}
