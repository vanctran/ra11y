/**
 * nav-landmarks — guards landmark, skip-link, descriptive-link, and
 * consistent-navigation behavior across a two-route app shell.
 *
 * Three HTML-scoped rules fire on shell.html:
 *
 *   semantics/landmark-main  — the page has <header>, <nav>, <footer> but
 *     no <main>; the rule emits a warning pointing at <body>.
 *
 *   navigation/skip-link  — the <nav> contains 3 links and no in-page
 *     skip anchor precedes it; the rule emits a warning at the <nav>.
 *
 *   navigation/link-descriptive-text  — the prose area has
 *     <a href="/docs">click here</a>; the rule emits a warning for the
 *     generic phrase "click here".
 *
 * The consistent-navigation finder fires cross-file on the two TSX route
 * components: home.tsx declares [home, about, contact]; about.tsx declares
 * [about, home, contact] — same set, different order. The finder emits a
 * wcag22:3.2.3 candidate (and equivalents) for each diverging nav.
 *
 * Live meta evidence (probe run 2026-04-19):
 *   violations:
 *     { ruleId: "semantics/landmark-main",
 *       message: "Document has no <main> landmark..." }
 *     { ruleId: "navigation/skip-link",
 *       message: "No skip link precedes the primary <nav>..." }
 *     { ruleId: "navigation/link-descriptive-text",
 *       message: "Link text \"click here\" is not descriptive..." }
 *   candidates (wcag22:3.2.3):
 *     reason: "<nav> link order diverges from app/routes/home.tsx:6 —
 *              this file: [about, home, contact]; counterpart: [home, about, contact]"
 *     reason: "<nav> link order diverges from app/routes/about.tsx:6 —
 *              this file: [home, about, contact]; counterpart: [about, home, contact]"
 */

import type { FixtureAssertions } from "../runner.ts";

export const assertions: FixtureAssertions = {
  description:
    "Two-route nav shell: missing <main> landmark, absent skip link, non-descriptive " +
    "link text, and divergent nav order across routes each fire their respective " +
    "rule or finder.",
  origin: {
    notes:
      "V1-FIXTURE-NAV backlog item. Exercises navigation/skip-link (wcag22:2.4.1), " +
      "navigation/link-descriptive-text (wcag22:2.4.4), semantics/landmark-main " +
      "(wcag22:1.3.1), and the consistent-navigation finder (wcag22:3.2.3) together " +
      "so that a refactor silencing any one of them turns a green harness red.",
  },
  expectations: [
    // All three source files must parse without errors.
    { kind: "zero-parse-errors" },

    // semantics/landmark-main fires on shell.html: <body> has <header>, <nav>,
    // <footer> but no <main>.
    {
      kind: "violation-present",
      ruleId: "semantics/landmark-main",
      reasonIncludes: "no <main> landmark",
    },

    // navigation/skip-link fires on shell.html: <nav> has 3 links but no
    // in-page anchor precedes it.
    {
      kind: "violation-present",
      ruleId: "navigation/skip-link",
      reasonIncludes: "No skip link precedes the primary <nav>",
    },

    // navigation/link-descriptive-text fires on shell.html: <a href="/docs">click here</a>.
    {
      kind: "violation-present",
      ruleId: "navigation/link-descriptive-text",
      reasonIncludes: "click here",
    },

    // consistent-navigation finder fires for wcag22:3.2.3: home.tsx has
    // [home, about, contact]; about.tsx has [about, home, contact] — same
    // set, different order.
    {
      kind: "candidate-present",
      criterionId: "wcag22:3.2.3",
      reasonIncludes: "link order diverges",
    },
  ],
};
