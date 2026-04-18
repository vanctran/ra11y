/**
 * buildAgentPlan — violations + pre-built findings → AgentPlan headline.
 *
 * Replaces the former composite `fixSuggestionAvailable` counter with the
 * doctrine-compliant split:
 *   - `mechanicalEditsAvailable` — violations with `fixPaths?.primary.edit`
 *     present; deterministic, batch-apply work.
 *   - `guidanceFixesAvailable`   — violations with prose `suggestion` but no
 *     mechanical edit; route-to-rewrite work.
 *
 * Per CLAUDE.md §1 "Composite headline counts are dishonest": summing
 * categorically different sub-buckets into one counter forces agents to
 * budget against an inflated or misleading number. The split is honest
 * because both labels are provable from the Violation shape alone.
 *
 * Effort is computed from the combined fix count
 * (mechanicalEditsAvailable + guidanceFixesAvailable) so the semantics
 * are equivalent to the former formula that summed fixSuggestionAvailable.
 */

import type { Violation } from "../../types/violation.ts";
import type { AgentFile, AgentPlan, Effort } from "./types.ts";

const MODERATE_THRESHOLD = 5;
const TOP_RULES_COUNT = 3;

function computeEffort(total: number, fixCount: number): Effort {
  if (total === 0) return "trivial";
  if (fixCount === 0) return "trivial"; // all notes/review — nothing to fix
  if (fixCount > MODERATE_THRESHOLD) return "moderate";
  return "trivial";
}

function topN(map: Map<string, number>, n: number): [string, number][] {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
}

function buildSummary(
  total: number,
  mechanicalEdits: number,
  guidanceFixes: number,
  reviewNeeded: number,
  manualOnly: number,
  ruleCounts: Map<string, number>,
): string {
  if (total === 0) return "No accessibility violations found.";

  const parts: string[] = [];
  if (mechanicalEdits > 0)
    parts.push(`${mechanicalEdits} mechanical edit${mechanicalEdits === 1 ? "" : "s"}`);
  if (guidanceFixes > 0)
    parts.push(`${guidanceFixes} guidance fix${guidanceFixes === 1 ? "" : "es"}`);
  if (reviewNeeded > 0) parts.push(`${reviewNeeded} need review`);
  if (manualOnly > 0) parts.push(`${manualOnly} manual`);

  const countSuffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  const noun = total === 1 ? "finding" : "findings";
  let summary = `${total} ${noun}${countSuffix}.`;

  const topRules = topN(ruleCounts, TOP_RULES_COUNT);
  if (topRules.length > 0) {
    const ruleList = topRules.map(([id, n]) => `${id} (${n})`).join(", ");
    summary += ` Most common: ${ruleList}.`;
  }

  return summary;
}

export interface FixCounts {
  readonly mechanicalEditsAvailable: number;
  readonly guidanceFixesAvailable: number;
}

/**
 * Count mechanical vs guidance fixes from source violations. Exported so
 * the MCP layer can reuse the same split-counter accounting without
 * rebuilding a full {@link AgentPlan} — its plan wrapper carries
 * MCP-specific fields (actionableManualItems, untargetedCriteria,
 * limitations, etc.) that the CLI plan deliberately doesn't.
 */
export function countFixes(violations: readonly Violation[]): FixCounts {
  let mechanicalEditsAvailable = 0;
  let guidanceFixesAvailable = 0;
  for (const v of violations) {
    const hasMechanicalEdit = v.fixPaths?.primary.edit !== undefined;
    if (hasMechanicalEdit) {
      mechanicalEditsAvailable += 1;
    } else if (typeof v.suggestion === "string" && v.suggestion.length > 0) {
      guidanceFixesAvailable += 1;
    }
  }
  return { mechanicalEditsAvailable, guidanceFixesAvailable };
}

interface CategoryCounts {
  readonly reviewNeeded: number;
  readonly manualOnly: number;
  readonly ruleCounts: Map<string, number>;
}

/** Tally review/manual categories and per-rule counts from pre-built findings. */
function countCategories(files: readonly AgentFile[]): CategoryCounts {
  let reviewNeeded = 0;
  let manualOnly = 0;
  const ruleCounts = new Map<string, number>();
  for (const file of files) {
    for (const finding of file.findings) {
      if (finding.category === "review") reviewNeeded += 1;
      else if (finding.category === "manual") manualOnly += 1;
      ruleCounts.set(finding.ruleId, (ruleCounts.get(finding.ruleId) ?? 0) + 1);
    }
  }
  return { reviewNeeded, manualOnly, ruleCounts };
}

/**
 * Build the {@link AgentPlan} headline from source violations and their
 * pre-built {@link AgentFile} representations.
 *
 * @param violations - The source violations (used for mechanical-edit detection
 *   via `fixPaths.primary.edit` and guidance detection via `suggestion`).
 * @param files - Pre-built AgentFile array (used for per-rule counts and
 *   category tallies that derive from the finding shape).
 * @param totalFindings - Total finding count (usually `violations.length`;
 *   passed in so callers can apply pre-filtering without recomputing here).
 */
export function buildAgentPlan(
  violations: readonly Violation[],
  files: readonly AgentFile[],
  totalFindings: number,
): AgentPlan {
  const { mechanicalEditsAvailable, guidanceFixesAvailable } = countFixes(violations);
  const { reviewNeeded, manualOnly, ruleCounts } = countCategories(files);
  const fixCount = mechanicalEditsAvailable + guidanceFixesAvailable;
  const effort = computeEffort(totalFindings, fixCount);
  const summary = buildSummary(
    totalFindings,
    mechanicalEditsAvailable,
    guidanceFixesAvailable,
    reviewNeeded,
    manualOnly,
    ruleCounts,
  );

  return {
    totalFindings,
    mechanicalEditsAvailable,
    guidanceFixesAvailable,
    reviewNeeded,
    manualOnly,
    estimatedEffort: effort,
    summary,
  };
}
