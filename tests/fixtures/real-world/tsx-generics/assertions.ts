/**
 * tsx-generics — guard that the TSX parser disambiguates TypeScript
 * generic syntax from JSX opening tags.
 *
 * Origin: commit 2968d87 (fix(parser): disambiguate TS generics from
 * JSX in tsx parser). Before that fix, patterns like `Pick<T, K>`,
 * `Array<string>`, and `ForwardRefRenderFunction<HTMLButtonElement,
 * Props>` were mistaken for JSX opening tags, producing "Unclosed
 * JSX element" parse errors and cascading failures that stopped
 * rules running on the rest of the module.
 *
 * This fixture exercises three sanitized shapes — pure-type file,
 * forward-ref + generic call sites, and a module mixing generics
 * with real JSX — and asserts:
 *   1. No parse errors on any file.
 *   2. No violations produced (nothing in the fixture is a real
 *      accessibility bug; a violation would mean an over-eager
 *      rule fired on the synthetic input).
 */

import type { FixtureAssertions } from "../runner.ts";

export const assertions: FixtureAssertions = {
  description:
    "TS generics (Pick<T,K>, ForwardRefRenderFunction<...>, Array<...>, call-site generics) parse cleanly alongside real JSX without emitting parse errors.",
  origin: {
    commit: "2968d87",
    feedbackRound: "leela-round-1",
    notes:
      "Before the fix, ~40% of a typical Vite/React/TS codebase misclassified generic type-application syntax as unclosed JSX and lost rule coverage below the false error.",
  },
  expectations: [{ kind: "zero-parse-errors" }, { kind: "no-violation", ruleId: "*" }],
};
