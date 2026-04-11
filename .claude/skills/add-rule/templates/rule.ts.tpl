/**
 * Rule: {{domain}}/{{slug}}
 * Satisfies: {{satisfies}}
 * Spec: {{specUrl}}
 *
 * {{normativeQuote}}
 *
 * Source: {{specUrl}}
 */
import { defineRule } from "@/api/plugin";
import type { Violation } from "@/types/violation";

export const rule = defineRule({
  id: "{{domain}}/{{slug}}",
  satisfies: [{{satisfiesArray}}],
  severity: "{{severity}}",
  scope: "{{scope}}",
  appliesTo: {
    nodeTypes: [{{nodeTypes}}],
    fileExtensions: [{{fileExtensions}}],
  },
  docs: {
    description: "{{description}}",
    rationale: "{{rationale}}",
    goodExample: `{{goodExample}}`,
    badExample: `{{badExample}}`,
    normativeQuote: `{{normativeQuote}}`,
    references: [
      "{{specUrl}}",
      // Add WAI techniques or related SC here.
    ],
  },
  check(ctx) {
    const violations: Violation[] = [];
    // TODO: walk ctx.ast using helpers from src/engine/ast-helpers.ts.
    // Do NOT hand-walk the AST — extend ast-helpers if you need a new primitive.
    //
    // For each offending node, ctx.emit({
    //   severity: "{{severity}}",
    //   location: { filePath: ctx.filePath, line, column },
    //   message: "<one-sentence description of the problem>",
    //   suggestion: "<context-aware fix based on surrounding nodes>",
    //   snippet: "<code excerpt>",
    // });
    return violations;
  },
});
