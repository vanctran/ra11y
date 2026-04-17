/**
 * The `checklist` MCP tool. Split into its own file so src/mcp/tools.ts
 * stays under the file budget — the tool now includes element-presence
 * detection and relevance hints, which is meaningful logic to keep out
 * of the central tool-registration module.
 */

import { runScan } from "../engine/scanner.ts";
import { buildCoverageReport, type PerStandardCoverage } from "../reports/coverage.ts";
import { BUILTIN_CANDIDATE_FINDERS } from "../review/index.ts";
import { BUILTIN_RULES } from "../rules/index.ts";
import { BUILTIN_STANDARDS } from "../standards/index.ts";
import type { ReviewCandidate } from "../types/review.ts";
import {
  type Applicability,
  detectApplicability,
  irrelevanceReason,
  isLikelyIrrelevant,
} from "./manual-applicability.ts";
import {
  applyRuleSettings,
  errorResult,
  findStandard,
  firstUnknownStandard,
  type McpTool,
  parseFiles,
  resolveLevel,
  resolveStandards,
  strArrayParam,
  strParam,
  textResult,
} from "./tools-helpers.ts";

interface ChecklistCandidateOut {
  readonly path: string;
  readonly line: number;
  readonly reason: string;
}

type ChecklistPriority = "high" | "medium" | "low";

interface WcagPrinciple {
  readonly number: 1 | 2 | 3 | 4;
  readonly name: "Perceivable" | "Operable" | "Understandable" | "Robust";
}

interface ChecklistItemOut {
  readonly criterionId: string;
  readonly title: string;
  readonly level: string;
  readonly priority: ChecklistPriority;
  readonly principle?: WcagPrinciple;
  readonly candidates: readonly ChecklistCandidateOut[];
  readonly likelyRelevant?: false;
  readonly relevanceReason?: string;
}

/**
 * Derives the top-level WCAG principle (1. Perceivable, 2. Operable,
 * 3. Understandable, 4. Robust) from a criterion's standard+localId.
 * Deterministic, spec-defined data — the first digit of a WCAG localId
 * IS the principle number. Returns null for non-WCAG standards
 * (Section 508, EN 301 549, etc.) whose IDs don't share the shape.
 */
function wcagPrincipleFor(standardId: string, localId: string): WcagPrinciple | null {
  if (!standardId.startsWith("wcag")) return null;
  const first = localId.split(".")[0];
  if (first === "1") return { number: 1, name: "Perceivable" };
  if (first === "2") return { number: 2, name: "Operable" };
  if (first === "3") return { number: 3, name: "Understandable" };
  if (first === "4") return { number: 4, name: "Robust" };
  return null;
}

/**
 * Priority bucket biased toward actionability. A checklist item with
 * concrete candidate locations is something a reviewer can work from
 * in the next minute; an item with no candidates is a pure WCAG
 * reminder the reviewer already has from reading the spec. We rank by
 * candidates first, level second, so the output doesn't drown real
 * finds in a sea of criterion titles.
 */
function priorityFor(level: string, hasCandidates: boolean): ChecklistPriority {
  if (!hasCandidates) return "low";
  if (level === "A" || level === "AA") return "high";
  return "medium";
}

