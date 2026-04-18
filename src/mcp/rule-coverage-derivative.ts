/**
 * Top-level `ruleCoverage` derivative for MCP scan responses.
 *
 * Splits the scanner's per-rule coverage array into two ruleId lists so
 * agents can branch on "0 findings that I should trust" vs. "0 findings
 * for a rule that never had anything to evaluate." The shape is:
 *
 *   ruleCoverage: {
 *     confidentlyClean:    string[],  // 0 findings, coverage was "high"
 *     lowConfidenceClean:  string[],  // 0 findings, coverage was "low"
 *   }
 *
 * Only emitted when at least one rule in `perRuleCoverage` produced 0
 * findings — the derivative is noise on already-flagged scans (every
 * rule that fired shows up in `files[]`, so re-deriving "confidently
 * clean" across the full rule set on top of a non-clean scan adds no
 * signal).
 *
 * Pairs with `meta.perRuleCoverage` (the underlying rows) per the
 * AI-first consumer doctrine in docs/kb/architecture/ai-first-consumer.md
 * — the headline is honest (two counters, one kind of thing each), and
 * the per-rule telemetry is available for agents that want to drill
 * down.
 */

import type { PerRuleCoverage, Violation } from "../types/violation.ts";

export interface RuleCoverageDerivative {
  readonly confidentlyClean: readonly string[];
  readonly lowConfidenceClean: readonly string[];
}

/**
 * Computes the `ruleCoverage` derivative from per-rule coverage rows
 * and the post-filter violation list. Returns `null` when no rule in
 * `perRuleCoverage` produced 0 findings — the caller uses the null to
 * omit the field entirely (CLAUDE.md §1 "Ambiguous field shapes are
 * dishonest": never emit `{ confidentlyClean: [], lowConfidenceClean: [] }`
 * when the concept doesn't apply).
 *
 * `violations` is expected to be post-filter (severity / criterion skip
 * / wrapper-noise), matching the user-visible count. A rule silenced
 * by the session's min-severity filter is treated as "0 findings for
 * this consumer" — which is the right shape for the consumer reading
 * the response, since the scan_project plan already accounts for the
 * filter. The underlying scanner-level violation is still tracked in
 * the broader ScanResult if a different consumer wants it.
 */
export function buildRuleCoverageDerivative(
  perRuleCoverage: readonly PerRuleCoverage[],
  violations: readonly Violation[],
): RuleCoverageDerivative | null {
  const firedRuleIds = new Set<string>();
  for (const v of violations) firedRuleIds.add(v.ruleId);
  const confidentlyClean: string[] = [];
  const lowConfidenceClean: string[] = [];
  for (const row of perRuleCoverage) {
    if (firedRuleIds.has(row.ruleId)) continue;
    if (row.coverageConfidence === "high") confidentlyClean.push(row.ruleId);
    else lowConfidenceClean.push(row.ruleId);
  }
  if (confidentlyClean.length === 0 && lowConfidenceClean.length === 0) return null;
  return {
    confidentlyClean: confidentlyClean.sort(),
    lowConfidenceClean: lowConfidenceClean.sort(),
  };
}
