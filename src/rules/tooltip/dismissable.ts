/**
 * Rule: tooltip/dismissable
 * Satisfies: wcag22:1.4.13, wcag21:1.4.13
 * Spec: https://www.w3.org/TR/WCAG22/#content-on-hover-or-focus
 *
 * > Where receiving and then removing pointer hover or keyboard focus
 * > triggers additional content to become visible and then hidden, the
 * > following are true:
 * >  - Dismissible: A mechanism is available to dismiss the additional
 * >    content without moving pointer hover or keyboard focus, unless
 * >    the additional content communicates an input error or does not
 * >    obscure or replace other content;
 * >  - Hoverable: If pointer hover can trigger the additional content,
 * >    then the pointer can be moved over the additional content
 * >    without the additional content disappearing;
 * >  - Persistent: The additional content remains visible until the
 * >    hover or focus trigger is removed, the user dismisses it, or
 * >    its information is no longer valid.
 *
 * Source: https://www.w3.org/TR/WCAG22/#content-on-hover-or-focus
 *
 * Static-analysis scope (v0.0.x): the native HTML `title` attribute on
 * interactive elements is the canonical 1.4.13 failure that's
 * detectable without runtime hover/focus simulation. Native browser
 * tooltips are:
 *   - NOT dismissible (no Esc support, no close affordance);
 *   - NOT hoverable (move the pointer toward them and they vanish);
 *   - NOT persistent (timeout-based).
 * They also fail to render at all on touch devices and to many AT
 * users. The presence of `title` on an interactive element therefore
 * strongly indicates a 1.4.13 failure.
 *
 * Out of scope for this rule: custom tooltip components (Tooltip,
 * Popover, Hint). Their compliance depends on runtime keyboard and
 * pointer behavior that static analysis cannot determine. Those need
 * a manual checklist entry.
 *
 * Exempt: `<abbr title="…">`, `<dfn title="…">`, and other purely
 * non-interactive elements where `title` is the canonical mechanism
 * for term expansion. The 1.4.13 failure is specifically about
 * interactive elements.
 */

import { defineRule } from "../../api/plugin.ts";
import {
  getHtmlAttribute,
  getJsxAttribute,
  getJsxAttributeString,
  walkHtmlElements,
  walkJsxElements,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, HtmlElement, JsxElement, TsxModule } from "../../types/ast.ts";

/** Native HTML tags whose default role is interactive for 1.4.13 purposes. */
const INTERACTIVE_TAGS: ReadonlySet<string> = new Set([
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
]);

/** ARIA roles that make a non-interactive element interactive. */
const INTERACTIVE_ROLES: ReadonlySet<string> = new Set([
  "button",
  "link",
  "checkbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "switch",
  "tab",
  "treeitem",
  "combobox",
  "slider",
  "spinbutton",
  "textbox",
  "searchbox",
]);

export const rule = defineRule({
  id: "tooltip/dismissable",
  satisfies: ["wcag22:1.4.13", "wcag21:1.4.13"],
  severity: "warning",
  scope: "node",
  appliesTo: {
    fileExtensions: [".html", ".htm", ".tsx", ".jsx"],
  },
  docs: {
    description:
      "Native title attributes on interactive elements produce browser tooltips that are not dismissable, hoverable, or persistent — failing WCAG 1.4.13.",
    rationale:
      "Browser-native tooltips (rendered from the title attribute) cannot be dismissed with the Escape key, disappear when the pointer approaches them, time out unpredictably, and are invisible to many touch and assistive-technology users. WCAG 1.4.13 requires content that appears on hover or focus to be dismissable, hoverable, and persistent — three properties native tooltips do not satisfy. The fix is to expose the information as an accessible visible label, an aria-label, or a custom tooltip with proper keyboard and pointer behavior.",
    goodExample: `<button aria-label="Save document">💾</button>`,
    badExample: `<button title="Save document">💾</button>`,
    normativeQuote:
      "Where receiving and then removing pointer hover or keyboard focus triggers additional content to become visible and then hidden, the following are true: Dismissible, Hoverable, Persistent.",
    references: [
      "https://www.w3.org/TR/WCAG22/#content-on-hover-or-focus",
      "https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html",
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
  severity: "warning";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
}) => void;

function checkHtml(doc: HtmlDocument, emit: Emit): void {
  for (const el of walkHtmlElements(doc)) {
    const title = getHtmlAttribute(el, "title");
    if (title === null) continue;
    if (title.trim().length === 0) continue;
    if (!isInteractiveHtml(el)) continue;
    emit(buildViolation(el.tagName.toLowerCase(), title, el.loc.start));
  }
}

function isInteractiveHtml(element: HtmlElement): boolean {
  const role = getHtmlAttribute(element, "role");
  if (role !== null && INTERACTIVE_ROLES.has(role.toLowerCase())) return true;
  const tag = element.tagName.toLowerCase();
  if (!INTERACTIVE_TAGS.has(tag)) return false;
  // <input type="hidden"> is not interactive.
  if (tag === "input") {
    const type = getHtmlAttribute(element, "type");
    if (type !== null && type.toLowerCase() === "hidden") return false;
  }
  // <a> without href is not interactive.
  if (tag === "a") {
    const href = getHtmlAttribute(element, "href");
    if (href === null) return false;
  }
  return true;
}

function checkJsx(module: TsxModule, emit: Emit): void {
  for (const el of walkJsxElements(module)) {
    const titleAttr = getJsxAttribute(el, "title");
    if (titleAttr === null) continue;
    const titleString = getJsxAttributeString(el, "title");
    // For expression-valued title={expr}, treat as load-bearing only if
    // the element is interactive — same failure mode either way.
    if (titleString !== null && titleString.trim().length === 0) continue;
    if (!isInteractiveJsx(el)) continue;
    const displayTitle = titleString ?? "<expression>";
    emit(buildViolation(el.tagName, displayTitle, el.loc.start));
  }
}

function isInteractiveJsx(element: JsxElement): boolean {
  const role = getJsxAttributeString(element, "role");
  if (role !== null && INTERACTIVE_ROLES.has(role.toLowerCase())) return true;
  const tag = element.tagName;
  // JSX intrinsic interactive tags are always lowercase.
  if (!INTERACTIVE_TAGS.has(tag)) return false;
  if (tag === "input") {
    const type = getJsxAttributeString(element, "type");
    if (type !== null && type.toLowerCase() === "hidden") return false;
  }
  if (tag === "a") {
    const hrefAttr = getJsxAttribute(element, "href");
    if (hrefAttr === null) return false;
  }
  return true;
}

function buildViolation(
  tag: string,
  title: string,
  loc: { line: number; column: number },
): {
  severity: "warning";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
} {
  const display = title.length > 40 ? `${title.slice(0, 37)}...` : title;
  return {
    severity: "warning",
    location: { filePath: "", line: loc.line, column: loc.column },
    message: `<${tag}> has title="${display}" — native browser tooltips are not dismissable with the keyboard, disappear on pointer approach, and are invisible to touch and many assistive-technology users, failing WCAG 1.4.13 (Content on Hover or Focus).`,
    suggestion: `Replace title="${display}" on this <${tag}> with one of: (a) a visible text label inside the element, (b) aria-label="${display}" if a visible label is impractical, or (c) a custom tooltip component that supports Escape-to-dismiss, hover-bridging, and stays visible until the trigger loses focus. The native title attribute remains acceptable on non-interactive elements like <abbr> for term expansion.`,
  };
}
