/**
 * tailwind-coverage — guards commit 4700a13 (feat(mcp):
 * tailwind-aware CSS coverage hint).
 *
 * When a project has many JSX/TSX files and zero CSS files, the
 * thin-CSS-coverage hint fires. If Tailwind utility classes are
 * detected in any className attribute, the hint is strengthened to
 * name the exact `additionalPaths: ["dist/assets"]` invocation instead
 * of the generic "build and point scan at .css" message.
 *
 * This fixture encodes 41 TSX files with varied Tailwind utility-class
 * patterns (responsive variants, dark-mode, arbitrary values, state
 * variants) and zero CSS files. The two assertions lock in:
 *   1. The "Tailwind usage detected" phrase — if the detector regresses,
 *      the hint falls back to the generic form and this fails.
 *   2. The "dist/assets" mention — if the actionable follow-up is
 *      dropped or rephrased to omit the concrete flag value, this fails.
 *
 * Live meta evidence (bun scratch run 2026-04-16):
 *   meta.analysisCoverage.hints[0] ==
 *   "Only 0 CSS file(s) scanned vs 41 JSX/HTML file(s). Post-compile
 *    output (Tailwind, CSS-in-JS, SCSS) isn't parsed — color-contrast
 *    and focus-visible coverage may be undercounted. Tailwind usage
 *    detected: run the build, then re-run scan_project with
 *    `additionalPaths: [\"dist/assets\"]` (or wherever your bundler
 *    emits CSS) to include the generated stylesheet. ..."
 */

import type { FixtureAssertions } from "../runner.ts";

export const assertions: FixtureAssertions = {
  description:
    "41 TSX files with Tailwind utility classes and zero CSS files produce a meta hint that names 'Tailwind usage detected' and the concrete additionalPaths suggestion including 'dist/assets'.",
  origin: {
    commit: "4700a13",
    notes:
      "feat(mcp): tailwind-aware CSS coverage hint. Before this commit the thin-CSS hint was generic; after, Tailwind detection strengthens it to name the exact additionalPaths invocation, saving the agent a discovery round trip.",
  },
  expectations: [
    { kind: "zero-parse-errors" },
    { kind: "meta-hint-includes", substring: "Tailwind usage detected" },
    { kind: "meta-hint-includes", substring: "dist/assets" },
  ],
};
