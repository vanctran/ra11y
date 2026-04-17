/**
 * template-directives — guards commit a554d27 (feat(mcp): actionable
 * hints and explicit template-directive handling).
 *
 * Commit a554d27 added `templateDirectiveHandling: string` alongside the
 * existing `templateDirectivesFound` array. The new field emits plain-
 * English text explaining that the HTML parser treats `{% ... %}` and
 * `{{ ... }}` as literal text — the rendered output is not reconstructed
 * and cross-template `extends`/`include` relationships are not resolved.
 *
 * Two source files exercise distinct directive styles:
 *   - base.jinja.html: Jinja control directives (`{% extends %}`,
 *     `{% block %}`, `{% if %}`, `{% for %}`) + interpolation.
 *     Detected as `jinja-or-liquid`.
 *   - partial.html: mustache-style interpolation only (`{{ }}`).
 *     Detected as `handlebars-or-mustache`.
 *
 * Live meta evidence (bun probe run 2026-04-16):
 *   meta.analysisCoverage.templateDirectiveHandling ==
 *   "handlebars-or-mustache, jinja-or-liquid directives are parsed as
 *    literal HTML text — the rendered output is not reconstructed.
 *    Rules run against the template source, so attributes like
 *    `class=\"{% if x %}foo{% endif %}\"` are evaluated as the raw string
 *    containing the directive. Cross-template `extends`/`include`
 *    relationships are not resolved. Verify findings in files flagged
 *    with directives by reading the rendered output rather than the
 *    template."
 *
 * The assertions lock in:
 *   1. Zero parse errors — the HTML parser must accept template-directive
 *      syntax without producing a broken AST.
 *   2. The handling field is present under analysisCoverage.
 *   3. The phrase "parsed as literal" appears — if a future refactor
 *      changes the description to imply rendered analysis, this fails.
 *   4. The phrase "rendered output is not reconstructed" appears — the
 *      honest "we do NOT render" signal that agents use for confidence.
 */

import type { FixtureAssertions } from "../runner.ts";

export const assertions: FixtureAssertions = {
  description:
    "HTML templates with Jinja control directives and mustache interpolation produce " +
    "meta.analysisCoverage.templateDirectiveHandling containing 'parsed as literal' " +
    "and 'rendered output is not reconstructed', with zero parse errors.",
  origin: {
    commit: "a554d27",
    notes:
      "feat(mcp): actionable hints and explicit template-directive handling. Before this " +
      "commit, templateDirectivesFound told the agent *that* directives were detected but " +
      "not what the scanner did with them. templateDirectiveHandling replaces the silent " +
      "signal with an explicit statement that directives are parsed as literal text.",
  },
  expectations: [
    // The HTML parser must not error on template-directive syntax. If the
    // parser emits errors on `{% %}` or `{{ }}`, rules run on a broken AST
    // and the coverage telemetry is unreliable.
    { kind: "zero-parse-errors" },

    // The handling field must be present whenever template engines are
    // detected. Absence means the a554d27 telemetry regressed.
    {
      kind: "meta-field",
      path: ["analysisCoverage", "templateDirectiveHandling"],
      predicate: "present",
    },

    // "parsed as literal" is the load-bearing phrase — it tells the agent
    // the scanner did NOT attempt rendering or execution of directives.
    {
      kind: "meta-field",
      path: ["analysisCoverage", "templateDirectiveHandling"],
      predicate: { contains: "parsed as literal" },
    },

    // "rendered output is not reconstructed" is the explicit honesty signal.
    // If this changes to something implying rendered analysis, this fails.
    {
      kind: "meta-field",
      path: ["analysisCoverage", "templateDirectiveHandling"],
      predicate: { contains: "rendered output is not reconstructed" },
    },
  ],
};
