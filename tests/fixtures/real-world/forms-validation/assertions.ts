/**
 * forms-validation — guards the intersection of form labeling rules and
 * validation-flow finders on a realistic React contact form.
 *
 * Source files:
 *   ContactForm.tsx   — main form with six deliberate issues (see source comments)
 *   PhoneField.tsx    — wrapper component forwarding `required` without indicator
 *
 * Live scan evidence (probe run 2026-04-19 against committed source):
 *
 *   violations:
 *     forms/labels-required     ContactForm.tsx:54  <input type="email"> has no accessible name
 *     forms/autocomplete-missing ContactForm.tsx:54  <input> appears to collect personal information
 *     forms/fieldset-legend     ContactForm.tsx:86  <fieldset> has no <legend> child
 *     forms/required-indicator-missing PhoneField.tsx:13  <PhoneField> forwards `required` to a native <input>
 *
 *   candidates:
 *     wcag22:3.3.3 / ContactForm.tsx:42  onChange on <input> has setError(s) call in body
 *     wcag22:3.3.1 / ContactForm.tsx:65  <p role="alert"> sits beside a <input> that has no aria-invalid
 *     wcag22:3.3.1 / ContactForm.tsx:77  <input> has aria-invalid="true" but no aria-describedby
 *
 * The fixture guards that all four form rules AND all three finder paths
 * continue to fire after any refactor.
 */

import type { FixtureAssertions } from "../runner.ts";

export const assertions: FixtureAssertions = {
  description:
    "Two-file React form fixture: four form rules (labels-required, fieldset-legend, " +
    "required-indicator-missing, autocomplete-missing) and three review finders " +
    "(validation-timing, server-error-untied, error-identification) all fire on the " +
    "deliberate violations in ContactForm.tsx and PhoneField.tsx.",
  origin: {
    notes:
      "Synthetic fixture authored 2026-04-19 to lock in the full forms-validation " +
      "surface. Covers V1-FIXTURE-FORMS from the backlog — ensures none of the four " +
      "form rules or three validation finders silently regress after engine refactors.",
  },
  expectations: [
    // All source files must parse cleanly — a parse error would mask real findings.
    { kind: "zero-parse-errors" },

    // ── forms/labels-required ────────────────────────────────────────────────
    // The unlabeled <input type="email"> in ContactForm.tsx has no htmlFor label,
    // no aria-label, and no aria-labelledby.
    {
      kind: "violation-present",
      ruleId: "forms/labels-required",
      reasonIncludes: "has no accessible name",
    },

    // ── forms/fieldset-legend ────────────────────────────────────────────────
    // The <fieldset> wrapping the checkbox group has no <legend> child.
    {
      kind: "violation-present",
      ruleId: "forms/fieldset-legend",
      reasonIncludes: "has no <legend> child",
    },

    // ── forms/required-indicator-missing ─────────────────────────────────────
    // PhoneField.tsx accepts a `required` prop, forwards it to a native <input>,
    // but renders no visible asterisk/text and sets no aria-required.
    {
      kind: "violation-present",
      ruleId: "forms/required-indicator-missing",
      reasonIncludes: "forwards `required`",
    },

    // ── forms/autocomplete-missing ───────────────────────────────────────────
    // The email <input> in ContactForm and the tel <input> in PhoneField both
    // lack autocomplete. At least one must fire.
    {
      kind: "violation-present",
      ruleId: "forms/autocomplete-missing",
      reasonIncludes: "appears to collect personal information but has no autocomplete",
    },

    // ── review/validation-timing (wcag22:3.3.3) ──────────────────────────────
    // The name <input> onChange runs setErrors on every keystroke — an inline
    // arrow body containing a setError(s) call triggers the finder.
    {
      kind: "candidate-present",
      criterionId: "wcag22:3.3.3",
      reasonIncludes: "setError(s) call in body",
    },

    // ── review/server-error-untied (wcag22:3.3.1) ────────────────────────────
    // <p role="alert"> sits beside a <input> that has no aria-invalid and no id,
    // so aria-describedby cannot point at it.
    {
      kind: "candidate-present",
      criterionId: "wcag22:3.3.1",
      reasonIncludes: "sits beside a <input> that has no aria-invalid",
    },

    // ── review/error-identification (wcag22:3.3.1) ───────────────────────────
    // The notes <input> carries aria-invalid="true" but has no aria-describedby
    // or aria-errormessage to programmatically associate an error description.
    {
      kind: "candidate-present",
      criterionId: "wcag22:3.3.1",
      reasonIncludes: 'has aria-invalid="true" but no aria-describedby or aria-errormessage',
    },
  ],
};