export const checklistTool: McpTool = {
  def: {
    name: "checklist",
    description:
      "Get the manual review checklist — criteria that can't be fully automated. Returns `items` (criteria with concrete candidate locations — start here) and `likelyIrrelevant` (criteria the scan can tell don't apply, e.g., no <video>/<audio> for 1.2.*). The summary also reports `untargeted`: criteria with no candidates the finders could ground in code. Pass `showUntargeted: true` to include them in the response when you're preparing a VPAT or running a formal audit — by default they're counted but not returned, since 18 bare WCAG titles will drown 3 real finds.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional. File or directory paths to scan. Omit for a project-wide checklist rooted at `cwd`.",
        },
        standard: { type: "string", description: "Standard ID." },
        level: { type: "string", enum: ["A", "AA", "AAA"], description: "Conformance level." },
        cwd: {
          type: "string",
          description:
            "Base directory. Used as the scan root when `paths` is omitted, and for resolving relative `paths` when given.",
        },
        showUntargeted: {
          type: "boolean",
          description:
            "Include the full list of manual criteria without candidates (pure WCAG prompts). Default false; the summary still reports the count.",
        },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async handler(params, session) {
    const cwd = strParam(params, "cwd") ?? process.cwd();
    const paths = strArrayParam(params, "paths") ?? [cwd];

    const standards = resolveStandards(strParam(params, "standard"), session);
    const unknown = firstUnknownStandard(standards);
    if (unknown !== null) {
      const known = BUILTIN_STANDARDS.map((s) => s.id).join(", ");
      return errorResult({
        code: "standard-not-found",
        message: `Unknown standard '${unknown}'. Loaded: ${known}.`,
        details: { requested: unknown, loaded: BUILTIN_STANDARDS.map((s) => s.id) },
        remediation:
          "Pass `standard` with one of the loaded IDs, or omit to use the session default.",
      });
    }
    const level = resolveLevel(strParam(params, "level"), session);
    const files = await parseFiles(paths, session, cwd);

    const { result, report } = runScan({
      standards: BUILTIN_STANDARDS,
      rules: applyRuleSettings(BUILTIN_RULES, session.config.rules),
      enabled: standards,
      files,
      finders: BUILTIN_CANDIDATE_FINDERS,
      level,
    });

    const coverage = buildCoverageReport(result, BUILTIN_STANDARDS, level);
    const applicability = detectApplicability(files);

    const { needsReview, likelyIrrelevant } = bucketChecklistItems(
      coverage,
      report.candidates ?? [],
      applicability,
    );
    // Actionable items (concrete candidates) stay in `items`; criteria
    // the finders couldn't ground in code move to `untargeted`. Keeping
    // them in separate fields prevents 18 bare WCAG titles from burying
    // 3 real finds, which was the dominant feedback after the first
    // priority pass. Agents that still want the full list can compose
    // [...items, ...untargeted].
    const actionable = needsReview.filter((i) => i.candidates.length > 0);
    const untargeted = needsReview.filter((i) => i.candidates.length === 0);
    const byPriority = { high: 0, medium: 0, low: 0 };
    for (const item of actionable) byPriority[item.priority] += 1;
    // `manualReviewRequired` is the single canonical count agents can
    // expect to see agree across scan/scan_project/coverage/checklist:
    // it excludes `likelyIrrelevant` because those criteria don't apply
    // to the scanned files (irrelevance is itself a finding). The prior
    // `totalManualCriteria` field counted everything and kept
    // contradicting the other surfaces.
    // Coverage pass-rate numbers, inlined so an agent doesn't need a
    // separate `coverage` call. Keyed by standardId when the session has
    // more than one enabled; flattened when exactly one, so the common
    // single-standard case stays shallow.
    const automatedCoverage =
      coverage.length === 1
        ? {
            standardId: coverage[0]?.standardId,
            automatedCriteriaPassRate: coverage[0]?.automatedPassRate,
            criteriaAutomatable: coverage[0]?.automatable,
            criteriaAutomatablePassing: coverage[0]?.passing,
          }
        : coverage.map((c) => ({
            standardId: c.standardId,
            automatedCriteriaPassRate: c.automatedPassRate,
            criteriaAutomatable: c.automatable,
            criteriaAutomatablePassing: c.passing,
          }));
    // Field order is load-bearing — the agent reads top-to-bottom and
    // uses the leading fields as the headline. Actionable-first puts
    // the thing the agent can work on right now above the volumetric
    // counters. `manualReviewRequired` stays as the cross-tool total
    // (must match scan / scan_project / coverage), but trails the
    // actionable split so it no longer dominates the summary.
    const summary = {
      headline:
        `${actionable.length} actionable · ${untargeted.length} untargeted · ` +
        `${likelyIrrelevant.length} likely irrelevant`,
      actionable: actionable.length,
      byPriority,
      untargeted: untargeted.length,
      // One-line gloss: untargeted count is cryptic on its own — the
      // agent's read-order goes summary → items, so the definition
      // belongs here, not buried in the tool docstring.
      untargetedMeaning:
        "manual-review criteria whose candidate finder could not ground them in code; pass `showUntargeted: true` to see the full WCAG prompts for them.",
      likelyIrrelevant: likelyIrrelevant.length,
      manualReviewRequired: actionable.length + untargeted.length,
      automatedCoverage,
    };

    const showUntargeted = params["showUntargeted"] === true;
    return textResult({
      summary,
      items: actionable,
      ...(showUntargeted ? { untargeted } : {}),
      likelyIrrelevant,
    });
  },
};

function mapCandidates(
  criterionId: string,
  candidates: readonly ReviewCandidate[],
): ChecklistCandidateOut[] {
  return candidates
    .filter((c) => c.criterionId === criterionId)
    .map((c) => ({ path: c.location.filePath, line: c.location.line, reason: c.reason }));
}

function buildChecklistItem(
  criterion: { id: string; standardId: string; localId: string; title: string; level: string },
  candidates: readonly ReviewCandidate[],
  applicability: Applicability,
): { item: ChecklistItemOut; relevant: boolean } {
  const mapped = mapCandidates(criterion.id, candidates);
  const principle = wcagPrincipleFor(criterion.standardId, criterion.localId);
  const base: ChecklistItemOut = {
    criterionId: criterion.id,
    title: criterion.title,
    level: criterion.level,
    priority: priorityFor(criterion.level, mapped.length > 0),
    ...(principle === null ? {} : { principle }),
    candidates: mapped,
  };
  if (!isLikelyIrrelevant(criterion.id, applicability)) return { item: base, relevant: true };
  const reason = irrelevanceReason(criterion.id, applicability);
  const item = reason
    ? { ...base, likelyRelevant: false as const, relevanceReason: reason }
    : { ...base, likelyRelevant: false as const };
  return { item, relevant: false };
}

function bucketChecklistItems(
  coverage: readonly PerStandardCoverage[],
  candidates: readonly ReviewCandidate[],
  applicability: Applicability,
): { needsReview: ChecklistItemOut[]; likelyIrrelevant: ChecklistItemOut[] } {
  const needsReview: ChecklistItemOut[] = [];
  const likelyIrrelevant: ChecklistItemOut[] = [];
  for (const entry of coverage) {
    const standard = findStandard(entry.standardId);
    if (!standard) continue;
    for (const criterionId of entry.manualCriteria) {
      const criterion = standard.criteria.find((c) => c.id === criterionId);
      if (!criterion) continue;
      const { item, relevant } = buildChecklistItem(criterion, candidates, applicability);
      (relevant ? needsReview : likelyIrrelevant).push(item);
    }
  }
  const rank: Readonly<Record<ChecklistPriority, number>> = { high: 0, medium: 1, low: 2 };
  needsReview.sort((a, b) => rank[a.priority] - rank[b.priority]);
  return { needsReview, likelyIrrelevant };
}
