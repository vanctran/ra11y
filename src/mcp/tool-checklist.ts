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
import type { ReviewCandidate, ReviewConfidence } from "../types/review.ts";
import {
  type Applicability,
  detectApplicability,
  irrelevanceReason,
  isLikelyIrrelevant,
} from "./manual-applicability.ts";
import { buildSnippetForReason, type SourceEntry, sourceIndex } from "./source-snippet.ts";
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
  readonly confidence: ReviewConfidence;
  readonly snippet?: string;
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
  /**
   * Item-level confidence. When the criterion is grounded in at
   * least one finder-emitted candidate, this is the highest
   * confidence across those candidates (a single "high" hit is the
   * signal that sizes the item even if other hits are "low"). When
   * no finder grounded the criterion (a bare-criterion pure WCAG
   * prompt), this is "low" — by definition there is no specific
   * evidence at the criterion level. Same enum/semantics as the
   * per-candidate `confidence`.
   */
  readonly confidence: ReviewConfidence;
  readonly principle?: WcagPrinciple;
  readonly candidates: readonly ChecklistCandidateOut[];
  readonly likelyRelevant?: false;
  readonly relevanceReason?: string;
}

const CONFIDENCE_RANK: Readonly<Record<ReviewConfidence, number>> = {
  high: 3,
  medium: 2,
  low: 1,
};

function highestConfidence(
  candidates: readonly { readonly confidence: ReviewConfidence }[],
): ReviewConfidence | null {
  let best: ReviewConfidence | null = null;
  for (const c of candidates) {
    if (best === null || CONFIDENCE_RANK[c.confidence] > CONFIDENCE_RANK[best]) {
      best = c.confidence;
    }
  }
  return best;
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
        limit: {
          type: "number",
          description:
            "Maximum number of *candidates* (across all items) to include in the response. Defaults to 200, clamped to [1, 2000]. Caps response size for noisy criteria without silencing them — the scan still evaluates everything, and `totalCandidates` reports the pre-paging tally. When the cap truncates, the response carries `truncated: true` and `nextOffset: N`; call again with `offset: N` to page.",
        },
        offset: {
          type: "number",
          description:
            "Starting index into the flat candidates stream (items are walked in priority order; candidates concatenate across items). Defaults to 0. Pair with `limit` and the `nextOffset` from a previous truncated response.",
        },
        maxCandidatesPerCriterion: {
          type: "number",
          description:
            "Caps candidates per criterion within the returned page — orthogonal to `limit`. Defaults to 10, clamped to [1, 100]. Prevents one noisy criterion from consuming the whole page without hiding it. When any criterion is clipped, the response carries `perCriterionClipped: true`; `totalCandidates` still reports the pre-clip tally so the agent can see what was elided.",
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

    const sources = sourceIndex(files);
    const { needsReview, likelyIrrelevant } = bucketChecklistItems(
      coverage,
      report.candidates ?? [],
      applicability,
      sources,
    );
    // Actionable items (concrete candidates) stay in `items`; criteria
    // the finders couldn't ground in code move to `untargeted`. Keeping
    // them in separate fields prevents 18 bare WCAG titles from burying
    // 3 real finds, which was the dominant feedback after the first
    // priority pass. Agents that still want the full list can compose
    // [...items, ...untargeted].
    const actionable = needsReview.filter((i) => i.candidates.length > 0);
    const untargeted = needsReview.filter((i) => i.candidates.length === 0);
    // Q2-CHECKLIST-LIMIT: pagination over the candidate stream. The
    // scan still evaluates every criterion — this caps response size
    // so a noisy finder (say, 200 ambiguous focus-order candidates in
    // a big React tree) can't dominate the agent's token budget. Two
    // orthogonal axes:
    //   - maxCandidatesPerCriterion clips per-criterion, so one loud
    //     criterion can't crowd out quieter ones in the same page.
    //   - limit/offset paginate the flattened candidates stream across
    //     all items.
    // Honest-shape (CLAUDE.md §1 "Ambiguous field shapes are
    // dishonest"): `truncated`/`nextOffset` are spread only when the
    // global limit actually clips; `perCriterionClipped` is spread
    // only when per-criterion clipping actually happened. Consumers
    // branch on presence, not on a sentinel false/0.
    const pageParams = readChecklistPageParams(params);
    const page = paginateChecklistItems(actionable, pageParams);
    // `byPriority` counts the full actionable inventory (not just the
    // current page) so the summary stays a stable project-level
    // number across paging calls. Page-scoped counts would force the
    // agent to sum them manually, which is the dishonest-composite
    // failure mode (CLAUDE.md §1).
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
      items: page.items,
      totalCandidates: page.totalCandidates,
      ...page.paginationFields,
      ...(showUntargeted ? { untargeted } : {}),
      likelyIrrelevant,
    });
  },
};

