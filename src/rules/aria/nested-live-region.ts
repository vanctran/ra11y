/**
 * Rule: aria/nested-live-region
 * Satisfies: wcag22:4.1.3, wcag21:4.1.3
 * Spec: https://www.w3.org/TR/WCAG22/#status-messages
 *
 * > In content implemented using markup languages, status messages can
 * > be programmatically determined through role or properties such that
 * > they can be presented to the user by assistive technologies without
 * > receiving focus.
 *
 * Source: https://www.w3.org/TR/WCAG22/#status-messages
 *
 * Flags an element that declares a live region while having an ancestor
 * in the same document that already declares one. Per WAI-ARIA 1.2 the
 * politeness, atomicity, and relevant-mutations of overlapping live
 * regions are not defined; in practice screen readers split unevenly —
 * some honor the outer region only, others announce both, and several
 * re-announce the entire outer region whenever any descendant mutates.
 * The net effect on the user is duplicate or stuttering announcements,
 * or whole-list re-reads when only one new item arrived.
 *
 * A "live region" here is an element that either:
 *   - declares `aria-live` with a non-`off` value (`polite` / `assertive`), or
 *   - declares `role` ∈ {`alert`, `status`, `log`} — the WAI-ARIA roles
 *     whose definition implies a non-`off` live region.
 *
 * `aria-live="off"`, `role="timer"`, and `role="marquee"` are not live
 * for the purposes of this rule (politeness is `off`); a descendant
 * live region under an `off` ancestor is the only well-defined nesting
 * shape, so the rule deliberately skips it.
 *
 * Scope: single document. The rule does not resolve cross-file
 * component composition — a parent component declaring `aria-live` in
 * one file and a child component declaring `role="status"` in another
 * cannot be linked statically. That nesting shape is the same bug, but
 * it requires the agent to grep the rendered subtree.
 */

import { defineRule } from "../../api/plugin.ts";
import {
  getHtmlAttribute,
  getJsxAttributeString,
  walkHtmlElements,
  walkJsxElements,
} from "../../engine/ast-helpers.ts";
import type {
  HtmlDocument,
  HtmlElement,
  HtmlNode,
  JsxElement,
  JsxNode,
  TsxModule,
} from "../../types/ast.ts";

/**
 * Roles whose ARIA 1.2 definition implies a non-`off` live region. An
 * element carrying one of these roles is treated as a live region for
 * the nested-detection predicate even when `aria-live` is absent.
 *
 * `timer` and `marquee` are deliberately excluded — both imply
 * `aria-live="off"` per spec, so nesting them inside another live
 * region does not produce double-announcement behavior.
 *
 * Spec: https://www.w3.org/TR/wai-aria-1.2/#aria-live
 */
const LIVE_ROLES: ReadonlySet<string> = new Set(["alert", "status", "log"]);

