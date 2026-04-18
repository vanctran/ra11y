/**
 * jsdoc-intentional-tag — guards the Q2R2-INTENTIONAL feature
 * (honor `/** @ra11y-intentional <reason> *\/` JSDoc tag as a scoped
 * disable over the decorated declaration's body).
 *
 * The fixture exercises three invariants:
 *
 *   1. The tag is recognised and populates a `meta.suppressions` entry
 *      with `tag: "ra11y-intentional"`, `kind: "disable"`, the JSDoc
 *      block's line number, wildcard `ruleIds: ["*"]`, and the captured
 *      reason text.
 *   2. Non-decorated declarations in the same file still surface their
 *      violations — `CleanComponent` below has a bare `<img>` and the
 *      scanner must still emit `media/alt-text-missing` for it. This
 *      guards that the tag's scope is limited to the decorated
 *      declaration, not the whole file.
 *   3. The file parses without errors — the JSDoc syntax cannot trip
 *      the TSX parser.
 *
 * Note: the real-world harness (runner.ts) parses files WITHOUT
 * populating `disableMap`, so the `result.violations` list sees the
 * raw unsuppressed findings. That is documented behaviour — full
 * end-to-end suppression execution is covered by
 * `tests/unit/config/inline-disables.test.ts`. This fixture guards the
 * audit-trail surface (meta.suppressions + tag) that agents read from
 * scan_project.
 */

import type { FixtureAssertions } from "../runner.ts";

export const assertions: FixtureAssertions = {
  description:
    "A Storybook-style 'bad example' component tagged with `/** @ra11y-intentional <reason> */` " +
    "produces a meta.suppressions entry with tag='ra11y-intentional' and the captured reason, " +
    "while non-decorated declarations in the same file still surface their violations. Guards " +
    "Q2R2-INTENTIONAL (JSDoc variant of the ra11y-disable pragma).",
  origin: {
    notes:
      "Q2R2-INTENTIONAL (round 2, agent 4). The JSDoc tag is functionally a file-scoped " +
      "`ra11y-disable *` pragma limited to the decorated declaration's JSX subtree. Required " +
      "reason — bare tags are NOT honored, per AI-first doctrine 'Ambiguous field shapes are " +
      "dishonest'.",
  },
  expectations: [
    // Parser must handle the JSDoc tag cleanly. A parse error would
    // mean the JSDoc syntax tripped the TSX parser.
    { kind: "zero-parse-errors" },

    // meta.suppressions must be present when any file has pragmas or
    // JSDoc intentional tags. Absence would mean the JSDoc variant
    // isn't being recorded in the audit trail.
    {
      kind: "meta-field",
      path: ["suppressions"],
      predicate: "present",
    },

    // Exactly one declaration — the single `@ra11y-intentional` tag on
    // BadImageExample. If this count drifts the parser is either
    // double-counting or mis-scoping.
    {
      kind: "meta-field-length",
      path: ["suppressions"],
      predicate: { equals: 1 },
    },

    // Full shape of the entry. Line 8 is the JSDoc block's `/**`.
    // ruleIds wildcard + reason captured + tag spelled exactly
    // "ra11y-intentional" so consumers can differentiate from regular
    // `ra11y-disable` pragmas.
    {
      kind: "meta-field",
      path: ["suppressions", "0"],
      predicate: {
        equals: {
          path: "BadExample.tsx",
          line: 8,
          kind: "disable",
          ruleIds: ["*"],
          reason: "demo of missing alt attribute on image",
          tag: "ra11y-intentional",
        },
      },
    },

    // CleanComponent's violation must still fire. The scanner sees the
    // raw `<img src="/ok/chart.png" />` without an alt attribute, so
    // media/alt-text-missing must be present in result.violations.
    // This is the "scope is limited" guard — if the JSDoc tag
    // accidentally silenced the whole file, this expectation would
    // fail.
    { kind: "violation-present", ruleId: "media/alt-text-missing" },
  ],
};
