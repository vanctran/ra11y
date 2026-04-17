/**
 * Stable grouping key for findings that share a rule and an AST shape.
 *
 * Sibling of `findingId`: both are truncated sha256 tokens stamped onto
 * every {@link import("../types/violation.ts").Violation}, but they
 * answer opposite questions.
 *
 *   findingId — "is this the *same* finding across runs of the same
 *               scan?" Filename and source-context are part of the hash;
 *               two identical `<img>` tags in two files get different
 *               findingIds.
 *
 *   groupKey  — "is this the *same kind of problem* across findings?"
 *               Filename and source-context are deliberately excluded;
 *               the same rule firing on AST-equivalent nodes across 40
 *               files produces the same groupKey. Lets agents write one
 *               fix and loop.
 *
 * Recipe:
 *   groupKey = sha256(ruleId + "\0" + normalizedShape).slice(0, GROUP_KEY_HEX_LENGTH)
 *
 * `normalizedShape` is produced by `describeNodeShape` in
 * `src/engine/ast-helpers.ts` — a canonical string that preserves
 * element/selector kind, attribute/property NAMES (not values), and a
 * coarse children-structure tag, and strips identifier-specific data
 * and position information.
 *
 * Length: {@link GROUP_KEY_HEX_LENGTH} hex chars = 48 bits. Same as
 * `findingId` for symmetry in agent transcripts — a finding carries
 * both tokens side by side and short+consistent reads cleanest.
 *
 * Fallback: when the shape cannot be described (synthetic crash
 * records, project-scope emits with no nodal target), callers pass
 * `"unknown-shape"` as the shape input. Every such finding under a
 * single rule ID shares one groupKey — honest "this rule's
 * un-groupable findings" bucket.
 */

import { createHash } from "node:crypto";

/** Output length (hex chars) of the truncated sha256 digest. */
export const GROUP_KEY_HEX_LENGTH = 12;

/** Shape string used when the target node cannot be resolved or described. */
export const UNKNOWN_SHAPE = "unknown-shape";

export interface GroupKeyInputs {
  readonly ruleId: string;
  /**
   * Canonical shape string for the target node — see
   * `describeNodeShape` in `src/engine/ast-helpers.ts`. When no target
   * node is available, pass {@link UNKNOWN_SHAPE}.
   */
  readonly shape: string;
}

/**
 * Computes the stable group key for a finding. Pure function over its
 * inputs; no I/O.
 */
export function computeGroupKey(inputs: GroupKeyInputs): string {
  const canonical = `${inputs.ruleId}\u0000${inputs.shape}`;
  return createHash("sha256").update(canonical).digest("hex").slice(0, GROUP_KEY_HEX_LENGTH);
}
