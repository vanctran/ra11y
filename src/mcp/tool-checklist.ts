/**
 * The `checklist` MCP tool. Split into its own file so src/mcp/tools.ts
 * stays under the file budget — the tool now includes element-presence
 * detection and relevance hints, which is meaningful logic to keep out
 * of the central tool-registration module.
 */

import type { ParsedFile } from "../engine/scanner.ts";
import { runScan } from "../engine/scanner.ts";
import { buildCoverageReport, type PerStandardCoverage } from "../reports/coverage.ts";
import { BUILTIN_CANDIDATE_FINDERS } from "../review/index.ts";
import { BUILTIN_RULES } from "../rules/index.ts";
import { BUILTIN_STANDARDS } from "../standards/index.ts";
import type { ReviewCandidate } from "../types/review.ts";
import {
  applyRuleSettings,
  findStandard,
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

interface ChecklistItemOut {
  readonly criterionId: string;
  readonly title: string;
  readonly level: string;
  readonly priority: ChecklistPriority;
  readonly candidates: readonly ChecklistCandidateOut[];
  readonly likelyRelevant?: false;
  readonly relevanceReason?: string;
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
    const level = resolveLevel(strParam(params, "level"), session);
    const files = await parseFiles(paths, session, cwd);

    const { result, report } = runScan({
      standards: BUILTIN_STANDARDS,
      rules: applyRuleSettings(BUILTIN_RULES, session.config.rules),
      enabled: standards,
      files,
      finders: BUILTIN_CANDIDATE_FINDERS,
    });

    const coverage = buildCoverageReport(result, BUILTIN_STANDARDS, level);
    const presence = detectElementPresence(files);

    const { needsReview, likelyIrrelevant } = bucketChecklistItems(
      coverage,
      report.candidates ?? [],
      presence,
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
    const summary = {
      totalManualCriteria: actionable.length + untargeted.length + likelyIrrelevant.length,
      actionable: actionable.length,
      untargeted: untargeted.length,
      likelyIrrelevant: likelyIrrelevant.length,
      byPriority,
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

interface ElementPresence {
  readonly hasMedia: boolean;
}

/**
 * Walks parsed files once to learn what element families are present.
 * Used to tell the agent when a manual criterion is obviously irrelevant
 * (e.g., no `<video>` or `<audio>` → 1.2.* captions/audio criteria don't
 * apply to this repo). Zero AST traversal — a cheap text scan is enough
 * for a hint, and we're ok with the occasional false positive from a
 * string literal that happens to contain "<video".
 */
function detectElementPresence(files: readonly ParsedFile[]): ElementPresence {
  let hasMedia = false;
  for (const f of files) {
    const lower = f.source.toLowerCase();
    if (lower.includes("<video") || lower.includes("<audio")) {
      hasMedia = true;
      break;
    }
  }
  return { hasMedia };
}

const MEDIA_ONLY_CRITERIA: ReadonlySet<string> = new Set([
  "wcag22:1.2.1",
  "wcag22:1.2.2",
  "wcag22:1.2.3",
  "wcag22:1.2.4",
  "wcag22:1.2.5",
  "wcag22:1.2.6",
  "wcag22:1.2.7",
  "wcag22:1.2.8",
  "wcag22:1.2.9",
  "wcag22:1.4.2",
  "wcag21:1.2.1",
  "wcag21:1.2.2",
  "wcag21:1.2.3",
  "wcag21:1.2.4",
  "wcag21:1.2.5",
  "wcag21:1.2.6",
  "wcag21:1.2.7",
  "wcag21:1.2.8",
  "wcag21:1.2.9",
  "wcag21:1.4.2",
]);

/**
 * Returns a relevance hint for a manual criterion based on detected
 * elements. Conservative: only flags media criteria as irrelevant when
 * no <video>/<audio> is present. Everything else defaults to likely
 * relevant — human judgment is expected on the rest.
 */
function assessRelevance(
  criterionId: string,
  presence: ElementPresence,
): { readonly likelyRelevant: boolean; readonly reason?: string } {
  if (MEDIA_ONLY_CRITERIA.has(criterionId) && !presence.hasMedia) {
    return {
      likelyRelevant: false,
      reason: "No <video> or <audio> elements detected in the scanned files.",
    };
  }
  return { likelyRelevant: true };
}

function mapCandidates(
  criterionId: string,
  candidates: readonly ReviewCandidate[],
): ChecklistCandidateOut[] {
  return candidates
    .filter((c) => c.criterionId === criterionId)
    .map((c) => ({ path: c.location.filePath, line: c.location.line, reason: c.reason }));
}

function buildChecklistItem(
  criterion: { id: string; title: string; level: string },
  candidates: readonly ReviewCandidate[],
  presence: ElementPresence,
): { item: ChecklistItemOut; relevant: boolean } {
  const relevance = assessRelevance(criterion.id, presence);
  const mapped = mapCandidates(criterion.id, candidates);
  const base = {
    criterionId: criterion.id,
    title: criterion.title,
    level: criterion.level,
    priority: priorityFor(criterion.level, mapped.length > 0),
    candidates: mapped,
  };
  if (relevance.likelyRelevant !== false) return { item: base, relevant: true };
  const item = relevance.reason
    ? { ...base, likelyRelevant: false as const, relevanceReason: relevance.reason }
    : { ...base, likelyRelevant: false as const };
  return { item, relevant: false };
}

function bucketChecklistItems(
  coverage: readonly PerStandardCoverage[],
  candidates: readonly ReviewCandidate[],
  presence: ElementPresence,
): { needsReview: ChecklistItemOut[]; likelyIrrelevant: ChecklistItemOut[] } {
  const needsReview: ChecklistItemOut[] = [];
  const likelyIrrelevant: ChecklistItemOut[] = [];
  for (const entry of coverage) {
    const standard = findStandard(entry.standardId);
    if (!standard) continue;
    for (const criterionId of entry.manualCriteria) {
      const criterion = standard.criteria.find((c) => c.id === criterionId);
      if (!criterion) continue;
      const { item, relevant } = buildChecklistItem(criterion, candidates, presence);
      (relevant ? needsReview : likelyIrrelevant).push(item);
    }
  }
  const rank: Readonly<Record<ChecklistPriority, number>> = { high: 0, medium: 1, low: 2 };
  needsReview.sort((a, b) => rank[a.priority] - rank[b.priority]);
  return { needsReview, likelyIrrelevant };
}
