/**
 * opaque-components-top — guards commit 0ee28e1
 * (feat(mcp): surface top-N opaque components inline with call-site counts).
 *
 * Commit 0ee28e1 replaced the flat Set<string> accumulator with a
 * Map<string, { callSites, interactive }> so the coverage block can
 * surface `opaqueCustomComponentsTop` — up to 5 entries ranked by JSX
 * call-site count — without requiring `verboseMeta: true`.
 *
 * The fixture has 11 distinct PascalCase components with deliberately
 * unequal call-site counts so the top-5 cap and the ranking are both
 * observable:
 *
 *   Button  x12 → rank 1   (must appear in top 5)
 *   Card    x8  → rank 2   (must appear in top 5)
 *   Modal   x6  → rank 3   (must appear in top 5)
 *   Tooltip x5  → rank 4   (must appear in top 5)
 *   Avatar  x3  → rank 5   (must appear in top 5)
 *   Badge   x2  → rank 6   (must NOT appear — cap at 5)
 *   Banner  x1  → rank 7+  (must NOT appear)
 *   Popover x1  → rank 7+
 *   Sheet   x1  → rank 7+
 *   Toast   x1  → rank 7+
 *   Dialog  x1  → rank 7+
 *
 * All call sites carry onClick so the interactive filter keeps every
 * component in the ranking (non-interactive components are structurally
 * excluded from opaqueCustomComponentsTop even at high call counts).
 *
 * Live meta evidence (bun probe run 2026-04-16, fixture source):
 *   meta.analysisCoverage.opaqueCustomComponents == 11
 *   meta.analysisCoverage.opaqueCustomComponentsTop == [
 *     { name: "Button",  callSites: 12 },
 *     { name: "Card",    callSites: 8  },
 *     { name: "Modal",   callSites: 6  },
 *     { name: "Tooltip", callSites: 5  },
 *     { name: "Avatar",  callSites: 3  },
 *   ]
 *   top.length == 5  (cap enforced — Badge/Banner/... absent)
 */

import type { FixtureAssertions } from "../runner.ts";

export const assertions: FixtureAssertions = {
  description:
    "11 opaque PascalCase components with varied call-site counts produce " +
    "meta.analysisCoverage.opaqueCustomComponentsTop with length exactly 5 " +
    "(cap enforced), ranked highest-count-first, with Button (12 call sites) " +
    "at position 0 and the six lowest-count components absent.",
  origin: {
    commit: "0ee28e1",
    notes:
      "feat(mcp): surface top-N opaque components inline with call-site counts. " +
      "Before this commit the coverage block only had opaqueCustomComponents (a raw " +
      "count). After, opaqueCustomComponentsTop carries up to 5 ranked entries inline " +
      "so the agent sees which wrappers matter without a verboseMeta round trip.",
  },
  expectations: [
    // The component definition files and App.tsx must all parse cleanly.
    { kind: "zero-parse-errors" },

    // The total opaque count must be present — guards that the accumulator
    // did not regress to the old Set<string> shape that dropped counts.
    {
      kind: "meta-field",
      path: ["analysisCoverage", "opaqueCustomComponents"],
      predicate: { equals: 11 },
    },

    // The top list must be present. Absence means 0ee28e1 regressed.
    {
      kind: "meta-field",
      path: ["analysisCoverage", "opaqueCustomComponentsTop"],
      predicate: "present",
    },

    // The cap: 11 components but only ≤5 surfaced inline.
    // Uses the meta-field-length primitive added alongside this fixture.
    {
      kind: "meta-field-length",
      path: ["analysisCoverage", "opaqueCustomComponentsTop"],
      predicate: { max: 5 },
    },

    // The cap floor: at least 1 entry (guards against an empty list
    // masquerading as "present").
    {
      kind: "meta-field-length",
      path: ["analysisCoverage", "opaqueCustomComponentsTop"],
      predicate: { min: 1 },
    },

    // Ranking: Button (12 call sites) must be first entry.
    // Guards that the list is sorted by count desc, not alphabetically.
    // Uses equals on the full first-entry object so name + callSites
    // are both asserted — a refactor that drops callSites from entries
    // would break this.
    {
      kind: "meta-field",
      path: ["analysisCoverage", "opaqueCustomComponentsTop", "0"],
      predicate: { equals: { name: "Button", callSites: 12 } },
    },

    // Ranking: Avatar (3 call sites) must be fifth entry — last in the
    // cap window. Guards the boundary between "in top 5" and "excluded".
    {
      kind: "meta-field",
      path: ["analysisCoverage", "opaqueCustomComponentsTop", "4"],
      predicate: { equals: { name: "Avatar", callSites: 3 } },
    },

    // The hints block must surface the opaque-wrapper nudge. The hint
    // uses the same ranked entries as opaqueCustomComponentsTop so if
    // the top list regresses to alphabetical the hint examples do too —
    // guarding both in one assertion.
    {
      kind: "meta-hint-includes",
      substring: "Button (12 call sites)",
    },
  ],
};
