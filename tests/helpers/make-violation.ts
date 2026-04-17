/**
 * Test helper: construct a {@link Violation} from a partial literal
 * and auto-stamp a real `findingId`.
 *
 * Most test data in this repo uses inline `Violation` literals for
 * formatter + report snapshots. The engine stamps `findingId` from
 * the source context; tests don't usually have the full source text
 * on hand, so `withFindingId` computes the ID from an empty source
 * window — enough to satisfy the required-field invariant and stay
 * deterministic across runs. Real end-to-end assertions (line-drift
 * resilience, source-context sensitivity) live in
 * `tests/unit/engine/finding-id.test.ts`, which runs the full scanner
 * over real source strings and checks the ID value directly.
 */

import type { Violation } from "../../src/types/violation.ts";
import { computeFindingId } from "../../src/utils/finding-id.ts";

/** Stamps a `findingId` derived from the given violation's ruleId + filePath + line. */
export function withFindingId(v: Omit<Violation, "findingId">): Violation {
  const findingId = computeFindingId({
    ruleId: v.ruleId,
    filePath: v.location.filePath,
    // Empty source is fine for test fixtures — the context-hash is
    // stable for the (ruleId, path) pair, which is all these tests
    // need.
    source: "",
    line: v.location.line,
  });
  return { ...v, findingId };
}

/** Maps `withFindingId` over an array of partial violations. */
export function withFindingIds(vs: readonly Omit<Violation, "findingId">[]): Violation[] {
  return vs.map(withFindingId);
}
