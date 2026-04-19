/**
 * Rule: media/alt-text-missing
 * Satisfies: wcag22:1.1.1, wcag21:1.1.1
 * Spec: https://www.w3.org/TR/WCAG22/#non-text-content
 *
 * > All non-text content that is presented to the user has a text
 * > alternative that serves the equivalent purpose, except for the
 * > situations listed below: controls, input, time-based media,
 * > tests, sensory, CAPTCHA, decoration/formatting/invisible.
 *
 * Source: https://www.w3.org/TR/WCAG22/#non-text-content
 *
 * This rule flags `<img>` and `<input type="image">` elements that
 * have neither a usable text alternative (alt, aria-label,
 * aria-labelledby) nor a decorative marker (alt="", role="presentation",
 * role="none", aria-hidden="true"). It works on both HTML and JSX
 * sources.
 *
 * Fix suggestion strategy: inspect surrounding nodes to produce
 * context-aware text. If the image is inside a link or button, suggest
 * alt describing the destination/action. If it has neither a usable
 * name nor a decorative marker, but is clearly content (src with a
 * filename), suggest alt describing the subject.
 */

import { defineRule } from "../../api/plugin.ts";
import {
  findHtmlElementsByTag,
  findJsxElementsByTag,
  findJsxElementsForTag,
  getHtmlAttribute,
  getJsxAttribute,
  getJsxAttributeString,
  hasHtmlAttribute,
  hasJsxAttribute,
  isDecorativeHtmlElement,
  isDecorativeJsxElement,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, HtmlElement, JsxElement, TsxModule } from "../../types/ast.ts";

export const rule = defineRule({
  id: "media/alt-text-missing",
  satisfies: ["wcag22:1.1.1", "wcag21:1.1.1"],
  severity: "error",
  scope: "node",
  fixClass: "mechanical",
  // Opt in: wrapper components declared as rendering `<img>` via the
  // object form of `nativeWrappers` (e.g. `{ Avatar: "img", NextImage:
  // "img" }`) get the same missing-alt check as a bare `<img>`. The
  // wrapper must still pass an `alt` prop to its inner `<img>` — the
  // rule surfaces when it doesn't.
  wrapperTreatsAsElement: "img",
  appliesTo: {
    fileExtensions: [".html", ".htm", ".tsx", ".jsx"],
  },
  docs: {
    description:
      "Images that convey content must have a text alternative — alt, aria-label, or aria-labelledby. Decorative images must be explicitly marked.",
    rationale:
      "Screen readers announce images by their accessible name. An image without a text alternative is announced as the file name or nothing at all, leaving non-sighted users unable to understand what the image communicates.",
    goodExample: `<img src="chart.png" alt="Quarterly revenue growth 2024–2026: $1.2M to $3.8M." />`,
    badExample: `<img src="chart.png" />`,
    normativeQuote:
      "All non-text content that is presented to the user has a text alternative that serves the equivalent purpose.",
    references: [
      "https://www.w3.org/TR/WCAG22/#non-text-content",
      "https://www.w3.org/WAI/tutorials/images/",
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
      checkJsx(ctx.ast as TsxModule, ctx.wrappersForElement, (v) => ctx.emit(v));
    }
  },
});

type Emit = (v: {
  severity: "error" | "warning" | "info";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
}) => void;

function checkHtml(doc: HtmlDocument, emit: Emit): void {
  for (const element of findHtmlElementsByTag(doc, "img")) {
    if (isDecorativeHtmlElement(element)) continue;
    if (hasAccessibleNameHtml(element)) continue;
    emitHtmlViolation(element, emit);
  }
  for (const input of findHtmlElementsByTag(doc, "input")) {
    const type = getHtmlAttribute(input, "type");
    if (type?.toLowerCase() !== "image") continue;
    if (isDecorativeHtmlElement(input)) continue;
    if (hasAccessibleNameHtml(input)) continue;
    emitHtmlViolation(input, emit);
  }
}

function hasAccessibleNameHtml(element: HtmlElement): boolean {
  const alt = getHtmlAttribute(element, "alt");
  if (alt !== null && alt.trim().length > 0) return true;
  const ariaLabel = getHtmlAttribute(element, "aria-label");
  if (ariaLabel !== null && ariaLabel.trim().length > 0) return true;
  if (hasHtmlAttribute(element, "aria-labelledby")) return true;
  if (hasHtmlAttribute(element, "title")) {
    const title = getHtmlAttribute(element, "title");
    if (title !== null && title.trim().length > 0) return true;
  }
  return false;
}

