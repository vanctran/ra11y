/**
 * Criterion-ID → human-title alignment helper.
 *
 * Every finding surface in ra11y carries `criteria: string[]` (the criterion
 * IDs the violation maps to across every enabled standard). Consumers that
 * render findings for humans — PR-body composition, commit messages, terminal
 * formatters, markdown reports — have historically needed a second round-trip
 * through `explain_rule` or `explain_standard` just to resolve
 * `"wcag22:2.4.5"` → `"Multiple Ways"`. This helper does that resolution in
 * one place so every surface can expose a parallel `criteriaTitles` array
 * without open-coding the lookup.
 *
 * The invariant is positional: `criteriaTitles[i]` is the title of
 * `criteria[i]`. Callers MUST preserve input order; this helper does not
 * sort or dedupe.
 *
 * Fallback policy: when a criterion ID cannot be resolved against the
 * supplied lookup (e.g. because the owning standard isn't loaded), the
 * criterion ID itself is used as the title. Per CLAUDE.md §1 "Ambiguous
 * field shapes are dishonest," emitting an empty string would let a
 * downstream consumer silently render a blank title; the ID is always
 * a non-empty, deterministic fallback the agent can still act on.
 */

/**
 * Resolves each criterion ID to a short human title, preserving input order.
 *
 * @param criteria - Criterion IDs (e.g. `["wcag22:2.4.5", "wcag21:2.4.5"]`)
 * @param lookup - A resolver that returns the title for a criterion ID, or
 *   `undefined` if the ID is not known. Most callers should pass
 *   `(id) => criteriaRegistry.get(id)?.title`.
 * @returns Titles aligned index-for-index with `criteria`; unresolved IDs
 *   fall back to the ID itself. Never contains empty strings.
 *
 * @example
 *   titlesForCriteria(
 *     ["wcag22:2.4.5"],
 *     (id) => id === "wcag22:2.4.5" ? "Multiple Ways" : undefined,
 *   );
 *   // => ["Multiple Ways"]
 *
 * @example
 *   // Unknown ID: falls back to the ID rather than emitting "".
 *   titlesForCriteria(["wcag22:9.9.9"], () => undefined);
 *   // => ["wcag22:9.9.9"]
 */
export function titlesForCriteria(
  criteria: readonly string[],
  lookup: (criterionId: string) => string | undefined,
): readonly string[] {
  const out: string[] = [];
  for (const id of criteria) {
    const title = lookup(id);
    out.push(title !== undefined && title.length > 0 ? title : id);
  }
  return out;
}
