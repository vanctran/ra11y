/**
 * Rule: semantics/landmark-main
 * Satisfies: wcag22:1.3.1, wcag21:1.3.1
 * Spec: https://www.w3.org/TR/WCAG22/#info-and-relationships
 *
 * > Information, structure, and relationships conveyed through
 * > presentation can be programmatically determined or are
 * > available in text.
 *
 * HTML5 / WAI-ARIA landmark roles expose page structure to
 * assistive tech so users can jump between major regions. The
 * single most important landmark is `main` — there should be
 * exactly one per document, and it should wrap the primary content.
 *
 * Flags documents that either:
 *   - have zero `<main>` / `role="main"` elements
 *   - have more than one (ARIA requires exactly one main landmark)
 *
 * Scope: HTML documents with a `<body>` (fragments without a body
 * are typically components, not pages, and we don't assume they
 * need a landmark). JSX files are out of scope because a JSX
 * fragment rarely represents a full page — apps use router layouts
 * to add the main landmark at the shell level, and we'd produce
 * false positives flagging every route component.
 */

import { defineRule } from "../../api/plugin.ts";
import {
  findHtmlElementsByTag,
  getHtmlAttribute,
  walkHtmlElements,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, HtmlElement } from "../../types/ast.ts";

export const rule = defineRule({
  id: "semantics/landmark-main",
  satisfies: ["wcag22:1.3.1", "wcag21:1.3.1"],
  severity: "warning",
  scope: "document",
  appliesTo: {
    fileExtensions: [".html", ".htm"],
  },
  docs: {
    description:
      "Every page should have exactly one <main> landmark. Screen-reader users jump between landmarks to skip repetitive navigation; a missing main leaves them with no primary-content anchor.",
    rationale:
      "The main landmark is the single most useful navigation target for assistive-tech users. NVDA, JAWS, and VoiceOver all bind a shortcut to 'jump to main'. When it's missing, users have to linearly skim past the header and navigation on every page. When there's more than one, the shortcut becomes ambiguous and users lose the anchor point entirely.",
    goodExample: "<body><header>…</header><main>…</main><footer>…</footer></body>",
    badExample: '<body><header>…</header><div class="content">…</div><footer>…</footer></body>',
    normativeQuote:
      "Information, structure, and relationships conveyed through presentation can be programmatically determined.",
    references: [
      "https://www.w3.org/TR/WCAG22/#info-and-relationships",
      "https://www.w3.org/WAI/ARIA/apg/patterns/landmarks/examples/main.html",
    ],
  },
  afterFile(ctx) {
    if (ctx.language !== "html") return;
    const doc = ctx.ast as HtmlDocument;
    // Only evaluate full documents — a fragment without <body> is
    // probably a component template, not a page.
    const bodies = findHtmlElementsByTag(doc, "body");
    if (bodies.length === 0) return;
    // Only flag on documents that look like real pages — skip
    // minimal documents (e.g. email templates, OG meta shells,
    // and test fixtures for other rules) that have no landmark
    // structure at all. The heuristic: a page has at least one
    // other landmark-ish element (header/nav/footer) or several
    // top-level block children.
    if (!looksLikeFullPage(bodies[0] as HtmlElement, doc)) return;

    const mains: HtmlElement[] = [];
    for (const el of walkHtmlElements(doc)) {
      if (isMainLandmark(el)) mains.push(el);
    }

    if (mains.length === 0) {
      const body = bodies[0];
      ctx.emit({
        severity: "warning",
        location: {
          filePath: "",
          line: body?.loc.start.line ?? 1,
          column: body?.loc.start.column ?? 1,
        },
        message:
          "Document has no <main> landmark. Screen-reader users expect exactly one main landmark per page.",
        suggestion:
          'Wrap the primary content in a <main> element (or add role="main" to the wrapper). <main> should contain what\'s unique to this page — not the header, navigation, sidebar, or footer.',
      });
      return;
    }

    if (mains.length > 1) {
      // Report on every extra main so the fix is unambiguous.
      for (let i = 1; i < mains.length; i += 1) {
        const extra = mains[i];
        if (!extra) continue;
        ctx.emit({
          severity: "warning",
          location: {
            filePath: "",
            line: extra.loc.start.line,
            column: extra.loc.start.column,
          },
          message: `Document has ${mains.length} <main> landmarks — ARIA requires exactly one per page.`,
          suggestion:
            "Keep one <main> and demote the others to <section> or <article>. If the duplicates come from a layout and a page component, move the <main> up to the layout and out of the pages.",
        });
      }
    }
  },
});

function isMainLandmark(el: HtmlElement): boolean {
  if (el.tagName.toLowerCase() === "main") return true;
  const role = getHtmlAttribute(el, "role");
  return role !== null && role.toLowerCase() === "main";
}

// A page "looks like a page" when the author has already reached
// for structural landmarks — header, nav, footer, or aside. If the
// document is just content (headings + paragraphs + images), we
// don't have enough signal to demand `<main>` and would produce
// noise on email templates, minimal test fixtures, and snippets.
const LANDMARK_TAGS: ReadonlySet<string> = new Set(["header", "nav", "footer", "aside"]);

function looksLikeFullPage(_body: HtmlElement, doc: HtmlDocument): boolean {
  for (const el of walkHtmlElements(doc)) {
    if (LANDMARK_TAGS.has(el.tagName.toLowerCase())) return true;
  }
  return false;
}
