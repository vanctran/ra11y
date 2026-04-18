/**
 * Shared `skipCriterion` JSON-Schema fragment for the MCP tools that
 * accept caller-driven criterion filtering. Exporting a single constant
 * keeps the description in one place and lets scan_project / checklist
 * stay under their file-line budgets.
 *
 * The filter is *caller* behavior, not tool suppression — the agent is
 * dropping criteria it has already audited from its own follow-up calls.
 * CLAUDE.md §1 permits this because the signal is explicit and visible
 * in the response (`meta.skippedByCaller` / `summary.skippedByCaller`).
 */

export const skipCriterionSchema = {
  type: "array",
  items: { type: "string" },
  description:
    "Caller-driven criterion filter — criterion IDs to exclude from the response. Findings / checklist entries whose criteria list is fully contained in this set are dropped; anything also tied to an un-skipped criterion stays. Not suppression by the tool (§1 doctrine); the caller is filtering its own result. Reflected in `meta.skippedByCaller` (scan_project) or `summary.skippedByCaller` (checklist).",
} as const;

/**
 * Conditional-spread helper for the `skippedByCaller` field. Returns
 * the empty object when the caller passed no skip list; returns the
 * populated field otherwise. Extracted so scan-tool handlers can
 * spread unconditionally and keep their cognitive complexity inside
 * the lint budget.
 */
export function skippedByCallerField(skipCriterion: readonly string[] | undefined): {
  readonly skippedByCaller?: readonly string[];
} {
  if (skipCriterion === undefined || skipCriterion.length === 0) return {};
  return { skippedByCaller: skipCriterion };
}
