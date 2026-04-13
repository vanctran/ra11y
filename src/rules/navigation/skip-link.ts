/**
 * Rule: navigation/skip-link
 * Satisfies: wcag22:2.4.1, wcag21:2.4.1
 * Spec: https://www.w3.org/TR/WCAG22/#bypass-blocks
 *
 * > A mechanism is available to bypass blocks of content that are
 * > repeated on multiple Web pages.
 *
 * The conventional skip-link pattern: the first focusable element
 * in a document is an anchor with an in-page href like `#main`
 * that jumps past the nav to the primary content. Keyboard users
 * press Tab once to focus the link, then Enter to jump — bypassing
 * the N items in the primary nav without having to Tab through
 * each one on every page.
 *
 * Scope: only pages that actually have repeated blocks worth
 * skipping — documents with a `<nav>` landmark containing
 * multiple links. On documents with no nav, the rule stays quiet.
 *
 * Detection: the first `<a href>` that precedes the first `<nav>`
 * in source order must (a) have an in-page href (`#something`) and
 * (b) reference a valid id in the document. Missing or non-matching
 * skip-link → warning.
 */

import { defineRule } from "../../api/plugin.ts";
import {
  findHtmlElementsByTag,
  getHtmlAttribute,
  walkHtmlElements,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, HtmlElement } from "../../types/ast.ts";

const NAV_LINK_MIN = 2;

export const rule = defineRule({
  id: "navigation/skip-link",
  satisfies: ["wcag22:2.4.1", "wcag21:2.4.1"],
  severity: "warning",
  scope: "document",
  appliesTo: {
    fileExtensions: [".html", ".htm"],
  },
  docs: {
    description:
      "Pages with a primary navigation should offer a skip link as the first focusable element so keyboard users can bypass the nav on every page.",
    rationale:
      "Keyboard-only users (including people using screen readers and people with motor impairments) Tab through every focusable element in source order. On a page with a 12-item primary nav, that's 12 Tab presses on every navigation between pages — which compounds fast. The skip-link pattern is the standard answer: a link at the very top of the page that jumps to `#main`, hidden off-screen until focused.",
    goodExample:
      '<a class="skip-link" href="#main">Skip to main content</a>…<nav>…</nav>…<main id="main">…</main>',
    badExample: "<nav>…12 links…</nav><main>…</main>  <!-- no skip link -->",
    normativeQuote:
      "A mechanism is available to bypass blocks of content that are repeated on multiple Web pages.",
    references: [
      "https://www.w3.org/TR/WCAG22/#bypass-blocks",
      "https://www.w3.org/WAI/WCAG22/Techniques/general/G1",
    ],
  },
  afterFile(ctx) {
    if (ctx.language !== "html") return;
    const doc = ctx.ast as HtmlDocument;
    const navs = findHtmlElementsByTag(doc, "nav");
    if (navs.length === 0) return;
    const firstNav = navs[0];
    if (!firstNav) return;
    if (linksInside(firstNav).length < NAV_LINK_MIN) return;

    const firstLink = firstFocusableAnchor(doc);
    if (!(firstLink && precedesElement(firstLink, firstNav))) {
      ctx.emit({
        severity: "warning",
        location: {
          filePath: "",
          line: firstNav.loc.start.line,
          column: firstNav.loc.start.column,
        },
        message:
          "No skip link precedes the primary <nav>. Keyboard users will Tab through every link in the nav on every page.",
        suggestion:
          'Add <a href="#main">Skip to main content</a> (or similar) as the first focusable element, with `#main` pointing to your <main> landmark. Visually hide it with CSS and reveal on :focus. See https://www.w3.org/WAI/WCAG22/Techniques/general/G1.',
      });
      return;
    }

    const href = getHtmlAttribute(firstLink, "href") ?? "";
    if (!href.startsWith("#") || href === "#") {
      ctx.emit({
        severity: "warning",
        location: {
          filePath: "",
          line: firstLink.loc.start.line,
          column: firstLink.loc.start.column,
        },
        message:
          "First link on the page is not a skip link. Expected href='#<target-id>' bypassing the primary nav.",
        suggestion:
          'Point the first link at an in-page anchor, e.g. href="#main", matching your <main id="main"> landmark.',
      });
      return;
    }

    const targetId = href.slice(1);
    const ids = collectIds(doc);
    if (!ids.has(targetId)) {
      ctx.emit({
        severity: "warning",
        location: {
          filePath: "",
          line: firstLink.loc.start.line,
          column: firstLink.loc.start.column,
        },
        message: `Skip link targets '#${targetId}' but no element in the document has that id.`,
        suggestion: `Add id="${targetId}" to your <main> (or the element the skip link should jump to) so browser focus lands there on activation.`,
      });
    }
  },
});

function linksInside(nav: HtmlElement): HtmlElement[] {
  const links: HtmlElement[] = [];
  collectAnchors(nav, links);
  return links;
}

function collectAnchors(el: HtmlElement, out: HtmlElement[]): void {
  if (el.tagName.toLowerCase() === "a") out.push(el);
  for (const child of el.children) {
    if (child.kind === "HtmlElement") collectAnchors(child, out);
  }
}

function firstFocusableAnchor(doc: HtmlDocument): HtmlElement | null {
  for (const el of walkHtmlElements(doc)) {
    if (el.tagName.toLowerCase() === "a" && getHtmlAttribute(el, "href") !== null) {
      return el;
    }
  }
  return null;
}

function precedesElement(a: HtmlElement, b: HtmlElement): boolean {
  if (a.loc.start.line !== b.loc.start.line) return a.loc.start.line < b.loc.start.line;
  return a.loc.start.column < b.loc.start.column;
}

function collectIds(doc: HtmlDocument): Set<string> {
  const ids = new Set<string>();
  for (const el of walkHtmlElements(doc)) {
    const id = getHtmlAttribute(el, "id");
    if (id !== null && id.length > 0) ids.add(id);
  }
  return ids;
}
