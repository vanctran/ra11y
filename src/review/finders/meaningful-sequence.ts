/**
 * Candidate finder: review/meaningful-sequence
 * Criteria: wcag22:1.3.2, wcag21:1.3.2
 * Spec: https://www.w3.org/TR/WCAG22/#meaningful-sequence
 *
 * Finds CSS rules that reorder visual presentation relative to DOM order.
 * Properties like `order`, `flex-direction: row-reverse`, and
 * `flex-direction: column-reverse` can break the meaningful reading
 * sequence for assistive technology users.
 */

import { defineCandidateFinder } from "../../api/plugin.ts";
import { findCssDeclaration, walkCssRules } from "../../engine/ast-helpers.ts";
import type { CssStylesheet } from "../../types/ast.ts";
import type { ReviewCandidate } from "../../types/review.ts";

const CRITERION_IDS = ["wcag22:1.3.2", "wcag21:1.3.2"] as const;

const REVERSE_VALUES = new Set(["row-reverse", "column-reverse"]);

export const finder = defineCandidateFinder({
  id: "review/meaningful-sequence",
  criterionIds: [...CRITERION_IDS],
  scope: "node",
  appliesTo: { fileExtensions: [".css"] },
  docs: {
    description:
      "Finds CSS rules that visually reorder content (order, flex-direction reverse) which may break meaningful reading sequence.",
    reviewPrompt:
      "Verify that the visual order created by CSS still matches the meaningful reading sequence in the DOM.",
    references: ["https://www.w3.org/TR/WCAG22/#meaningful-sequence"],
  },
  find(ctx) {
    const candidates: ReviewCandidate[] = [];

    if (ctx.language !== "css") return candidates;

    const root = ctx.ast as CssStylesheet;

    for (const rule of walkCssRules(root)) {
      const orderDecl = findCssDeclaration(rule, "order");
      if (orderDecl) {
        for (const criterionId of CRITERION_IDS) {
          // Confidence "high": `order` and `flex-direction: *-reverse`
          // are deterministic CSS properties whose effect on visual
          // order is unambiguous. The reviewer question is whether
          // the reordering matches meaning, not whether it happened.
          candidates.push({
            criterionId,
            location: {
              filePath: ctx.filePath,
              line: orderDecl.loc.start.line,
              column: orderDecl.loc.start.column,
            },
            reason:
              "CSS `order` property reorders visual layout -- verify reading sequence matches DOM order",
            confidence: "high",
          });
        }
      }

      const flexDecl = findCssDeclaration(rule, "flex-direction");
      if (flexDecl && REVERSE_VALUES.has(flexDecl.value.trim().toLowerCase())) {
        for (const criterionId of CRITERION_IDS) {
          candidates.push({
            criterionId,
            location: {
              filePath: ctx.filePath,
              line: flexDecl.loc.start.line,
              column: flexDecl.loc.start.column,
            },
            reason:
              "CSS `flex-direction` reverses visual layout -- verify reading sequence matches DOM order",
            confidence: "high",
          });
        }
      }
    }

    return candidates;
  },
});
