/**
 * Criteria registry.
 *
 * Flat index of every criterion across every loaded standard, keyed by
 * globally-unique criterion ID (`<standardId>:<localId>`). Also owns the
 * reciprocal `equivalentTo` index: given a criterion, list every other
 * criterion that resolves to it through an equivalence chain. This is
 * what lets thin standards (Section 508, EN 301 549) get WCAG coverage
 * for free.
 *
 * Call `rebuild()` after the standards registry is fully populated but
 * before the scan runs.
 */

import type { Criterion, Standard } from "../../types/standard.ts";

export class CriteriaRegistry {
  readonly #byId = new Map<string, Criterion>();
  /** For each criterion ID C, the set of criterion IDs equivalent to C (reciprocal). */
  readonly #equivalenceReciprocal = new Map<string, Set<string>>();

  /** Walks the given standards and rebuilds the flat index + reciprocal map. */
  rebuild(standards: readonly Standard[]): void {
    this.#byId.clear();
    this.#equivalenceReciprocal.clear();

    for (const standard of standards) {
      for (const criterion of standard.criteria) {
        if (this.#byId.has(criterion.id)) {
          throw new Error(
            `ra11y: duplicate criterion ID '${criterion.id}'. Criterion IDs must be globally unique.`,
          );
        }
        this.#byId.set(criterion.id, criterion);
      }
    }

    // Build the reciprocal. If A.equivalentTo includes B, then any rule
    // that satisfies A also satisfies B — and vice versa. We store this
    // symmetrically so lookups are O(1) in both directions.
    for (const criterion of this.#byId.values()) {
      const equivalents = criterion.equivalentTo ?? [];
      for (const otherId of equivalents) {
        if (!this.#byId.has(otherId)) {
          // Silently skip missing equivalents — they may refer to an
          // optional standard the user didn't load. Standards-audit catches
          // true dangling references.
          continue;
        }
        this.#addReciprocal(criterion.id, otherId);
        this.#addReciprocal(otherId, criterion.id);
      }
    }
  }

  #addReciprocal(a: string, b: string): void {
    let set = this.#equivalenceReciprocal.get(a);
    if (!set) {
      set = new Set();
      this.#equivalenceReciprocal.set(a, set);
    }
    set.add(b);
  }

  /** Returns the criterion or undefined. */
  get(id: string): Criterion | undefined {
    return this.#byId.get(id);
  }

  /** True if the criterion is loaded. */
  has(id: string): boolean {
    return this.#byId.has(id);
  }

  /** All criteria across all loaded standards. */
  all(): readonly Criterion[] {
    return [...this.#byId.values()];
  }

  /**
   * Returns the full closure of criterion IDs equivalent to the input
   * (including the input itself). Used by the standard-filter to fan
   * out a rule's `satisfies` list across cross-standard equivalents.
   */
  equivalenceClosure(criterionId: string): readonly string[] {
    const visited = new Set<string>([criterionId]);
    const queue: string[] = [criterionId];
    while (queue.length > 0) {
      const next = queue.shift();
      if (next === undefined) break;
      const neighbors = this.#equivalenceReciprocal.get(next);
      if (!neighbors) continue;
      for (const n of neighbors) {
        if (!visited.has(n)) {
          visited.add(n);
          queue.push(n);
        }
      }
    }
    return [...visited];
  }

  /** Total loaded criteria across all standards. */
  get size(): number {
    return this.#byId.size;
  }
}
