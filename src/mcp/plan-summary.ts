/**
 * Composes the human-readable `plan.summary` string for scan responses.
 * Extracted from tools-helpers.ts so the helpers module stays under the
 * 500-line file budget after the P1-M + P1-H split added the split-
 * counters logic.
 *
 * Leads the manual-review fragment with the actionable count (grounded
 * candidates with file:line) instead of the old composite that summed
 * grounded + bare-criterion into a single inflated headline. Per
 * CLAUDE.md §1 "Composite headline counts are dishonest," the count
 * consumers read first must match the count agents budget against.
 */

/**
 * Arguments for {@link buildPlanSummary}. Keyed rather than positional
 * because the shape grew with the P1-M + P1-H split — callers now pass
 * mechanical-edit, guidance-fix, actionable-manual, and untargeted
 * counts, and a positional signature makes the call site unreadable.
 */
export interface PlanSummaryArgs {
  readonly violations: number;
  readonly notes: number;
  readonly mechanicalEdits: number;
  readonly guidanceFixes: number;
  readonly actionableManual: number;
  readonly untargetedCriteria: number;
}

export function buildPlanSummary(args: PlanSummaryArgs): string {
  const parts = buildFindingParts(
    args.violations,
    args.notes,
    args.mechanicalEdits,
    args.guidanceFixes,
  );
  if (args.actionableManual > 0 || args.untargetedCriteria > 0) {
    parts.push(buildManualReviewPart(args.actionableManual, args.untargetedCriteria));
  }
  return `${parts.join(". ")}.`;
}

function buildFindingParts(
  violations: number,
  notes: number,
  mechanicalEdits: number,
  guidanceFixes: number,
): string[] {
  if (violations === 0 && notes === 0) return ["No automated findings"];
  const parts: string[] = [];
  if (violations > 0) {
    parts.push(
      `${violations} violation${violations === 1 ? "" : "s"}${buildFixPart(mechanicalEdits, guidanceFixes)}`,
    );
  }
  if (notes > 0) parts.push(`${notes} note${notes === 1 ? "" : "s"} to review`);
  return parts;
}

function buildFixPart(mechanicalEdits: number, guidanceFixes: number): string {
  const bits: string[] = [];
  if (mechanicalEdits > 0) {
    bits.push(`${mechanicalEdits} mechanical edit${mechanicalEdits === 1 ? "" : "s"}`);
  }
  if (guidanceFixes > 0) {
    bits.push(`${guidanceFixes} guidance fix${guidanceFixes === 1 ? "" : "es"}`);
  }
  if (bits.length === 0) return "";
  return ` (${bits.join(", ")})`;
}

/**
 * Builds the manual-review fragment of the plan summary. Leads with the
 * actionable count because that's what agents budget against; the
 * untargeted count trails as "+ N untargeted criteria" so it's visible
 * without dominating. The `checklist` call-to-action stays attached.
 */
function buildManualReviewPart(actionable: number, untargeted: number): string {
  const actionableNoun = actionable === 1 ? "item" : "items";
  const untargetedNoun = untargeted === 1 ? "criterion" : "criteria";
  if (actionable > 0 && untargeted > 0) {
    return `${actionable} actionable manual review ${actionableNoun} + ${untargeted} untargeted ${untargetedNoun} — call \`checklist\``;
  }
  if (actionable > 0) {
    return `${actionable} actionable manual review ${actionableNoun} — call \`checklist\``;
  }
  return `${untargeted} untargeted ${untargetedNoun} — call \`checklist\``;
}
