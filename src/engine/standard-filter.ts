/**
 * Standard filter.
 *
 * Given an enabled set of standard IDs and a rule's `satisfies` list,
 * computes:
 *
 *   1. Whether the rule should execute at all (is any criterion in
 *      `satisfies` — including its equivalence closure — owned by an
 *      enabled standard?).
 *   2. The list of criterion IDs the rule should cite when producing
 *      violations during this scan, filtered to enabled standards only.
 *
 * This is the mechanism that lets one rule cover WCAG 2.2, WCAG 2.1,
 * Section 508, and EN 301 549 simultaneously, citing the right IDs
 * depending on what the user asked for.
 */

import type { Rule } from "../types/rule.ts";
import type { CriteriaRegistry } from "./registry/criteria.ts";

export interface StandardFilter {
  /** Should this rule execute under the enabled standards? */
  isRuleActive(rule: Rule): boolean;
  /** Criterion IDs the rule should cite, filtered to enabled standards. */
  citedCriteria(rule: Rule): readonly string[];
}

export function createStandardFilter(
  enabledStandards: ReadonlySet<string>,
  criteria: CriteriaRegistry,
): StandardFilter {
  return {
    isRuleActive(rule: Rule): boolean {
      for (const declared of rule.satisfies) {
        for (const c of criteria.equivalenceClosure(declared)) {
          const standardId = c.split(":")[0];
          if (standardId && enabledStandards.has(standardId)) return true;
        }
      }
      return false;
    },

    citedCriteria(rule: Rule): readonly string[] {
      const cited = new Set<string>();
      for (const declared of rule.satisfies) {
        for (const c of criteria.equivalenceClosure(declared)) {
          const standardId = c.split(":")[0];
          if (standardId && enabledStandards.has(standardId)) cited.add(c);
        }
      }
      return [...cited].sort();
    },
  };
}
