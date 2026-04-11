/**
 * Types for the Standards and Criteria layers of ra11y's three-layer model.
 *
 * A {@link Standard} is a versioned conformance framework (WCAG 2.2, WCAG 2.1,
 * Section 508, EN 301 549, …). It owns a list of {@link Criterion} records —
 * pure data, no behavior. Rules declare which criteria they `satisfies` across
 * all loaded standards, and the engine uses `Criterion.equivalentTo` to fan
 * out coverage from one standard to another without duplicating rule code.
 *
 * See docs/kb/architecture/three-layer-model.md.
 */

/** A versioned accessibility conformance framework. */
export interface Standard {
  /** Globally unique short ID used as the prefix of every criterion ID. */
  readonly id: string;
  /** Human display name. */
  readonly name: string;
  /** Spec version string (e.g., "2.2", "v3.2.1"). */
  readonly version: string;
  /** Organization that publishes the spec (W3C, ETSI, U.S. Access Board, …). */
  readonly publisher: string;
  /** Canonical URL for the top-level spec document. */
  readonly url: string;
  /** The levels this standard uses (e.g., WCAG uses ["A", "AA", "AAA"]). */
  readonly levels: readonly string[];
  /** All criteria defined by this standard. */
  readonly criteria: readonly Criterion[];
}

/** The automatability classification of a criterion. */
export type Automatability = "full" | "partial" | "manual";

/** One conformance requirement within a standard. */
export interface Criterion {
  /** Globally unique ID in the form `<standardId>:<localId>` (e.g., `wcag22:1.4.3`). */
  readonly id: string;
  /** Short ID of the owning standard. */
  readonly standardId: string;
  /** ID local to the owning standard (e.g., `1.4.3`). */
  readonly localId: string;
  /** Short human title (e.g., "Contrast (Minimum)"). */
  readonly title: string;
  /** Level within the standard (e.g., `A`, `AA`, `AAA`, `base`). */
  readonly level: string;
  /** One-line normative description. */
  readonly description: string;
  /** Deep link to the spec section. Must resolve; CI checks this. */
  readonly url: string;
  /** Can this be statically checked? */
  readonly automatable: Automatability;
  /**
   * Cross-standard equivalences. When another criterion is listed here, any
   * rule satisfying that other criterion also satisfies this one (the engine
   * walks the reciprocal index at registry init).
   */
  readonly equivalentTo?: readonly string[];
}
