/**
 * Standard filter.
 *
 * Given an enabled set of standard IDs (and optionally an active
 * conformance level), computes:
 *
 *   1. Whether the rule should execute at all — is any criterion in
 *      `satisfies` (including its equivalence closure) owned by an
 *      enabled standard AND, if a level is set, at or below that level?
 *   2. The list of criterion IDs the rule should cite when producing
 *      violations, filtered to enabled standards only.
 *
 * Level gating is how the engine avoids firing AAA-only rules when the
 * caller asked for AA. A rule whose only cited criteria are higher than
 * the active level is skipped end-to-end — no wasted work, no spurious
 * "fix the contrast to 7:1" message when the user is targeting AA.
 * Section 508's `base` level is treated as always-matching because
 * Section 508 itself has no A/AA/AAA axis.
 *
 * This mechanism is how one rule can cover WCAG 2.2, WCAG 2.1,
 * Section 508, and EN 301 549 simultaneously, citing the right IDs
 * depending on what the user asked for.
 */

import type { Rule } from "../types/rule.ts";
import type { CriteriaRegistry } from "./registry/criteria.ts";

export type ConformanceLevel = "A" | "AA" | "AAA";

export interface StandardFilter {
  /** Should this rule execute under the enabled standards + level? */
  isRuleActive(rule: Rule): boolean;
  /** Criterion IDs the rule should cite, filtered to enabled standards. */
  citedCriteria(rule: Rule): readonly string[];
}

export function createStandardFilter(
  enabledStandards: ReadonlySet<string>,
  criteria: CriteriaRegistry,
  activeLevel?: ConformanceLevel,
): StandardFilter {
  return {
    isRuleActive(rule: Rule): boolean {
      for (const c of walkCitedCriteria(rule, criteria, enabledStandards)) {
        if (activeLevel === undefined) return true;
        const crit = criteria.get(c);
        if (crit && isCriterionAtOrBelow(crit.level, activeLevel)) return true;
      }
      return false;
    },

    citedCriteria(rule: Rule): readonly string[] {
      const cited = new Set<string>();
      for (const c of walkCitedCriteria(rule, criteria, enabledStandards)) cited.add(c);
      return [...cited].sort();
    },
  };
}

/**
 * Iterates every criterion (via equivalence closure) a rule satisfies
 * that belongs to an enabled standard. Extracted so the two filter
 * methods share one walker and stay within the complexity budget.
 */
function* walkCitedCriteria(
  rule: Rule,
  criteria: CriteriaRegistry,
  enabledStandards: ReadonlySet<string>,
): Iterable<string> {
  for (const declared of rule.satisfies) {
    for (const c of criteria.equivalenceClosure(declared)) {
      const standardId = c.split(":")[0];
      if (!(standardId && enabledStandards.has(standardId))) continue;
      yield c;
    }
  }
}

const LEVEL_RANK: Readonly<Record<ConformanceLevel, number>> = { A: 1, AA: 2, AAA: 3 };

/**
 * True when a criterion's level is at or below the active level, i.e.
 * should run when the caller asked for `activeLevel`. `base` covers
 * standards without an A/AA/AAA axis (Section 508) and is treated as
 * always-active. Unknown levels pass through so a future standard with
 * a novel taxonomy isn't silently dropped.
 */
function isCriterionAtOrBelow(criterionLevel: string, activeLevel: ConformanceLevel): boolean {
  if (criterionLevel === "base") return true;
  const critRank = LEVEL_RANK[criterionLevel as ConformanceLevel];
  if (critRank === undefined) return true;
  return critRank <= LEVEL_RANK[activeLevel];
}
