/**
 * Test helper: construct a {@link Violation} from a partial literal
 * and auto-stamp the engine-owned opaque tokens (`findingId`,
 * `groupKey`).
 *
 * Most test data in this repo uses inline `Violation` literals for
 * formatter + report snapshots. The engine stamps `findingId` from
 * the source context and `groupKey` from the target node's AST
 * shape; tests don't usually have either on hand, so `withFindingId`
 * synthesizes both from placeholder inputs — enough to satisfy the
 * required-field invariants and stay deterministic across runs. Real
 * end-to-end assertions (line-drift resilience, cross-file grouping)
 * live in the scanner-driven tests, which run the full scanner over
 * real source strings and check the token values directly.
 */

import type { Violation } from "../../src/types/violation.ts";
import { computeFindingId } from "../../src/utils/finding-id.ts";
import { computeGroupKey, UNKNOWN_SHAPE } from "../../src/utils/group-key.ts";

/**
 * Stamps `findingId` and `groupKey` derived from the given violation.
 * Test fixtures rarely have a parsed AST on hand, so `groupKey` uses
 * the `UNKNOWN_SHAPE` sentinel — deterministic per-ruleId and
 * correctly groups every synthetic test Violation from the same rule.
 */
export function withFindingId(v: Omit<Violation, "findingId" | "groupKey">): Violation {
  const findingId = computeFindingId({
    ruleId: v.ruleId,
    filePath: v.location.filePath,
    // Empty source is fine for test fixtures — the context-hash is
    // stable for the (ruleId, path) pair, which is all these tests
    // need.
    source: "",
    line: v.location.line,
  });
  const groupKey = computeGroupKey({ ruleId: v.ruleId, shape: UNKNOWN_SHAPE });
  return { ...v, findingId, groupKey };
}

/** Maps `withFindingId` over an array of partial violations. */
export function withFindingIds(
  vs: readonly Omit<Violation, "findingId" | "groupKey">[],
): Violation[] {
  return vs.map(withFindingId);
}
