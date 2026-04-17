/**
 * spa-shell-vite — guard that wcag22:2.4.5 candidates on a Vite-style
 * SPA index shell carry the "SPA index shell" reason enrichment
 * introduced in commit bc3aae4.
 *
 * Before that commit the Multiple Ways finder surfaced a plain
 * wcag22:2.4.5 candidate pointing at index.html with no contextual
 * hint, causing agents to treat the mount-point HTML as the fix
 * location instead of redirecting to the client-side router config.
 *
 * The assertion locks in the reason-text enrichment: the candidate
 * must still surface (no suppression), and its reason must include
 * the "SPA index shell" substring that redirects the agent.
 */

import type { FixtureAssertions } from "../runner.ts";

export const assertions: FixtureAssertions = {
  description:
    "Vite-style SPA index shell (div#root + module script) produces a wcag22:2.4.5 candidate whose reason includes the SPA index shell annotation, not a bare missing-nav diagnosis.",
  origin: {
    commit: "bc3aae4",
    notes:
      "Leela feedback: 2.4.5 candidate was pinned to the Vite index.html with no hint that navigation lives in the React router config. The fix enriches reason text; this fixture guards the enrichment.",
  },
  expectations: [
    { kind: "zero-parse-errors" },
    {
      kind: "candidate-present",
      criterionId: "wcag22:2.4.5",
      reasonIncludes: "SPA index shell",
    },
  ],
};
