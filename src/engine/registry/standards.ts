/**
 * Standards registry.
 *
 * Owns the set of loaded {@link Standard} objects. Standards are registered
 * at scanner init — built-ins from `src/standards/index.ts`, plugin
 * standards from the user config. The registry is the single place that
 * answers "is this standard loaded?" and "give me this standard's criteria."
 *
 * Registries are intentionally mutable by the engine during init and
 * read-only afterward. We don't freeze them, but we do not mutate them
 * during a scan.
 */

import type { Standard } from "../../types/standard.ts";

export class StandardsRegistry {
  readonly #standards = new Map<string, Standard>();

  /** Register a standard. Throws if the ID is already taken. */
  register(standard: Standard): void {
    if (this.#standards.has(standard.id)) {
      throw new Error(
        `ra11y: standard '${standard.id}' is already registered. Standard IDs must be globally unique.`,
      );
    }
    this.#standards.set(standard.id, standard);
  }

  /** Returns a standard by ID, or undefined. */
  get(id: string): Standard | undefined {
    return this.#standards.get(id);
  }

  /** True if the standard is loaded. */
  has(id: string): boolean {
    return this.#standards.has(id);
  }

  /** Iterates every registered standard in registration order. */
  all(): readonly Standard[] {
    return [...this.#standards.values()];
  }

  /** Returns the set of registered standard IDs. */
  ids(): readonly string[] {
    return [...this.#standards.keys()];
  }

  /** Total count of registered standards. */
  get size(): number {
    return this.#standards.size;
  }
}
