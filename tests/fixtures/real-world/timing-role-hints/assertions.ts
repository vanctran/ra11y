/**
 * timing-role-hints — guards the revert of commit 3ada44a (reverted by
 * adb3976) on the timing candidate finder for wcag22:2.2.1.
 *
 * Commit 3ada44a added a FILENAME_ROLE_HINTS table that matched basenames
 * like "useDebouncedCallback", "authManager", and "telemetryService" and
 * appended "(file looks like a <role> — likely not user-facing)" to the
 * review candidate reason. This was framed as reason-text enrichment (the
 * candidate still surfaced), but commit adb3976 removed it because:
 *
 *   1. Filename → user-facing-ness is a classification the agent already
 *      performs accurately by reading the file (CLAUDE.md §1, "Don't
 *      duplicate capability the agent already has").
 *   2. The hint confidently asserted "likely not user-facing" on evidence
 *      a reviewer could rebut: authManager might house a real session
 *      timeout; useDebouncedCallback might govern user-perceived latency.
 *
 * This fixture guards two invariants simultaneously:
 *
 *   A. Candidates ARE still present (surfacing is never suppressed — per
 *      CLAUDE.md §1 "No heuristic suppression"). The generic reason text
 *      names the common dismissal categories (session-keepalive / debounce
 *      / animation) without making a per-file assertion.
 *
 *   B. No candidate carries "likely not user-facing" — the reverted
 *      per-filename heuristic must not reappear silently.
 *
 * Live scan evidence (bun scratch run 2026-04-16, timing-role-hints source):
 *   wcag22:2.2.1 reason (all three files):
 *     "setTimeout() call — verify the user can pause, extend, or disable
 *      any user-facing time limit this governs (not required for
 *      session-keepalive / debounce / animation)"
 *   "likely not user-facing" present: false
 *   "session-keepalive" present: true
 */

import type { FixtureAssertions } from "../runner.ts";

export const assertions: FixtureAssertions = {
  description:
    "useDebouncedCallback, authManager, and telemetryService each produce a " +
    "wcag22:2.2.1 candidate whose reason carries generic dismissal guidance " +
    "(session-keepalive / debounce / animation) but does NOT contain the " +
    'per-filename heuristic phrase "likely not user-facing" that was added in ' +
    "3ada44a and reverted in adb3976.",
  origin: {
    commit: "3ada44a",
    notes:
      "feat(review): annotate timing candidates with filename role hints. " +
      "Reverted by adb3976 (fix(review): drop filename-based user-facing hints) " +
      "per CLAUDE.md §1 'Don't duplicate capability the agent already has'. " +
      "This fixture locks in both the surfacing invariant (candidates present) " +
      "and the non-heuristic invariant (no per-file role claim in reason text).",
  },
  expectations: [
    { kind: "zero-parse-errors" },

    // Invariant A: candidates MUST still surface for wcag22:2.2.1 — no
    // suppression. The reason carries the generic dismissal guidance that
    // names common non-user-facing categories so the agent can triage
    // without reading the file, but without making a per-file assertion.
    {
      kind: "candidate-present",
      criterionId: "wcag22:2.2.1",
      reasonIncludes: "session-keepalive / debounce / animation",
    },

    // Invariant B: the reverted per-filename heuristic "likely not
    // user-facing" must NOT appear in any wcag22:2.2.1 candidate reason.
    // If this fails, the FILENAME_ROLE_HINTS suppression crept back in.
    {
      kind: "candidate-present-without",
      criterionId: "wcag22:2.2.1",
      reasonExcludes: "likely not user-facing",
    },
  ],
};
