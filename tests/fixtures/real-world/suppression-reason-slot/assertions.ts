/**
 * suppression-reason-slot — guards commit d820186 (feat(config): reason
 * slot on ra11y-disable pragmas + audit meta).
 *
 * Commit d820186 introduced the optional `: reason` (colon separator) and
 * `-- reason` (double-dash separator) suffix on every `ra11y-disable*`
 * pragma form. The reason text is:
 *   1. Captured by `parseInlineDisablesDetailed` into each declaration's
 *      optional `reason` field.
 *   2. Surfaced in `scan_project`'s `meta.suppressions` array so agents
 *      reviewing a clean scan can see why each silence was bought.
 *   3. Omitted entirely (key absent, not `undefined`) when no reason was
 *      supplied — so agents can distinguish "documented" from "bare"
 *      suppressions at a glance.
 *
 * Three source files exercise the three pragma variants:
 *
 *   App.tsx           JSX comment with colon reason:
 *                       {/* ra11y-disable-next-line media/alt-text-missing:
 *                           demo page, intentionally missing alt *\/}
 *                     → meta.suppressions[0].reason === "demo page, intentionally missing alt"
 *
 *   Legacy.tsx        Line comment with colon reason:
 *                       // ra11y-disable-next-line keyboard/handler-missing:
 *                       //   legacy widget, scheduled for replacement
 *                     → meta.suppressions[2].reason === "legacy widget, scheduled for replacement"
 *
 *   BareSuppression.tsx  JSX comment with NO reason:
 *                       {/* ra11y-disable wcag22:2.4.6 *\/}
 *                     → meta.suppressions[1] has NO `reason` key at all
 *
 * Live meta evidence (bun probe run 2026-04-16, using exact source files):
 *
 *   meta.suppressions == [
 *     {
 *       path: "App.tsx", line: 4, kind: "disable-next-line",
 *       ruleIds: ["media/alt-text-missing"],
 *       reason: "demo page, intentionally missing alt"        // present
 *     },
 *     {
 *       path: "BareSuppression.tsx", line: 1, kind: "disable",
 *       ruleIds: ["wcag22:2.4.6"]
 *       // NO reason key — "reason" in entry === false
 *     },
 *     {
 *       path: "Legacy.tsx", line: 1, kind: "disable-next-line",
 *       ruleIds: ["keyboard/handler-missing"],
 *       reason: "legacy widget, scheduled for replacement"    // present
 *     }
 *   ]
 *
 * Note on violation assertions: the fixture harness (`runner.ts`) parses
 * files without populating `disableMap`, so `result.violations` sees the
 * raw unsuppressed findings. The `violation-present` expectations below
 * confirm the violations are real (the pragmas did real work, not just
 * annotating clean code). End-to-end suppression execution is covered by
 * `tests/unit/config/inline-disables.test.ts`; this fixture guards the
 * `meta.suppressions` audit-trail surface specifically.
 */

import type { FixtureAssertions } from "../runner.ts";

export const assertions: FixtureAssertions = {
  description:
    "Three pragma variants (JSX-comment with reason, line-comment with reason, bare JSX-comment " +
    "without reason) produce meta.suppressions entries where reasoned pragmas have a `reason` " +
    "string and the bare pragma has the key absent entirely — guarding the d820186 reason-slot " +
    "shape contract and the suppressionsNote audit field.",
  origin: {
    commit: "d820186",
    notes:
      "feat(config): reason slot on ra11y-disable pragmas + audit meta. " +
      "Before d820186, pragmas were parsed for rule IDs only; any trailing text was silently " +
      "dropped. After, the `: reason` and `-- reason` suffix is captured into " +
      "SuppressionDeclaration.reason and surfaced in scan_project meta.suppressions so agents " +
      "auditing a clean scan can see why each suppression was added. The key-absent (not " +
      "undefined) shape for bare suppressions is load-bearing: agents use key presence to " +
      "distinguish documented silences from un-justified ones.",
  },
  expectations: [
    // All three source files must parse without errors. A parse failure
    // would mean the pragma syntax broke the TSX parser.
    { kind: "zero-parse-errors" },

    // meta.suppressions must be present when any file has pragmas.
    // Absence means d820186's suppressionsMetaBlock regressed.
    {
      kind: "meta-field",
      path: ["suppressions"],
      predicate: "present",
    },

    // Exactly 3 pragma declarations across the three files (one per file).
    // Guards that no duplicate entries or phantom entries were emitted.
    {
      kind: "meta-field-length",
      path: ["suppressions"],
      predicate: { equals: 3 },
    },

    // App.tsx entry (index 0, alphabetical order): reasoned JSX-comment pragma.
    // The full entry shape is asserted so any change to path, line, kind,
    // ruleIds, or reason is caught as a regression.
    {
      kind: "meta-field",
      path: ["suppressions", "0"],
      predicate: {
        equals: {
          path: "App.tsx",
          line: 9,
          kind: "disable-next-line",
          ruleIds: ["media/alt-text-missing"],
          reason: "demo page, intentionally missing alt",
        },
      },
    },

    // BareSuppression.tsx entry (index 1): bare pragma, NO reason key.
    // The `reason` key must be absent — not empty string, not undefined.
    // This is the "key-absent == undocumented" shape contract.
    {
      kind: "meta-field",
      path: ["suppressions", "1"],
      predicate: {
        equals: {
          path: "BareSuppression.tsx",
          line: 6,
          kind: "disable",
          ruleIds: ["wcag22:2.4.6"],
        },
      },
    },

    // Legacy.tsx entry (index 2): reasoned line-comment pragma.
    {
      kind: "meta-field",
      path: ["suppressions", "2"],
      predicate: {
        equals: {
          path: "Legacy.tsx",
          line: 5,
          kind: "disable-next-line",
          ruleIds: ["keyboard/handler-missing"],
          reason: "legacy widget, scheduled for replacement",
        },
      },
    },

    // suppressionsNote must be present alongside suppressions.
    // It carries the agent-facing explanation of the reason-slot syntax.
    {
      kind: "meta-field",
      path: ["suppressionsNote"],
      predicate: "present",
    },

    // The note must mention the `: reason` syntax so agents learn
    // the correct pragma form from the scan response itself.
    {
      kind: "meta-field",
      path: ["suppressionsNote"],
      predicate: { contains: ": reason" },
    },

    // Confirm the violations targeted by the two disable-next-line pragmas
    // are real (the pragmas did work on actual findings, not clean code).
    // The harness does not populate disableMap, so these violations surface
    // in result.violations — that is expected and documented in the README.
    { kind: "violation-present", ruleId: "media/alt-text-missing" },
    { kind: "violation-present", ruleId: "keyboard/handler-missing" },
  ],
};
