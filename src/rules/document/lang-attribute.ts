/**
 * Rule: document/lang-attribute
 * Satisfies: wcag22:3.1.1, wcag21:3.1.1
 * Spec: https://www.w3.org/TR/WCAG22/#language-of-page
 *
 * > The default human language of each web page can be programmatically
 * > determined.
 *
 * Source: https://www.w3.org/TR/WCAG22/#language-of-page
 *
 * Flags HTML documents whose <html> element is missing a non-empty
 * `lang` attribute. Screen readers switch pronunciation dictionaries
 * based on this attribute; without it, English content read with a
 * Japanese voice (or vice versa) is unintelligible.
 */

import { defineRule } from "../../api/plugin.ts";
import { findHtmlElementsByTag, getHtmlAttribute } from "../../engine/ast-helpers.ts";
import type { HtmlDocument } from "../../types/ast.ts";

export const rule = defineRule({
  id: "document/lang-attribute",
  satisfies: ["wcag22:3.1.1", "wcag21:3.1.1"],
  severity: "error",
  scope: "document",
  appliesTo: {
    fileExtensions: [".html", ".htm"],
  },
  docs: {
    description:
      "HTML documents must declare their primary language via a non-empty lang attribute on <html>.",
    rationale:
      "Screen readers and translation tools rely on the lang attribute to pick the right pronunciation dictionary and voice. A missing or empty lang attribute makes English content announced with a Japanese voice (or vice versa) unintelligible.",
    goodExample: `<html lang="en">`,
    badExample: `<html>`,
    normativeQuote:
      "The default human language of each web page can be programmatically determined.",
    references: [
      "https://www.w3.org/TR/WCAG22/#language-of-page",
      "https://www.w3.org/WAI/WCAG22/Techniques/html/H57",
    ],
  },
  afterFile(ctx) {
    if (ctx.language !== "html") return;
    const doc = ctx.ast as HtmlDocument;
    const htmlElements = findHtmlElementsByTag(doc, "html");
    // If there's no <html> element, we're looking at a fragment — not
    // our concern. The page-titled rule handles the "no root" case
    // separately.
    if (htmlElements.length === 0) return;
    const htmlEl = htmlElements[0];
    if (!htmlEl) return;

    const lang = getHtmlAttribute(htmlEl, "lang");
    const xmlLang = getHtmlAttribute(htmlEl, "xml:lang");
    if (lang !== null && lang.trim().length > 0) return;
    if (xmlLang !== null && xmlLang.trim().length > 0) return;

    ctx.emit({
      severity: "error",
      location: {
        filePath: "",
        line: htmlEl.loc.start.line,
        column: htmlEl.loc.start.column,
      },
      message:
        lang === null
          ? "<html> element is missing the lang attribute — screen readers won't know how to pronounce the page content."
          : "<html lang> is empty — screen readers won't know how to pronounce the page content.",
      suggestion:
        'Add a lang attribute matching the primary language of the page, e.g. lang="en" for English or lang="ja" for Japanese. Use a valid BCP 47 code.',
    });
  },
});
