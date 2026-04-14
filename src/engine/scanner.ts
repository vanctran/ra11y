/**
 * Top-level scanner orchestrator.
 *
 * Wires the standards, criteria, and rules registries together with the
 * input layer (file discovery + parsing) and the rule runner. This is the
 * single function the CLI and programmatic API call.
 *
 * Lifecycle:
 *   1. Resolve enabled standards + criteria.
 *   2. Discover files.
 *   3. For each file: parse → build context → run applicable rules.
 *   4. Collect all violations, sort deterministically.
 *   5. Build report data.
 *   6. Return ScanResult + ReportData.
 *
 * v0.0.x: the scaffold is in place but the file-discovery and parser
 * wiring land in Phase 5. `scan()` currently runs against an explicit
 * list of already-parsed file inputs so we can unit-test the engine
 * end-to-end without needing the real parsers first.
 */

import type { Ast } from "../types/ast.ts";
import type { CandidateFinder, ReviewCandidate } from "../types/review.ts";
import type { Rule } from "../types/rule.ts";
import type { Standard } from "../types/standard.ts";
import type { ReportData, ScanResult, Violation } from "../types/violation.ts";
import { runFindersForFile } from "./candidate-runner.ts";
import { CriteriaRegistry } from "./registry/criteria.ts";
import { RulesRegistry } from "./registry/rules.ts";
import { StandardsRegistry } from "./registry/standards.ts";
import { runRulesForFile } from "./rule-runner.ts";
import { createStandardFilter } from "./standard-filter.ts";

/** A file that has already been parsed and is ready for rule execution. */
export interface ParsedFile {
  readonly filePath: string;
  readonly source: string;
  readonly ast: Ast;
  readonly disableMap?: ReadonlyMap<number, ReadonlySet<string>>;
}

/** Inputs to the scanner when called directly (programmatic / integration tests). */
export interface ScanInputs {
  readonly standards: readonly Standard[];
  readonly rules: readonly Rule[];
  readonly enabled: readonly string[];
  readonly files: readonly ParsedFile[];
  readonly isTTY?: boolean;
  /** Optional candidate finders for assisted manual review. */
  readonly finders?: readonly CandidateFinder[];
}

export interface ScanProducts {
  readonly result: ScanResult;
  readonly report: ReportData;
}

export function runScan(inputs: ScanInputs): ScanProducts {
  const start = now();

  const standardsRegistry = new StandardsRegistry();
  for (const std of inputs.standards) standardsRegistry.register(std);

  const criteriaRegistry = new CriteriaRegistry();
  criteriaRegistry.rebuild(standardsRegistry.all());

  const rulesRegistry = new RulesRegistry();
  for (const rule of inputs.rules) rulesRegistry.register(rule);
  rulesRegistry.rebuild(criteriaRegistry);

  const enabled = new Set(inputs.enabled);
  for (const id of enabled) {
    if (!standardsRegistry.has(id)) {
      throw new Error(
        `ra11y: --standard '${id}' is not loaded. Available: ${standardsRegistry.ids().join(", ")}.`,
      );
    }
  }

  const filter = createStandardFilter(enabled, criteriaRegistry);

  const allViolations: Violation[] = [];
  for (const file of inputs.files) {
    const perFile = runRulesForFile({
      filePath: file.filePath,
      source: file.source,
      ast: file.ast,
      enabledStandards: enabled,
      disableMap: file.disableMap ?? new Map(),
      rules: inputs.rules,
      filter,
    });
    for (const v of perFile) allViolations.push(v);
  }
  allViolations.sort(compareViolations);

  const allCandidates = collectCandidatesFromFiles(inputs, enabled, standardsRegistry);

  const durationMs = Math.max(0, now() - start);

  const result: ScanResult = {
    violations: allViolations,
    filesScanned: inputs.files.length,
    durationMs,
    enabledStandards: [...enabled].sort(),
    isTTY: inputs.isTTY ?? false,
  };

  const report: ReportData = buildReportData(
    allViolations,
    standardsRegistry,
    enabled,
    allCandidates,
  );

  return { result, report };
}

function compareViolations(a: Violation, b: Violation): number {
  if (a.location.filePath !== b.location.filePath) {
    return a.location.filePath < b.location.filePath ? -1 : 1;
  }
  if (a.location.line !== b.location.line) return a.location.line - b.location.line;
  if (a.location.column !== b.location.column) return a.location.column - b.location.column;
  if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
  return 0;
}

