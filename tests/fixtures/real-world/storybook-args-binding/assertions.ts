/**
 * storybook-args-binding — guards that the tsx parser's Storybook
 * `args`-binding synthesis pass produces a virtual `<Component/>`
 * element for each story whose `args` is a literal object, and that
 * the synthesized element flows through the existing JSX pipeline so
 * downstream telemetry (and, with the right wrapper mapping, the
 * accessibility rules) get a chance to fire on it.
 *
 * Without synthesis the parser sees only the `args` data literal — no
 * `<Button/>` element enters the scanned element stream — and the
 * scan-confidence meta tells the agent "we never saw Button rendered."
 * With synthesis, a virtual `<Button label="Save" disabled={true} />`
 * enters the element stream and the opaque-component accumulator
 * picks it up. `disabled` is in the interactive-attribute set, so the
 * Button entry is eligible for the `opaqueCustomComponentsTop` ranked
 * list — which is what the meta-field assertions below lock in.
 */

import type { FixtureAssertions } from "../runner.ts";

export const assertions: FixtureAssertions = {
  description:
    "Storybook story file with `args: { label, disabled }` produces a synthesized <Button/> element the parser appends to module.jsxElements; the synthesized element flows into the opaque-components accumulator and the disabled prop (interactive attr) lands Button on opaqueCustomComponentsTop. Without synthesis the parser sees no JSX element and Button is absent from both fields.",
  origin: {
    notes:
      "Storybook 7+ stories render `<X {...args} />` for whichever component the file targets, but the source contains only the args data literal. The synthesis pass appends a virtual JSX element so accessibility rules can evaluate what would actually render. This fixture is the regression guard for the synthesis pass introduced in the Q2R2-STORYBOOK-PRESET follow-up.",
  },
  expectations: [
    { kind: "zero-parse-errors" },

    // The synthesized <Button/> brings Button into the opaque-component
    // inventory. Before synthesis Button was only a function declaration
    // and an import, never a JSX call site, so opaqueCustomComponents
    // would be 0 on this fixture; after synthesis it counts to 1.
    {
      kind: "meta-field",
      path: ["analysisCoverage", "opaqueCustomComponents"],
      predicate: { equals: 1 },
    },

    // The synthesized element carries `disabled={true}`. `disabled` is
    // in INTERACTIVE_ATTRS, so the Button entry's interactive flag flips
    // and the component qualifies for the top-N ranking. If the
    // synthesis pass regresses (no element emitted, or emitted without
    // attributes), the top list will be empty / absent.
    {
      kind: "meta-field",
      path: ["analysisCoverage", "opaqueCustomComponentsTop", "0"],
      predicate: { equals: { name: "Button", callSites: 1 } },
    },

    // The names list (inlined when ≤50 names) must contain Button —
    // the same evidence at a different field, guarding against a
    // future change that drops the top list shape.
    {
      kind: "meta-field",
      path: ["analysisCoverage", "opaqueCustomComponentNames"],
      predicate: { contains: "Button" },
    },
  ],
};