function emitHtmlViolation(element: HtmlElement, emit: Emit): void {
  const src = getHtmlAttribute(element, "src");
  const message = buildMessage(element.tagName, src);
  const suggestion = buildSuggestion(element.tagName, src);
  emit({
    severity: "error",
    location: {
      filePath: "",
      line: element.loc.start.line,
      column: element.loc.start.column,
    },
    message,
    suggestion,
  });
}

function checkJsx(module: TsxModule, wrappersForImg: ReadonlySet<string>, emit: Emit): void {
  // Three resolution channels feed the img-accessible-name check:
  //   1. bare `<img>` — the native tag channel.
  //   2. `wrappersForImg` — PascalCase wrappers the user declared as
  //      rendering `<img>` via `nativeWrappers` (Q2-WRAPMAP-RULES).
  //   3. polymorphic `as="img"` / `asChild` → `<img>` (Q2R2-POLYMORPHIC) —
  //      surfaced by `findJsxElementsForTag` once per matching element.
  // `findJsxElementsForTag` unifies all three; the wrapper's own attrs
  // are the call-site attrs that get forwarded to the inner `<img>`, so
  // the same `hasAccessibleNameJsx` check applies without modification.
  const seen = new Set<JsxElement>();
  for (const element of findJsxElementsForTag(module, "img", wrappersForImg)) {
    if (seen.has(element)) continue;
    seen.add(element);
    if (isDecorativeJsxElement(element)) continue;
    if (hasAccessibleNameJsx(element)) continue;
    emitJsxViolation(element, emit);
  }
  checkJsxInputImages(module, emit);
}

/** Flags `<input type="image">` without a usable accessible name. */
function checkJsxInputImages(module: TsxModule, emit: Emit): void {
  for (const input of findJsxElementsByTag(module, "input")) {
    const type = getJsxAttributeString(input, "type");
    if (type?.toLowerCase() !== "image") continue;
    if (isDecorativeJsxElement(input)) continue;
    if (hasAccessibleNameJsx(input)) continue;
    emitJsxViolation(input, emit);
  }
}

function hasAccessibleNameJsx(element: JsxElement): boolean {
  const altString = getJsxAttributeString(element, "alt");
  if (altString !== null && altString.trim().length > 0) return true;
  const ariaLabel = getJsxAttributeString(element, "aria-label");
  if (ariaLabel !== null && ariaLabel.trim().length > 0) return true;
  if (hasJsxAttribute(element, "aria-labelledby")) return true;
  // If `alt` is an expression, we assume the developer is computing a
  // name at runtime. This is a false-negative for static analysis but
  // the alternative — flagging every runtime expression — creates far
  // more noise than signal. The eslint-plugin-jsx-a11y rule makes the
  // same tradeoff.
  const altAttr = getJsxAttribute(element, "alt");
  if (altAttr?.value?.kind === "Expression") return true;
  return false;
}

function emitJsxViolation(element: JsxElement, emit: Emit): void {
  const src = getJsxAttributeString(element, "src");
  const message = buildMessage(element.tagName, src);
  const suggestion = buildSuggestion(element.tagName, src);
  emit({
    severity: "error",
    location: {
      filePath: "",
      line: element.loc.start.line,
      column: element.loc.start.column,
    },
    message,
    suggestion,
  });
}

function buildMessage(tagName: string, src: string | null): string {
  if (src) {
    const name = filenameFromPath(src);
    return `<${tagName}> '${name}' is missing a text alternative — screen readers will announce the file name or nothing at all.`;
  }
  return `<${tagName}> has no text alternative — screen readers will announce nothing.`;
}

function buildSuggestion(tagName: string, src: string | null): string {
  if (src) {
    const name = filenameFromPath(src);
    const subject = guessSubject(name);
    return `Add alt describing what the image communicates (e.g., alt="${subject}"). If the image is purely decorative — the surrounding text already conveys the same information — mark it with alt="" instead.`;
  }
  return `Add an alt attribute describing what the ${tagName} communicates. If the image is decorative, mark it with alt="" explicitly.`;
}

function filenameFromPath(src: string): string {
  const slash = Math.max(src.lastIndexOf("/"), src.lastIndexOf("\\"));
  return slash === -1 ? src : src.slice(slash + 1);
}

function guessSubject(filename: string): string {
  // Turn "chart-revenue-2026.png" into "chart revenue 2026" so the
  // suggestion reads like a sentence, not a file path.
  return filename
    .replace(/\.[a-zA-Z0-9]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim();
}
