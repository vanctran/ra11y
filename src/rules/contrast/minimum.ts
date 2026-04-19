/**
 * Rule: contrast/minimum
 * Satisfies: wcag22:1.4.3, wcag21:1.4.3
 * Spec: https://www.w3.org/TR/WCAG22/#contrast-minimum
 *
 * > The visual presentation of text and images of text has a contrast
 * > ratio of at least 4.5:1, except for the following:
 * >   - Large Text: Large-scale text and images of large-scale text
 * >     have a contrast ratio of at least 3:1.
 * >   - Incidental: Text or images of text that are part of an inactive
 * >     user interface component, pure decoration, not visible to anyone,
 * >     or part of a picture that contains significant other visual
 * >     content, have no contrast requirement.
 * >   - Logotypes: Text that is part of a logo or brand name has no
 * >     minimum contrast requirement.
 *
 * Source: https://www.w3.org/TR/WCAG22/#contrast-minimum
 *
 * This rule walks CSS rules looking for pairs of `color` and
 * background-color / background declarations that both resolve to
 * concrete color values (hex, rgb(), hsl(), or one of the 18 named
 * colors we recognize). For each pair, it computes the contrast
 * ratio against WCAG's relative-luminance formula and flags pairs
 * that fail 4.5:1 for normal text or 3:1 for large text.
 *
 * The walker + color extraction + large-text heuristic live in
 * `./_shared.ts` and are reused by `contrast/enhanced` (AAA).
 *
 * `couldBeWrongBecause` opt-in (project scope): when a scanned JSX
 * or HTML consumer carries the CSS failure's class token AND a
 * `text-*` / `bg-*` Tailwind utility on the same element, the finding
 * is tagged `tailwind_class_on_consumer`. Informational only — the
 * agent reads the consumer file and decides whether the consumer-site
 * utility actually overrides the declared color. See
 * docs/adr/0009-violation-could-be-wrong-because.md.
 *
 * v0.0.x coverage: in-file CSS rules (standalone .css and <style>
 * blocks). Does NOT yet resolve inherited styles or CSS custom
 * properties — those land in Phase 5 polish with the theme resolver.
 */

import { defineRule } from "../../api/plugin.ts";
import type { CssStylesheet } from "../../types/ast.ts";
import type { EmittedViolation, ProjectContext } from "../../types/rule.ts";
import { WCAG_AA_MIN_LARGE, WCAG_AA_MIN_NORMAL } from "../../utils/contrast.ts";
import {
  buildContrastMessage,
  buildContrastSuggestion,
  collectTailwindOverrideClasses,
  extractPrimarySelectorClass,
  findContrastFailures,
  TAILWIND_CLASS_ON_CONSUMER,
} from "./_shared.ts";

const SC_LABEL = "WCAG 1.4.3 AA";

export const rule = defineRule({
  id: "contrast/minimum",
  satisfies: ["wcag22:1.4.3", "wcag21:1.4.3"],
  severity: "error",
  scope: "project",
  fixClass: "guidance",
  // Kept for per-rule coverage telemetry — the canonical Tailwind
  // pre-build acute case (0 eligible CSS files → low-confidence
  // signal) still applies. The rule itself runs in `afterProject`, so
  // the per-file runner never invokes it, but the runner threads every
  // rule's extension gate through the evaluation tracker.
  appliesTo: {
    fileExtensions: [".css"],
  },
  docs: {
    description:
      "Text must have a contrast ratio of at least 4.5:1 against its background (3:1 for large text).",
    rationale:
      "People with moderately low vision (common among older adults) need high contrast to read text. The 4.5:1 minimum compensates for the loss of contrast sensitivity that about 20% of the population experiences by age 80.",
    goodExample: ".button { color: #ffffff; background-color: #2b6cb0; }  /* ratio 6.3:1 */",
    badExample: ".button { color: #ffffff; background-color: #90caf9; }  /* ratio 1.9:1 */",
    normativeQuote:
      "The visual presentation of text and images of text has a contrast ratio of at least 4.5:1, except for large text, incidental text, and logotypes.",
    references: [
      "https://www.w3.org/TR/WCAG22/#contrast-minimum",
      "https://www.w3.org/WAI/WCAG22/Techniques/general/G18",
    ],
  },
  afterProject(ctx) {
    const overrideClasses = collectTailwindOverrideClasses(ctx);
    for (const file of ctx.files) {
      if (file.language !== "css") continue;
      const failures = findContrastFailures(file.ast as CssStylesheet, {
        minNormal: WCAG_AA_MIN_NORMAL,
        minLarge: WCAG_AA_MIN_LARGE,
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
    severity: "error",
    location: { filePath, line: finding.line, column: finding.column },
    message: buildContrastMessage(finding, SC_LABEL),
    suggestion: buildContrastSuggestion(finding),
    // Conditional spread — `couldBeWrongBecause: []` would be a
    // dishonest empty-vs-unpopulated sentinel per CLAUDE.md §1.
    ...(tailwindOverride ? { couldBeWrongBecause: [TAILWIND_CLASS_ON_CONSUMER] } : {}),
  };
  ctx.emit(emitted);
}