function mapCandidates(
  criterionId: string,
  candidates: readonly ReviewCandidate[],
  sources: ReadonlyMap<string, SourceEntry>,
): ChecklistCandidateOut[] {
  return candidates
    .filter((c) => c.criterionId === criterionId)
    .map((c) => {
      // Prefer a finder-supplied snippet (cross-file finders sometimes
      // know the right window better than ±3 lines), else fall back to
      // a cache-only lookup. Omit the field when neither is available
      // — empty-string is a dishonest shape per CLAUDE.md §1.
      const snippet = finderOrBuiltSnippet(c, sources);
      // `confidence` passes through verbatim from the finder. See
      // CLAUDE.md §1 — this is identity-like metadata, not an
      // optional enrichment, so it is always present.
      return {
        path: c.location.filePath,
        line: c.location.line,
        reason: c.reason,
        confidence: c.confidence,
        ...(snippet === undefined ? {} : { snippet }),
      };
    });
}

function finderOrBuiltSnippet(
  c: ReviewCandidate,
  sources: ReadonlyMap<string, SourceEntry>,
): string | undefined {
  if (typeof c.snippet === "string" && c.snippet.length > 0) return c.snippet;
  const entry = sources.get(c.location.filePath);
  if (entry === undefined) return undefined;
  return buildSnippetForReason({
    source: entry.source,
    line: c.location.line,
    reason: c.reason,
    language: entry.language,
  });
}

