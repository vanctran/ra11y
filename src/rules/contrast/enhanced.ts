/**
 * Rule: contrast/enhanced
 * Satisfies: wcag22:1.4.6, wcag21:1.4.6
 * Spec: https://www.w3.org/TR/WCAG22/#contrast-enhanced
 *
 * > The visual presentation of text and images of text has a
 * > contrast ratio of at least 7:1, except for the following:
 * >   - Large Text: 4.5:1 minimum
 * >   - Incidental: no requirement
 * >   - Logotypes: no requirement
 *
 * Structurally identical to `contrast/minimum` — same walker, same
 * color extraction, same large-text heuristic, same cross-file
 * Tailwind `couldBeWrongBecause` opt-in — only the thresholds differ
 * (7:1 / 4.5:1 instead of 4.5:1 / 3:1). Shared logic lives in
 * `./_shared.ts`.
 *
 * Severity is `warning` (not `error`) because AAA is aspirational;
 * most public-facing sites target AA. Users who want this gated
 * hard in CI bump it via ra11y.config.ts.
 */

import { defineRule } from "../../api/plugin.ts";
import type { CssStylesheet } from "../../types/ast.ts";
import type { EmittedViolation, ProjectContext } from "../../types/rule.ts";
import { WCAG_AAA_MIN_LARGE, WCAG_AAA_MIN_NORMAL } from "../../utils/contrast.ts";
import {
  buildContrastMessage,
  buildContrastSuggestion,
  collectTailwindOverrideClasses,
  extractPrimarySelectorClass,
  findContrastFailures,
  TAILWIND_CLASS_ON_CONSUMER,
} from "./_shared.ts";

const SC_LABEL = "WCAG 1.4.6 AAA";

export const rule = defineRule({
  id: "contrast/enhanced",
  satisfies: ["wcag22:1.4.6", "wcag21:1.4.6"],
  severity: "warning",
  scope: "project",
  fixClass: "guidance",
  // Kept for per-rule coverage telemetry — mirrors `contrast/minimum`.
  // The rule runs in `afterProject`; the per-file runner never invokes
  // it, but it threads every rule's extension gate through the
  // evaluation tracker.
  appliesTo: {
    fileExtensions: [".css"],
  },
  docs: {
    description:
      "Text must have a contrast ratio of at least 7:1 against its background (4.5:1 for large text) — WCAG 1.4.6 AAA.",
    rationale:
      "People with moderate low vision benefit from 4.5:1, but people with more substantial vision loss (roughly 20/200 or worse) need the 7:1 AAA threshold to read comfortably. Government and accessibility-critical public-facing sites often target AAA for body text.",
    goodExample: ".button { color: #ffffff; background-color: #1a202c; }  /* ratio 14.5:1 */",
    badExample: ".button { color: #ffffff; background-color: #4a5568; }  /* ratio 5.1:1 */",
    normativeQuote:
      "The visual presentation of text and images of text has a contrast ratio of at least 7:1, except for large text, incidental text, and logotypes.",
    references: [
      "https://www.w3.org/TR/WCAG22/#contrast-enhanced",
      "https://www.w3.org/WAI/WCAG22/Techniques/general/G17",
    ],
  },
  afterProject(ctx) {
    const overrideClasses = collectTailwindOverrideClasses(ctx);
    for (const file of ctx.files) {
      if (file.language !== "css") continue;
      const failures = findContrastFailures(file.ast as CssStylesheet, {
        minNormal: WCAG_AAA_MIN_NORMAL,
        minLarge: WCAG_AAA_MIN_LARGE,
        scLabel: SC_LABEL,
      });
      for (const finding of failures) {
        emitFinding(ctx, file.filePath, finding, overrideClasses);
      }
    }
  },
});

function emitFinding(
  ctx: ProjectContext,
  filePath: string,
  finding: ReturnType<typeof findContrastFailures>[number],
  overrideClasses: ReadonlySet<string>,
): void {
  const primaryClass = extractPrimarySelectorClass(finding.selector);
  const tailwindOverride = primaryClass !== null && overrideClasses.has(primaryClass);
  const emitted: EmittedViolation = {
    severity: "warning",
    location: { filePath, line: finding.line, column: finding.column },
    message: buildContrastMessage(finding, SC_LABEL),
    suggestion: buildContrastSuggestion(finding),
    // Conditional spread — `couldBeWrongBecause: []` would be a
    // dishonest empty-vs-unpopulated sentinel per CLAUDE.md §1.
    ...(tailwindOverride ? { couldBeWrongBecause: [TAILWIND_CLASS_ON_CONSUMER] } : {}),
  };
  ctx.emit(emitted);
}
