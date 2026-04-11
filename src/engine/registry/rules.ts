/**
 * Rules registry.
 *
 * Owns the set of loaded rules. Rules are registered at scanner init —
 * built-ins from `src/rules/index.ts`, plugin rules from the user config.
 *
 * The registry also builds `rulesBySatisfied`: for each loaded criterion
 * ID, the set of rule IDs that satisfy it (directly or transitively via
 * equivalentTo). This is the fast path for the standard-filter:
 * `rulesFor("wcag22:1.4.3")` returns every rule that would produce a
 * violation against that criterion.
 */

import type { Rule } from "../../types/rule.ts";
import type { CriteriaRegistry } from "./criteria.ts";

export class RulesRegistry {
  readonly #rules = new Map<string, Rule>();
  readonly #rulesBySatisfied = new Map<string, Set<string>>();

  /** Register a rule. Throws if the ID is already taken. */
  register(rule: Rule): void {
    if (this.#rules.has(rule.id)) {
      throw new Error(
        `ra11y: rule '${rule.id}' is already registered. Rule IDs must be globally unique.`,
      );
    }
    this.#rules.set(rule.id, rule);
  }

  /** Rebuild the rulesBySatisfied index using the criteria registry's equivalence closure. */
  rebuild(criteria: CriteriaRegistry): void {
    this.#rulesBySatisfied.clear();
    for (const rule of this.#rules.values()) {
      const allReachableCriteria = new Set<string>();
      for (const declaredCriterion of rule.satisfies) {
        for (const c of criteria.equivalenceClosure(declaredCriterion)) {
          allReachableCriteria.add(c);
        }
      }
      for (const criterionId of allReachableCriteria) {
        this.#addReverse(criterionId, rule.id);
      }
    }
  }

  #addReverse(criterionId: string, ruleId: string): void {
    let set = this.#rulesBySatisfied.get(criterionId);
    if (!set) {
      set = new Set();
      this.#rulesBySatisfied.set(criterionId, set);
    }
    set.add(ruleId);
  }

  /** Returns a rule by ID, or undefined. */
  get(id: string): Rule | undefined {
    return this.#rules.get(id);
  }

  /** True if the rule is loaded. */
  has(id: string): boolean {
    return this.#rules.has(id);
  }

  /** Iterates every registered rule in registration order. */
  all(): readonly Rule[] {
    return [...this.#rules.values()];
  }

  /** IDs of every rule that satisfies the given criterion (direct or equivalent). */
  rulesFor(criterionId: string): readonly string[] {
    const set = this.#rulesBySatisfied.get(criterionId);
    return set ? [...set] : [];
  }

  /** Total count. */
  get size(): number {
    return this.#rules.size;
  }
}