export const rule = defineRule({
  id: "aria/nested-live-region",
  satisfies: ["wcag22:4.1.3", "wcag21:4.1.3"],
  severity: "error",
  scope: "document",
  fixClass: "verify-in-source",
  appliesTo: {
    fileExtensions: [".tsx", ".jsx", ".html", ".htm"],
  },
  docs: {
    description:
      "An element that declares a live region must not be nested inside another live region in the same document — the resulting announcement behavior is undefined and screen readers commonly re-announce the outer region on every descendant mutation.",
    rationale:
      "WAI-ARIA does not define the resolution when two live regions overlap. Screen readers diverge: some announce only the outer, some announce both (duplicate), some honor the inner role override, and several treat any mutation under the outer live region as a change to the whole outer region — re-announcing every existing descendant. The user-perceived failure is duplicate or stuttering announcements, or whole-region re-reads triggered by a single update. Status messages then fail SC 4.1.3 because the new content cannot be programmatically determined as a discrete announcement.",
    goodExample: `<ul aria-live="polite" aria-relevant="additions">\n  <li>Item A</li>\n  <li>Item B</li>\n</ul>`,
    badExample: `<ul aria-live="polite" aria-relevant="additions">\n  <li role="status">Saved.</li>\n</ul>`,
    normativeQuote:
      "In content implemented using markup languages, status messages can be programmatically determined through role or properties such that they can be presented to the user by assistive technologies without receiving focus.",
    references: [
      "https://www.w3.org/TR/WCAG22/#status-messages",
      "https://www.w3.org/TR/wai-aria-1.2/#aria-live",
      "https://www.w3.org/TR/wai-aria-1.2/#status",
      "https://www.w3.org/TR/wai-aria-1.2/#alert",
      "https://www.w3.org/TR/wai-aria-1.2/#log",
    ],
    knownLimitations: [
      "Single-document scope: a parent component declaring a live region in one file and a child component declaring one in another file are not linked statically; the nesting is not detected when it straddles a component boundary.",
      "Implicit `<output>` (role=status by default) is not treated as a live region — only explicit `aria-live` or explicit `role` values are inspected. An `<output>` nested inside an aria-live ancestor would pass this rule.",
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

interface LiveDescriptor {
  /** Lowercased role token if the live status comes from `role=`. */
  readonly role: string | null;
  /** Lowercased aria-live value if the live status comes from `aria-live=`. */
  readonly ariaLive: string | null;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function checkHtml(doc: HtmlDocument, emit: Emit): void {
  const parentOf = buildHtmlParentMap(doc);
  for (const el of walkHtmlElements(doc)) {
    const inner = htmlLiveDescriptor(el);
    if (inner === null) continue;
    const ancestor = findHtmlLiveAncestor(el, parentOf);
    if (ancestor === null) continue;
    const outer = htmlLiveDescriptor(ancestor.el);
    if (outer === null) continue;
    emit(
      buildViolation(
        describeLive(ancestor.el.tagName, outer),
        describeLive(el.tagName, inner),
        ancestor.el.loc.start.line,
        el.loc.start,
      ),
    );
  }
}

function findHtmlLiveAncestor(
  element: HtmlElement,
  parentOf: ReadonlyMap<HtmlElement, HtmlElement>,
): { readonly el: HtmlElement } | null {
  let parent = parentOf.get(element);
  while (parent) {
    if (htmlLiveDescriptor(parent) !== null) return { el: parent };
    parent = parentOf.get(parent);
  }
  return null;
}

function htmlLiveDescriptor(el: HtmlElement): LiveDescriptor | null {
  const rawLive = getHtmlAttribute(el, "aria-live");
  const ariaLive = rawLive === null ? null : rawLive.toLowerCase();
  if (ariaLive !== null && ariaLive !== "polite" && ariaLive !== "assertive") {
    // off / invalid token / empty — not a live region for our purposes.
    if (ariaLive === "off") return null;
    // Invalid tokens are someone else's problem (aria/live-region-valid). The
    // attribute is effectively absent for nesting analysis.
  }
  const rawRole = getHtmlAttribute(el, "role");
  const role = rawRole === null ? null : firstRoleToken(rawRole);
  const liveByRole = role !== null && LIVE_ROLES.has(role);
  const liveByAttr = ariaLive === "polite" || ariaLive === "assertive";
  if (!(liveByRole || liveByAttr)) return null;
  return {
    role: liveByRole ? role : null,
    ariaLive: liveByAttr ? ariaLive : null,
  };
}

function buildHtmlParentMap(doc: HtmlDocument): Map<HtmlElement, HtmlElement> {
  const parentOf = new Map<HtmlElement, HtmlElement>();
  const visit = (node: HtmlNode, parent: HtmlElement | null): void => {
    if (node.kind !== "HtmlElement") return;
    if (parent !== null) parentOf.set(node, parent);
    for (const child of node.children) visit(child, node);
  };
  for (const top of doc.children) visit(top, null);
  return parentOf;
}

// ---------------------------------------------------------------------------
// JSX
// ---------------------------------------------------------------------------

function checkJsx(module: TsxModule, emit: Emit): void {
  const parentOf = buildJsxParentMap(module);
  for (const el of walkJsxElements(module)) {
    const inner = jsxLiveDescriptor(el);
    if (inner === null) continue;
    const ancestor = findJsxLiveAncestor(el, parentOf);
    if (ancestor === null) continue;
    const outer = jsxLiveDescriptor(ancestor.el);
    if (outer === null) continue;
    emit(
      buildViolation(
        describeLive(ancestor.el.tagName, outer),
        describeLive(el.tagName, inner),
        ancestor.el.loc.start.line,
        el.loc.start,
      ),
    );
  }
}

function findJsxLiveAncestor(
  element: JsxElement,
  parentOf: ReadonlyMap<JsxElement, JsxElement>,
): { readonly el: JsxElement } | null {
  let parent = parentOf.get(element);
  while (parent) {
    // PascalCase components are opaque to single-file analysis. We can't
    // see what they render, so we don't walk through them either. This
    // matches the documented single-document scope limitation.
    if (isJsxPascalCase(parent.tagName)) return null;
    if (jsxLiveDescriptor(parent) !== null) return { el: parent };
    parent = parentOf.get(parent);
  }
  return null;
}

function jsxLiveDescriptor(el: JsxElement): LiveDescriptor | null {
  if (isJsxPascalCase(el.tagName)) return null;
  const rawLive = getJsxAttributeString(el, "aria-live");
  const ariaLive = rawLive === null ? null : rawLive.toLowerCase();
  if (ariaLive === "off") return null;
  const rawRole = getJsxAttributeString(el, "role");
  const role = rawRole === null ? null : firstRoleToken(rawRole);
  const liveByRole = role !== null && LIVE_ROLES.has(role);
  const liveByAttr = ariaLive === "polite" || ariaLive === "assertive";
  if (!(liveByRole || liveByAttr)) return null;
  return {
    role: liveByRole ? role : null,
    ariaLive: liveByAttr ? ariaLive : null,
  };
}

function buildJsxParentMap(module: TsxModule): Map<JsxElement, JsxElement> {
  const parentOf = new Map<JsxElement, JsxElement>();
  const visit = (node: JsxNode, parent: JsxElement | null): void => {
    if (node.kind !== "JsxElement") return;
    if (parent !== null) parentOf.set(node, parent);
    for (const child of node.children) visit(child, node);
  };
  for (const top of module.jsxElements) visit(top, null);
  return parentOf;
}

function isJsxPascalCase(tag: string): boolean {
  const first = tag[0];
  return first !== undefined && first >= "A" && first <= "Z";
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * `role` is a space-separated list of role tokens; assistive tech uses
 * the first recognized one. For nesting detection only the first token
 * matters — if it's a live role, the element is a live region.
 */
function firstRoleToken(raw: string): string | null {
  const tokens = raw.trim().split(/\s+/u);
  const first = tokens[0];
  return first ? first.toLowerCase() : null;
}

function describeLive(tagName: string, d: LiveDescriptor): string {
  const tag = tagName.toLowerCase();
  if (d.role !== null && d.ariaLive !== null) {
    return `<${tag} role="${d.role}" aria-live="${d.ariaLive}">`;
  }
  if (d.role !== null) return `<${tag} role="${d.role}">`;
  return `<${tag} aria-live="${d.ariaLive ?? ""}">`;
}

function buildViolation(
  outer: string,
  inner: string,
  outerLine: number,
  loc: { line: number; column: number },
): {
  severity: "error";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
} {
  return {
    severity: "error",
    location: { filePath: "", line: loc.line, column: loc.column },
    message: `${inner} is a live region nested inside another live region ${outer} (opened on line ${outerLine}). Overlapping live regions have no defined behavior — screen readers may announce only the outer, announce both (duplicate), or re-announce the entire outer region every time any descendant mutates.`,
    suggestion: `Keep one live region for this content area. Usually the outer ${outer} should own announcements (so additions to the list are read once); remove the inner declaration — drop the role or set aria-live="off" on ${inner} — and let the outer region carry the politeness. If the inner element genuinely needs its own announcement channel (e.g. a time-critical alert that must interrupt), move it outside the outer live region so the two regions are siblings rather than nested.`,
  };
}
