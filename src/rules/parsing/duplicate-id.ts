/**
 * Rule: parsing/duplicate-id
 * Satisfies: wcag22:4.1.1, wcag21:4.1.1
 * Spec: https://www.w3.org/TR/WCAG22/#parsing
 *
 * > In content implemented using markup languages, elements have complete
 * > start and end tags, are nested according to specifications, do not
 * > contain duplicate attributes, and IDs are unique, except where the
 * > specifications allow these features.
 *
 * Note: WCAG 2.2 marks 4.1.1 Parsing as "obsolete — always satisfies"
 * because modern HTML parsers recover from these errors. We still ship
 * this rule because:
 *   1. WCAG 2.1 Level A still requires it — many legal frameworks
 *      (Section 508, EN 301 549) reference 2.1.
 *   2. Duplicate IDs cause real runtime bugs — aria-labelledby and
 *      aria-describedby targets become ambiguous, label[for] targets
 *      become ambiguous, document.getElementById returns only the
 *      first match, and anchor-link navigation is undefined.
 *
 * Walks an HTML document collecting every `id=…` value, then emits
 * a violation at every occurrence after the first. Document-scoped.
 */

import { defineRule } from "../../api/plugin.ts";
import { getHtmlAttribute, walkHtmlElements } from "../../engine/ast-helpers.ts";
import type { HtmlDocument, HtmlElement } from "../../types/ast.ts";

export const rule = defineRule({
  id: "parsing/duplicate-id",
  satisfies: ["wcag22:4.1.1", "wcag21:4.1.1"],
  severity: "error",
  scope: "document",
  appliesTo: {
    fileExtensions: [".html", ".htm"],
  },
  docs: {
    description:
      "Element IDs must be unique within a document. Duplicate IDs break aria-labelledby, label associations, and anchor navigation.",
    rationale:
      "Screen readers and browsers use element IDs to resolve aria-labelledby, aria-describedby, label[for], and anchor-link targets. When two elements share an ID, the resolution is undefined — getElementById returns only the first match, so the accessible name, description, or label of the second element is lost.",
    goodExample: `<input id="email"> <label for="email">Email</label>`,
    badExample: `<input id="email"> <input id="email">`,
    normativeQuote:
      "In content implemented using markup languages, IDs are unique, except where the specifications allow these features.",
    references: [
      "https://www.w3.org/TR/WCAG21/#parsing",
      "https://www.w3.org/WAI/WCAG21/Techniques/general/F77",
    ],
  },
  afterFile(ctx) {
    if (ctx.language !== "html") return;
    const doc = ctx.ast as HtmlDocument;
    const seen = new Map<string, HtmlElement>();

    for (const element of walkHtmlElements(doc)) {
      const id = getHtmlAttribute(element, "id");
      if (!id || id.length === 0) continue;
      const first = seen.get(id);
      if (!first) {
        seen.set(id, element);
        continue;
      }
      ctx.emit({
        severity: "error",
        location: {
          filePath: "",
          line: element.loc.start.line,
          column: element.loc.start.column,
        },
        message: `Duplicate element id="${id}" — first seen on line ${first.loc.start.line}.`,
        suggestion: `Change this <${element.tagName}>'s id to something unique, or remove it if the id wasn't intentional. IDs are referenced by aria-labelledby, label[for], and #-anchors — duplicates break all three.`,
      });
    }
  },
});