function buildReportData(
  violations: readonly Violation[],
  standards: StandardsRegistry,
  enabled: ReadonlySet<string>,
  candidates: readonly ReviewCandidate[],
): ReportData {
  const coverage = [];
  const manualReviewNeeded: string[] = [];

  for (const standardId of enabled) {
    const standard = standards.get(standardId);
    if (!standard) continue;
    const failingCriteria = collectFailingCriteriaFor(standardId, violations);
    const counts = countCriteriaFor(standard.criteria, failingCriteria, manualReviewNeeded);
    coverage.push({ standardId, ...counts });
  }

  // Deduplicate manualReviewNeeded in case multiple standards surface the same criterion.
  const dedupedManual = [...new Set(manualReviewNeeded)].sort();
  return {
    coverage,
    manualReviewNeeded: dedupedManual,
    ...(candidates.length > 0 ? { candidates } : {}),
  };
}

/** Runs candidate finders across all files if any are provided. */
function collectCandidatesFromFiles(
  inputs: ScanInputs,
  enabled: ReadonlySet<string>,
  standards: StandardsRegistry,
): readonly ReviewCandidate[] {
  const finders = inputs.finders ?? [];
  if (finders.length === 0) return [];
  const activeCriterionIds = collectManualCriterionIds(standards, enabled);
  const out: ReviewCandidate[] = [];
  for (const file of inputs.files) {
    const perFile = runFindersForFile({
      filePath: file.filePath,
      source: file.source,
      ast: file.ast,
      enabledStandards: enabled,
      disableMap: file.disableMap ?? new Map(),
      finders,
      activeCriterionIds,
    });
    for (const c of perFile) out.push(c);
  }
  out.sort(compareCandidates);
  return dedupUniquePerCriterion(out, finders);
}

/**
 * Collapses multi-file emissions for finders marked uniquePerCriterion.
 * Sorted input means "first" is deterministic (alphabetical path, then
 * line/column) so the kept candidate is the highest-precedence root.
 */
function dedupUniquePerCriterion(
  candidates: readonly ReviewCandidate[],
  finders: readonly CandidateFinder[],
): readonly ReviewCandidate[] {
  const uniqueCriteria = new Set<string>();
  for (const f of finders) {
    if (f.uniquePerCriterion) for (const id of f.criterionIds) uniqueCriteria.add(id);
  }
  if (uniqueCriteria.size === 0) return candidates;
  const seen = new Set<string>();
  const kept: ReviewCandidate[] = [];
  for (const c of candidates) {
    if (uniqueCriteria.has(c.criterionId)) {
      if (seen.has(c.criterionId)) continue;
      seen.add(c.criterionId);
    }
    kept.push(c);
  }
  return kept;
}

/** Collects the set of manual criterion IDs across enabled standards. */
function collectManualCriterionIds(
  standards: StandardsRegistry,
  enabled: ReadonlySet<string>,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const standardId of enabled) {
    const standard = standards.get(standardId);
    if (!standard) continue;
    for (const criterion of standard.criteria) {
      if (criterion.automatable === "manual") ids.add(criterion.id);
    }
  }
  return ids;
}

function compareCandidates(a: ReviewCandidate, b: ReviewCandidate): number {
  if (a.location.filePath !== b.location.filePath) {
    return a.location.filePath < b.location.filePath ? -1 : 1;
  }
  if (a.location.line !== b.location.line) return a.location.line - b.location.line;
  if (a.criterionId !== b.criterionId) return a.criterionId < b.criterionId ? -1 : 1;
  return 0;
}

/** Returns the set of criterion IDs under `standardId` that have at least one violation. */
function collectFailingCriteriaFor(
  standardId: string,
  violations: readonly Violation[],
): ReadonlySet<string> {
  const prefix = `${standardId}:`;
  const out = new Set<string>();
  for (const v of violations) {
    for (const critId of v.criteria) {
      if (critId.startsWith(prefix)) out.add(critId);
    }
  }
  return out;
}

interface CoverageCounts {
  readonly automated: number;
  readonly total: number;
  readonly passing: number;
  readonly failing: number;
}

/**
 * Walks the standard's criteria and tallies automatable passing/failing
 * counts. Pushes manual-only criterion IDs into `manualReviewNeeded` so
 * the caller can dedupe them across standards.
 */
function countCriteriaFor(
  criteria: readonly { readonly id: string; readonly automatable: string }[],
  failingCriteria: ReadonlySet<string>,
  manualReviewNeeded: string[],
): CoverageCounts {
  let automated = 0;
  let total = 0;
  let passing = 0;
  let failing = 0;
  for (const criterion of criteria) {
    total += 1;
    if (criterion.automatable === "manual") {
      manualReviewNeeded.push(criterion.id);
      continue;
    }
    automated += 1;
    if (failingCriteria.has(criterion.id)) failing += 1;
    else passing += 1;
  }
  return { automated, total, passing, failing };
}

function now(): number {
  // performance.now() is available on Node 22+ and Bun.
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  if (perf?.now) return perf.now();
  return Date.now();
}