function buildChecklistItem(
  criterion: { id: string; standardId: string; localId: string; title: string; level: string },
  candidates: readonly ReviewCandidate[],
  applicability: Applicability,
  sources: ReadonlyMap<string, SourceEntry>,
): { item: ChecklistItemOut; relevant: boolean } {
  const mapped = mapCandidates(criterion.id, candidates, sources);
  const principle = wcagPrincipleFor(criterion.standardId, criterion.localId);
  // Bare-criterion items (no candidates grounded by a finder) carry
  // "low" confidence — by definition the scanner has no specific
  // evidence tying this criterion to the scanned code. Grounded
  // items take the highest confidence across their candidates, so a
  // single "high" hit sizes the item honestly even when other hits
  // are lower-signal.
  const itemConfidence: ReviewConfidence = highestConfidence(mapped) ?? "low";
  const base: ChecklistItemOut = {
    criterionId: criterion.id,
    title: criterion.title,
    level: criterion.level,
    priority: priorityFor(criterion.level, mapped.length > 0),
    confidence: itemConfidence,
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
  sources: ReadonlyMap<string, SourceEntry>,
): { needsReview: ChecklistItemOut[]; likelyIrrelevant: ChecklistItemOut[] } {
  const needsReview: ChecklistItemOut[] = [];
  const likelyIrrelevant: ChecklistItemOut[] = [];
  for (const entry of coverage) {
    const standard = findStandard(entry.standardId);
    if (!standard) continue;
    for (const criterionId of entry.manualCriteria) {
      const criterion = standard.criteria.find((c) => c.id === criterionId);
      if (!criterion) continue;
      const { item, relevant } = buildChecklistItem(criterion, candidates, applicability, sources);
      (relevant ? needsReview : likelyIrrelevant).push(item);
    }
  }
  const rank: Readonly<Record<ChecklistPriority, number>> = { high: 0, medium: 1, low: 2 };
  needsReview.sort((a, b) => rank[a.priority] - rank[b.priority]);
  return { needsReview, likelyIrrelevant };
}

/**
 * Default candidates-per-response cap for the `checklist` tool
 * (Q2-CHECKLIST-LIMIT). Chosen to mirror scan_project's default so
 * both tools paginate at the same ballpark.
 */
const CHECKLIST_DEFAULT_LIMIT = 200;
/** Minimum caller-supplied `limit`. Below this we clamp up. */
const CHECKLIST_MIN_LIMIT = 1;
/** Maximum caller-supplied `limit`. Above this we clamp down. */
const CHECKLIST_MAX_LIMIT = 2000;
/**
 * Default per-criterion candidate cap. Keeps one noisy finder from
 * dominating a single page without silencing it — the agent still
 * sees the criterion appear and `perCriterionClipped: true` flagging
 * that more evidence exists for follow-up.
 */
const CHECKLIST_DEFAULT_MAX_PER_CRITERION = 10;
/** Minimum caller-supplied `maxCandidatesPerCriterion`. */
const CHECKLIST_MIN_MAX_PER_CRITERION = 1;
/** Maximum caller-supplied `maxCandidatesPerCriterion`. */
const CHECKLIST_MAX_MAX_PER_CRITERION = 100;

/**
 * Resolved pagination inputs for the `checklist` tool. All three
 * fields are clamped to their documented bounds; callers never see
 * un-clamped values.
 */
export interface ChecklistPageParams {
  /** Max candidates across the whole response, clamped to [1, 2000]. */
  readonly limit: number;
  /** Starting index into the flat candidates stream, clamped to >=0. */
  readonly offset: number;
  /** Max candidates per criterion in the page, clamped to [1, 100]. */
  readonly maxCandidatesPerCriterion: number;
}

/**
 * Reads `limit` / `offset` / `maxCandidatesPerCriterion` from the MCP
 * params with silent clamping to documented bounds. Non-numeric /
 * missing values fall back to the named defaults.
 */
export function readChecklistPageParams(params: Record<string, unknown>): ChecklistPageParams {
  const rawLimit = typeof params["limit"] === "number" ? params["limit"] : CHECKLIST_DEFAULT_LIMIT;
  const rawOffset = typeof params["offset"] === "number" ? params["offset"] : 0;
  const rawPerCriterion =
    typeof params["maxCandidatesPerCriterion"] === "number"
      ? params["maxCandidatesPerCriterion"]
      : CHECKLIST_DEFAULT_MAX_PER_CRITERION;
  const limit = Math.max(CHECKLIST_MIN_LIMIT, Math.min(CHECKLIST_MAX_LIMIT, Math.floor(rawLimit)));
  const offset = Math.max(0, Math.floor(rawOffset));
  const maxCandidatesPerCriterion = Math.max(
    CHECKLIST_MIN_MAX_PER_CRITERION,
    Math.min(CHECKLIST_MAX_MAX_PER_CRITERION, Math.floor(rawPerCriterion)),
  );
  return { limit, offset, maxCandidatesPerCriterion };
}

/**
 * Paginated checklist output: the clipped + sliced items that fit in
 * the page, the pre-paging / pre-per-criterion-clip total (so the
 * agent sees the full inventory size), and conditionally-spread
 * truncation flags.
 */
export interface PaginatedChecklist {
  /** Items in page order — candidates on each item already clipped and sliced. */
  readonly items: readonly ChecklistItemOut[];
  /**
   * Pre-paging, pre-per-criterion-clip total candidate count across
   * all actionable items. Always present so the agent knows the full
   * inventory even on page 1.
   */
  readonly totalCandidates: number;
  /**
   * Honest-shape pagination fields. `truncated: true` + `nextOffset`
   * appear together iff the global `limit` clipped the flat stream;
   * `perCriterionClipped: true` appears iff at least one criterion
   * was clipped by `maxCandidatesPerCriterion`. Orthogonal signals —
   * either, both, or neither may be present.
   */
  readonly paginationFields: {
    readonly truncated?: true;
    readonly nextOffset?: number;
    readonly perCriterionClipped?: true;
  };
}

/**
 * Applies the per-criterion cap, then slices the flattened candidate
 * stream by `offset` + `limit`. Items that end up with zero
 * candidates in the page are dropped — the agent sees only the
 * criteria with live evidence in this slice.
 *
 * Honest-shape: `truncated`/`nextOffset` are spread only when the
 * global cap actually clips the list (CLAUDE.md §1). Per-criterion
 * clipping is an orthogonal signal (`perCriterionClipped: true`),
 * so a page can be truncated without any criterion being clipped,
 * clipped without being truncated, both, or neither.
 */
export function paginateChecklistItems(
  items: readonly ChecklistItemOut[],
  { limit, offset, maxCandidatesPerCriterion }: ChecklistPageParams,
): PaginatedChecklist {
  let totalCandidates = 0;
  let perCriterionClipped = false;
  // Phase 1 — per-criterion clip. Walk items in order; for each,
  // accumulate the raw total (pre-clip) and build a clipped copy.
  const clipped: ChecklistItemOut[] = [];
  for (const item of items) {
    totalCandidates += item.candidates.length;
    if (item.candidates.length > maxCandidatesPerCriterion) {
      perCriterionClipped = true;
      clipped.push({
        ...item,
        candidates: item.candidates.slice(0, maxCandidatesPerCriterion),
      });
    } else {
      clipped.push(item);
    }
  }
  // Phase 2 — flat-stream pagination across clipped items. Walk with
  // a running global index; each item emits the candidate slice that
  // falls inside [offset, offset + limit). Items entirely outside
  // that window are dropped.
  const rangeEnd = offset + limit;
  const pageItems: ChecklistItemOut[] = [];
  let globalIdx = 0;
  let postClipTotal = 0;
  for (const item of clipped) {
    postClipTotal += item.candidates.length;
    const itemStart = globalIdx;
    const itemEnd = globalIdx + item.candidates.length;
    globalIdx = itemEnd;
    if (itemEnd <= offset) continue; // entirely before the window
    if (itemStart >= rangeEnd) continue; // entirely after the window
    const sliceStart = Math.max(0, offset - itemStart);
    const sliceEnd = Math.min(item.candidates.length, rangeEnd - itemStart);
    pageItems.push({
      ...item,
      candidates: item.candidates.slice(sliceStart, sliceEnd),
    });
  }
  const truncated = rangeEnd < postClipTotal;
  return {
    items: pageItems,
    totalCandidates,
    paginationFields: {
      ...(truncated ? { truncated: true as const, nextOffset: rangeEnd } : {}),
      ...(perCriterionClipped ? { perCriterionClipped: true as const } : {}),
    },
  };
}
