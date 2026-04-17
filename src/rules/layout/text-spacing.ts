/**
 * Rule: layout/text-spacing
 * Satisfies: wcag22:1.4.12, wcag21:1.4.12
 * Spec: https://www.w3.org/TR/WCAG22/#text-spacing
 *
 * > No loss of content or functionality occurs by setting all of the
 * > following and by changing no other style property:
 * >   - Line height (line spacing) to at least 1.5 times the font size;
 * >   - Spacing following paragraphs to at least 2 times the font size;
 * >   - Letter spacing (tracking) to at least 0.12 times the font size;
 * >   - Word spacing to at least 0.16 times the font size.
 *
 * Source: https://www.w3.org/TR/WCAG22/#text-spacing
 *
 * This rule flags CSS declarations that use `!important` on the four
 * text-spacing properties: `line-height`, `letter-spacing`,
 * `word-spacing`, and `margin-bottom` (paragraph spacing). Using
 * `!important` on these properties prevents user stylesheets from
 * overriding them, which is the primary failure path for SC 1.4.12.
 *
 * Severity is `warning` because `!important` is a smell rather than a
 * guaranteed failure — the author might have a legitimate reason. The
 * rule surfaces the concern for human review.
 */

import { defineRule } from "../../api/plugin.ts";
import { walkCssRules } from "../../engine/ast-helpers.ts";
import type { CssStylesheet } from "../../types/ast.ts";

/** Properties whose `!important` blocks user text-spacing overrides. */
const TEXT_SPACING_PROPERTIES: ReadonlySet<string> = new Set([
  "line-height",
  "letter-spacing",
  "word-spacing",
  "margin-bottom",
]);

export const rule = defineRule({
  id: "layout/text-spacing",
  satisfies: ["wcag22:1.4.12", "wcag21:1.4.12"],
  severity: "warning",
  scope: "document",
  fixClass: "verify-in-source",
  appliesTo: {
    fileExtensions: [".css"],
  },
  docs: {
    description:
      "Text-spacing properties (line-height, letter-spacing, word-spacing, margin-bottom) must not use !important, which prevents users from overriding text spacing to meet their needs.",
    rationale:
      "Users with low vision or cognitive disabilities often need to adjust text spacing to read comfortably. WCAG 1.4.12 requires that content remain readable when users override these four properties. Using !important on them blocks user stylesheets from taking effect, causing content to clip, overlap, or become unreadable.",
    goodExample: `.body {\n  line-height: 1.5;\n  letter-spacing: 0.12em;\n}`,
    badExample: `.body {\n  line-height: 1.2 !important;\n  letter-spacing: 0 !important;\n}`,
    normativeQuote:
      "No loss of content or functionality occurs by setting all of the following and by changing no other style property: Line height to at least 1.5 times the font size; Spacing following paragraphs to at least 2 times the font size; Letter spacing to at least 0.12 times the font size; Word spacing to at least 0.16 times the font size.",
    references: [
      "https://www.w3.org/TR/WCAG22/#text-spacing",
      "https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html",
    ],
  },
  afterFile(ctx) {
    if (ctx.language !== "css") return;
    checkCss(ctx.ast as CssStylesheet, (v) => ctx.emit(v));
  },
});

type Emit = (v: {
  severity: "error" | "warning" | "info";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
}) => void;

function checkCss(stylesheet: CssStylesheet, emit: Emit): void {
  for (const cssRule of walkCssRules(stylesheet)) {
    for (const decl of cssRule.declarations) {
      const prop = decl.property.toLowerCase();
      if (!TEXT_SPACING_PROPERTIES.has(prop)) continue;
      if (!decl.important) continue;
      emit({
        severity: "warning",
        location: {
          filePath: "",
          line: decl.loc.start.line,
          column: decl.loc.start.column,
        },
        message: `'${decl.property}: ${decl.value} !important' in '${cssRule.selector}' blocks user text-spacing overrides required by WCAG 1.4.12 Text Spacing.`,
        suggestion: `Remove !important from '${decl.property}' so users can override it with their own stylesheet. If specificity is the concern, increase selector specificity instead of using !important.`,
      });
    }
  }
}
