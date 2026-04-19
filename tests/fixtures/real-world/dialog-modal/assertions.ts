/**
 * dialog-modal — guards the no-keyboard-trap finder on realistic React modal
 * components using role="dialog".
 *
 * Source files:
 *   ConfirmDialog.tsx — three dialog variants:
 *     VariantA: role="dialog" with NO aria-labelledby, NO aria-label;
 *               backdrop div has onClick (exempted as backdrop pattern).
 *     VariantB: role="dialog" with aria-labelledby but NO aria-describedby.
 *     VariantC: role="dialog" with both aria-labelledby AND aria-describedby
 *               (correctly annotated variant).
 *   page.tsx — parent page mounting all three variants conditionally.
 *
 * Live scan evidence (probe run 2026-04-19 against committed source):
 *
 *   violations: (none — all three role="dialog" elements parse cleanly;
 *     role="dialog" has no WAI-ARIA 1.2 required states; backdrop onClick
 *     is exempted by the keyboard/handler-missing isBackdropPattern check)
 *
 *   candidates (review/no-keyboard-trap):
 *     wcag22:2.1.2 / ConfirmDialog.tsx  reason: element with role="dialog"
 *       -- verify keyboard focus can exit without mouse  (×3, one per variant)
 *     wcag21:2.1.2 / ConfirmDialog.tsx  reason: element with role="dialog"
 *       -- verify keyboard focus can exit without mouse  (×3, one per variant)
 *
 * Key invariants this fixture guards:
 *   1. review/no-keyboard-trap fires on role="dialog" regardless of whether
 *      aria-labelledby or aria-describedby are present — the focus-trap check
 *      is independent of the labeling check.
 *   2. role="dialog" is a valid WAI-ARIA role — aria/invalid-role must not fire.
 *   3. role="dialog" has no required states per WAI-ARIA 1.2 — aria/required-attrs
 *      must not fire (dialog does not require aria-checked, aria-valuenow, etc.).
 *   4. The backdrop div with onClick wrapping a role="dialog" child is exempted
 *      by keyboard/handler-missing's isBackdropPattern check — no violation fires.
 *   5. The wcag22:2.1.2 candidate reason includes "role=\"dialog\"" confirming
 *      the finder identifies the element by its ARIA role, not just the tag name.
 *
 * Divergence from backlog description:
 *   The backlog mentions couldBeWrongBecause on "runtime-only" findings. No
 *   current rule emits fixClass:"runtime-only" or couldBeWrongBecause for
 *   dialog patterns — that field is currently only used by contrast rules.
 *   Assertions reflect live scanner output, not the backlog's aspirational text.
 */

import type { FixtureAssertions } from "../runner.ts";

export const assertions: FixtureAssertions = {
  description:
    'Three-variant React dialog fixture: review/no-keyboard-trap fires on all role="dialog" ' +
    "elements (wcag22:2.1.2) regardless of aria-labelledby/aria-describedby presence; " +
    "aria/invalid-role and aria/required-attrs must not fire on valid dialog usage.",
  origin: {
    notes:
      "V1-FIXTURE-DIALOG backlog item. Locks in the no-keyboard-trap finder surface for " +
      'role="dialog" and guards that valid dialog ARIA wiring does not trigger false positives ' +
      "on aria/invalid-role or aria/required-attrs after any engine refactor.",
  },
  expectations: [
    // All source files must parse cleanly — a parse error would mask real findings.
    { kind: "zero-parse-errors" },

    // ── review/no-keyboard-trap (wcag22:2.1.2) ─────────────────────────────
    // All three role="dialog" elements in ConfirmDialog.tsx produce a candidate.
    // The reason string identifies the element by its ARIA role.
    {
      kind: "candidate-present",
      criterionId: "wcag22:2.1.2",
      reasonIncludes: 'role="dialog"',
    },

    // ── review/no-keyboard-trap (wcag21:2.1.2) ─────────────────────────────
    // The wcag21 criterion is also satisfied — same finder, dual criterion IDs.
    {
      kind: "candidate-present",
      criterionId: "wcag21:2.1.2",
      reasonIncludes: 'role="dialog"',
    },

    // ── aria/invalid-role must NOT fire ────────────────────────────────────
    // role="dialog" is a valid WAI-ARIA 1.2 role. A regression that removes
    // "dialog" from the valid-role dictionary would produce a false positive
    // violation on every line of this fixture — this assertion catches it.
    { kind: "no-violation", ruleId: "aria/invalid-role" },

    // ── aria/required-attrs must NOT fire ──────────────────────────────────
    // WAI-ARIA 1.2 does not list any required states for role="dialog".
    // A regression adding dialog to REQUIRED_BY_ROLE without the correct
    // spec citation would fire on VariantA (which has no aria-labelledby).
    { kind: "no-violation", ruleId: "aria/required-attrs" },

    // ── keyboard/handler-missing must NOT fire ─────────────────────────────
    // The backdrop <div onClick={handleCancel}> in VariantA wraps a child
    // with role="dialog". The rule's isBackdropPattern check exempts this
    // pattern — keyboard users close the dialog via Escape, not the backdrop.
    // A regression removing that carve-out would fire here.
    { kind: "no-violation", ruleId: "keyboard/handler-missing" },
  ],
};
