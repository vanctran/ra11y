/**
 * logotype-annotation — guards commit 71b9954 (feat(review): annotate
 * 1.4.5 logo candidates with the logotype exemption).
 *
 * When an <img>'s className or src filename contains the keyword "logo",
 * the review candidate for wcag22:1.4.5 (AA, Images of Text) receives a
 * trailing reason hint naming the logotype exemption. The candidate for
 * wcag22:1.4.9 (AAA, Images of Text No Exception) must NOT receive that
 * hint — the AAA variant explicitly removes the logotype exemption.
 *
 * Both criteria still SURFACE a candidate (never suppressed — per CLAUDE.md
 * § 1 "No heuristic suppression, even for spec carve-outs"). Only the
 * reason text differs asymmetrically.
 *
 * Live scan evidence (bun scratch run 2026-04-16):
 *   wcag22:1.4.5 reason:
 *     "<img> class suggests "logo" artwork — verify text is not baked into
 *      the image when equivalent styled HTML text could be used — if this
 *      is a logo or brand mark, WCAG 1.4.5 has a logotype exemption
 *      (essential presentation); the AAA "no exception" variant (1.4.9)
 *      still applies"
 *
 *   wcag22:1.4.9 reason:
 *     "<img> class suggests "logo" artwork — verify text is not baked into
 *      the image when equivalent styled HTML text could be used"
 *      [no logotype exemption mention]
 *
 * This fixture covers two class-name variants: className="site-logo"
 * (HomePage.tsx) and className="logo" (NavBar.tsx).
 */

import type { FixtureAssertions } from "../runner.ts";

export const assertions: FixtureAssertions = {
  description:
    "Logo images with className='site-logo' and className='logo' produce a " +
    "wcag22:1.4.5 candidate whose reason names the logotype exemption, while " +
    "the wcag22:1.4.9 candidate (AAA, no exception) is present but its reason " +
    "does NOT mention the exemption — guarding the asymmetric annotation " +
    "introduced in commit 71b9954.",
  origin: {
    commit: "71b9954",
    notes:
      "feat(review): annotate 1.4.5 logo candidates with the logotype exemption. " +
      "Per CLAUDE.md § 1, logos are never suppressed — only the reason text is " +
      "enriched for 1.4.5. The AAA variant 1.4.9 must NOT receive the hint because " +
      "WCAG 1.4.9 removes the logotype exemption that 1.4.5 provides.",
  },
  expectations: [
    { kind: "zero-parse-errors" },

    // wcag22:1.4.5 (AA) — logotype exemption hint MUST be present
    {
      kind: "candidate-present",
      criterionId: "wcag22:1.4.5",
      reasonIncludes: "logotype exemption",
    },

    // wcag22:1.4.9 (AAA, no exception) — candidate MUST exist but reason
    // must NOT carry the logotype exemption phrase. The AAA variant
    // removes the logotype exception, so the hint would be misleading.
    {
      kind: "candidate-present-without",
      criterionId: "wcag22:1.4.9",
      reasonExcludes: "logotype exemption",
    },
  ],
};
