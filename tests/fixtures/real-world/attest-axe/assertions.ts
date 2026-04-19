/**
 * attest-axe — executable proof that the axe-core → attest bridge
 * pattern produces valid, parseable TypeScript.
 *
 * The fixture exists to lock in the bridge pattern described in
 * `docs/kb/patterns/bridging-runtime-a11y.md`. The bridge is a PATTERN
 * the agent performs — no axe-core adapter lives in src/. This fixture
 * proves the mapping code compiles, the scanner accepts it, and the
 * pattern round-trips without parser failures or spurious violations.
 *
 * Source files:
 *   axe-report.json    — synthetic axe-core JSON report (not parsed
 *                        by the scanner; illustrative artifact only).
 *   agent-bridge.ts    — TypeScript showing the axe → attest mapping.
 *                        This IS parsed by the scanner.
 *
 * Live meta evidence (probe run 2026-04-19 against committed source):
 *
 *   files parsed:       [ "agent-bridge.ts" ]
 *   parse errors:       0
 *   violations:         0
 *   meta.filesScanned:  1
 *   meta.filesByExtension: { ".ts": 1 }
 *
 * Note: the `.json` report is an illustrative artifact — the scanner
 * does not parse JSON files, only .ts/.tsx/.js/.jsx/.html/.css. Its
 * presence in source/ is deliberate: it anchors the documented bridge
 * pattern alongside the code that consumes it.
 *
 * The fixture does not call the `attest` tool handler in-process:
 * the harness only runs the scanner pipeline (ADR 0006). The attest
 * tool's own unit tests cover the handler path directly. This fixture
 * guards the bridge code pattern — that the TypeScript the agent is
 * instructed to author compiles without errors and does not itself
 * introduce accessibility issues.
 */

import type { FixtureAssertions } from "../runner.ts";

export const assertions: FixtureAssertions = {
  description:
    "axe-core → attest bridge pattern: agent-bridge.ts compiles cleanly with zero " +
    "parse errors and emits no accessibility violations, confirming the documented " +
    "bridging pattern is valid TypeScript the agent can author as-is.",
  origin: {
    notes:
      "Synthetic fixture authored 2026-04-19 for V1-FIXTURE-ATTEST. " +
      "Guards the no-vendor-adapter invariant: the bridge lives in agent code + " +
      "docs, never in src/. The axe-report.json is the canonical synthetic payload " +
      "the bridging-runtime-a11y doc references.",
  },
  expectations: [
    // The bridge TypeScript must parse without errors. A parse failure
    // would mean the agent's bridge pattern isn't valid TS.
    { kind: "zero-parse-errors" },

    // The bridge code has no accessibility issues — it is plain TypeScript
    // with no JSX rendering. Any violation here would mean a rule fired
    // spuriously on non-JSX code.
    { kind: "no-violation", ruleId: "*" },

    // The scanner must see exactly one TypeScript file (agent-bridge.ts).
    // Confirms the JSON file is correctly excluded from parsing.
    {
      kind: "meta-field",
      path: ["filesByExtension", ".ts"],
      predicate: { equals: 1 },
    },
  ],
};
