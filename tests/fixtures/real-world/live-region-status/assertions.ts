/**
 * live-region-status — guards aria/live-region-valid on a polite status
 * container + dynamic update pattern.
 *
 * Live scan evidence (probe run 2026-04-19 against committed source):
 *
 *   violations (all ruleId: aria/live-region-valid):
 *     StatusBanner.tsx  — aria-live="bogus"  → invalid token
 *     StatusBanner.tsx  — role="status" + aria-live="assertive" → contradiction
 *     StatusBanner.tsx  — aria-atomic="maybe" → invalid atomic value
 *     ToastRegion.tsx   — role="alert" + aria-live="polite" → contradiction
 *     ToastRegion.tsx   — aria-live="polite" + aria-hidden="true" → hidden region
 *
 *   candidates: none  (no finder for wcag22:4.1.3 exists yet)
 *
 * Drift note: the backlog item V1-FIXTURE-LIVE-REGION mentioned asserting
 * `couldBeWrongBecause: ["runtime_behavior_required"]` on violations where the
 * scanner cannot prove content actually updates at runtime. That reason code
 * does not exist in the codebase — the live-region rule only fires on
 * structural/declarative faults (invalid token values, role contradictions,
 * hidden subtrees). Assertions below reflect the live scanner output. If
 * `runtime_behavior_required` is added to the rule in the future, the fixture
 * should be extended at that time.
 *
 * The fixture guards that:
 *   (a) correct polite-status and assertive-alert patterns fire zero violations,
 *   (b) all five structural faults remain detectable after engine refactors.
 */

import type { FixtureAssertions } from "../runner.ts";

export const assertions: FixtureAssertions = {
  description:
    "Three-file React fixture: correct polite-status and assertive-alert patterns " +
    "fire zero violations; five structural faults (invalid aria-live token, two " +
    "role-contradicts-aria-live, invalid aria-atomic, hidden live region) all fire " +
    "aria/live-region-valid violations.",
  origin: {
    notes:
      "V1-FIXTURE-LIVE-REGION backlog item. Guards the full surface of " +
      "aria/live-region-valid (wcag22:4.1.3) so that a refactor silencing any " +
      "structural-fault detection turns a green harness red.",
  },
  expectations: [
    // All source files must parse without errors.
    { kind: "zero-parse-errors" },

    // ── Structural fault 1: invalid aria-live token ──────────────────────────
    // StatusBanner.tsx BrokenStatusBanner: aria-live="bogus" is not in the
    // WAI-ARIA token set {off, polite, assertive}.
    {
      kind: "violation-present",
      ruleId: "aria/live-region-valid",
      reasonIncludes: 'aria-live="bogus"',
    },

    // ── Structural fault 2: role="status" contradicts aria-live="assertive" ──
    // role="status" implies polite; pairing it with assertive is contradictory.
    {
      kind: "violation-present",
      ruleId: "aria/live-region-valid",
      reasonIncludes: 'role="status"',
    },

    // ── Structural fault 3: invalid aria-atomic value ────────────────────────
    // aria-atomic accepts only "true" or "false"; "maybe" is not valid.
    {
      kind: "violation-present",
      ruleId: "aria/live-region-valid",
      reasonIncludes: 'aria-atomic="maybe"',
    },

    // ── Structural fault 4: role="alert" contradicts aria-live="polite" ──────
    // role="alert" implies assertive; pairing it with polite is contradictory.
    {
      kind: "violation-present",
      ruleId: "aria/live-region-valid",
      reasonIncludes: 'role="alert"',
    },

    // ── Structural fault 5: live region inside aria-hidden="true" ────────────
    // The subtree is removed from the accessibility tree; updates are never
    // announced even though aria-live="polite" is declared.
    {
      kind: "violation-present",
      ruleId: "aria/live-region-valid",
      reasonIncludes: "also has aria-hidden",
    },
  ],
};
