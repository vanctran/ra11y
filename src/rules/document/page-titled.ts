/**
 * Rule: document/page-titled
 * Satisfies: wcag22:2.4.2, wcag21:2.4.2
 * Spec: https://www.w3.org/TR/WCAG22/#page-titled
 *
 * > Web pages have titles that describe topic or purpose.
 *
 * Source: https://www.w3.org/TR/WCAG22/#page-titled
 *
 * Flags HTML documents whose <head> contains no <title> element or
 * whose <title> is empty. Screen readers announce the title first
 * when a page loads — a missing or empty title leaves users unsure
 * what they landed on.
 */

import { defineRule } from "../../api/plugin.ts";
import {
  findHtmlElementsByTag,
  htmlTextContent,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument } from "../../types/ast.ts";

export const rule = defineRule({
  id: "document/page-titled",
  satisfies: ["wcag22:2.4.2", "wcag21:2.4.2"],
  severity: "error",
  scope: "document",
  appliesTo: {
    fileExtensions: [".html", ".htm"],
  },
  docs: {
    description: "HTML documents must have a non-empty <title> element describing topic or purpose.",
    rationale:
      "Screen readers announce the page title when a document loads. A missing or empty title leaves non-sighted users unsure what they've landed on; it also breaks browser tabs, bookmarks, and search engine results.",
    goodExample: `<title>Settings — Acme Dashboard</title>`,
    badExample: `<title></title>`,
    normativeQuote: "Web pages have titles that describe topic or purpose.",
    references: [
      "https://www.w3.org/TR/WCAG22/#page-titled",
      "https://www.w3.org/WAI/WCAG22/Techniques/general/G88",
    ],
  },
  afterFile(ctx) {
    if (ctx.language !== "html") return;
    const doc = ctx.ast as HtmlDocument;
    // Only check complete documents — if there's no <html> root, we're
    // looking at a fragment and it's not meaningful to require a title.
    const htmlElements = findHtmlElementsByTag(doc, "html");
    if (htmlElements.length === 0) return;

    const titles = findHtmlElementsByTag(doc, "title");
    // Ignore <title> elements under <svg> or similar namespaces — those
    // are graphical titles, not document titles. For the HTML parser
    // we don't track namespace, so walk up the ancestor chain via tag
    // name heuristic: a document <title> is inside <head>.
    const docTitles = titles.filter((t) => isInsideHead(doc, t));

    if (docTitles.length === 0) {
      const htmlEl = htmlElements[0];
      ctx.emit({
        severity: "error",
        location: {
          filePath: "",
          line: htmlEl?.loc.start.line ?? 1,
          column: htmlEl?.loc.start.column ?? 1,
        },
        message: "HTML document is missing a <title> element — browsers and screen readers have nothing to announce.",
        suggestion: "Add a <title>…</title> to <head> describing the page topic or purpose. Keep it specific — 'Settings — Acme' is better than 'Acme'.",
      });
      return;
    }

    for (const title of docTitles) {
      const text = htmlTextContent(title);
      if (text.length === 0) {
        ctx.emit({
          severity: "error",
          location: {
            filePath: "",
            line: title.loc.start.line,
            column: title.loc.start.column,
          },
          message: "<title> is empty — screen readers will announce nothing when the page loads.",
          suggestion: "Fill in the title with a specific description of the page topic or purpose, e.g. 'Settings — Acme Dashboard'.",
        });
      }
    }
  },
});

function isInsideHead(doc: HtmlDocument, target: { range: { start: number } }): boolean {
  // Heuristic: does any <head> element's range encompass the target's
  // start offset? In-house HTML parser doesn't track parent pointers,
  // so we use offset containment.
  const heads = findHtmlElementsByTag(doc, "head");
  if (heads.length === 0) return true; // No <head> — treat <title> as document title anyway.
  for (const head of heads) {
    if (head.range.start <= target.range.start && target.range.start <= head.range.end) {
      return true;
    }
  }
  return false;
}
