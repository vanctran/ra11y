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

import type { SuppressionDeclaration } from "../config/inline-disables.ts";
import type { Ast } from "../types/ast.ts";
import type { AttestationRecord, EvidenceLedger } from "../types/evidence.ts";
import type { CandidateFinder, ReviewCandidate } from "../types/review.ts";
import type {
  EmittedViolation,
  Language,
  ProjectContext,
  ProjectRuleFile,
  Rule,
} from "../types/rule.ts";
import type { Standard } from "../types/standard.ts";
import type {
  PerRuleCoverage,
  ReportData,
  ScanResult,
  Severity,
  Violation,
} from "../types/violation.ts";
import { computeFindingId } from "../utils/finding-id.ts";
import { computeGroupKey, UNKNOWN_SHAPE } from "../utils/group-key.ts";
import { describeNodeShape, findTargetNodeAtLocation } from "./ast-helpers.ts";
import { runFindersForFile } from "./candidate-runner.ts";
import { buildEvidenceLedger } from "./evidence-ledger.ts";
import { buildPerRuleCoverage } from "./per-rule-coverage.ts";
import { CriteriaRegistry } from "./registry/criteria.ts";
import { RulesRegistry } from "./registry/rules.ts";
import { StandardsRegistry } from "./registry/standards.ts";
import { resolvePragmaAttestations } from "./resolve-pragma-attestations.ts";
import { type RuleEvaluationTracker, runRulesForFile } from "./rule-runner.ts";
import {
  type ConformanceLevel,
  createStandardFilter,
  type StandardFilter,
} from "./standard-filter.ts";

/** A file that has already been parsed and is ready for rule execution. */
export interface ParsedFile {
  readonly filePath: string;
  readonly source: string;
  readonly ast: Ast;
  readonly disableMap?: ReadonlyMap<number, ReadonlySet<string>>;
  /**
   * Pragma declarations parsed from this file's source. Populated by
   * callers that run `parseInlineDisablesDetailed`; omitted by the
   * rest. When present, declarations whose `reason` is non-empty flow
   * through the pragma-attestation resolver into the evidence ledger.
   * When absent, only durable attestations (from
   * `.ra11y/attestations.jsonl`) contribute to the ledger.
   */
  readonly declarations?: readonly SuppressionDeclaration[];
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
  /**
   * Active conformance level. When set, rules whose only cited criteria
   * are above this level are skipped — e.g., `contrast/enhanced`
   * (AAA-only) won't fire at `"AA"`. Undefined = no level gating.
   */
  readonly level?: ConformanceLevel;
  /**
   * Wrapper component name → native element tag, as carried on
   * `LoadedConfig.nativeWrapperElements` when the user supplied the
   * object form of `Config.nativeWrappers`. Surfaces to rules that opt
   * in via {@link Rule.wrapperTreatsAsElement} through
   * `RuleContext.wrappersForElement`. Undefined or empty = rules see no
   * additional wrappers, identical to pre-Q2-WRAPMAP-RULES behaviour.
   */
  readonly nativeWrapperElements?: Readonly<Record<string, string>>;
  /**
   * Durable attestations from `.ra11y/attestations.jsonl` (the
   * project-level store). Inline pragma-derived attestations are
   * assembled by the scanner itself from each file's `declarations`
   * field; both kinds merge before ledger construction so every
   * attestation flows through the same evidence path.
   */
  readonly attestations?: readonly AttestationRecord[];
}

export interface ScanProducts {
  readonly result: ScanResult;
  readonly report: ReportData;
  /**
   * Per-rule evaluation telemetry for rules with an extension gate.
   * One entry per active rule whose `appliesTo.fileExtensions` could
   * fail to match any scanned file. Drives the `meta.perRuleCoverage`
   * field and the `ruleCoverage` derivative on MCP scan responses —
   * see {@link PerRuleCoverage}.
   *
   * Produced here rather than stamped onto {@link ScanResult} because
   * the MCP response layer (`src/mcp/tools-helpers.ts`) is the sole
   * consumer. Keeping it off the shared result type avoids churning
   * every fixture that constructs a `ScanResult` literal whenever the
   * shape evolves.
   */
  readonly perRuleCoverage: readonly PerRuleCoverage[];
  /**
   * Per-criterion evidence aggregate for this scan. Static findings
   * and review candidates from this run are joined into a single
   * shape that later phases extend with attestations, runtime
   * ingest, and sampling verdicts — all without changing this field's
   * type. Kept off {@link ScanResult} for the same fixture-churn
   * reason as `perRuleCoverage`. See
   * docs/adr/0011-evidence-as-first-class-primitive.md.
   */
  readonly ledger: EvidenceLedger;
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

  const filter = createStandardFilter(enabled, criteriaRegistry, inputs.level);

  const allViolations: Violation[] = [];
  const tracker: RuleEvaluationTracker = { counts: new Map() };
  for (const file of inputs.files) {
    const perFile = runRulesForFile({
      filePath: file.filePath,
      source: file.source,
      ast: file.ast,
      enabledStandards: enabled,
      disableMap: file.disableMap ?? new Map(),
      rules: inputs.rules,
      filter,
      tracker,
      ...(inputs.nativeWrapperElements !== undefined && {
        nativeWrapperElements: inputs.nativeWrapperElements,
      }),
    });
    for (const v of perFile) allViolations.push(v);
  }
  for (const v of runProjectRules(inputs, enabled, filter)) {
    allViolations.push(v);
  }
  allViolations.sort(compareViolations);

  const allCandidates = collectCandidatesFromFiles(inputs, enabled, standardsRegistry);

  const durationMs = Math.max(0, now() - start);
  const perRuleCoverage = buildPerRuleCoverage(tracker, inputs.rules, filter);

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

  const ledgerGeneratedAt = new Date().toISOString();
  const pragmaAttestations = resolvePragmaAttestations({
    files: inputs.files
      .filter(
        (f): f is ParsedFile & { declarations: readonly SuppressionDeclaration[] } =>
          f.declarations !== undefined && f.declarations.length > 0,
      )
      .map((f) => ({ filePath: f.filePath, declarations: f.declarations })),
    rules: inputs.rules,
    criteria: criteriaRegistry,
    enabled,
    attestedAt: ledgerGeneratedAt,
  });
  const mergedAttestations: readonly AttestationRecord[] = [
    ...pragmaAttestations,
    ...(inputs.attestations ?? []),
  ];

  const ledger = buildEvidenceLedger({
    result,
    report,
    standards: inputs.standards,
    enabled,
    attestations: mergedAttestations,
    generatedAt: ledgerGeneratedAt,
  });

  return { result, report, perRuleCoverage, ledger };
}

/**
 * Runs every rule's `afterProject` hook with the full parsed-file set.
 * Used by cross-file rules (e.g. `focus/outline-visible`'s Tailwind
 * cross-reference). A crashing rule produces an `internal/rule-crash`
 * violation and the scan continues, mirroring the per-file runner.
 * Emitted violations carry `location.filePath` directly; the engine
 * stamps `ruleId` + `criteria` and filters via the owning file's
 * disableMap.
 */
function runProjectRules(
  inputs: ScanInputs,
  enabled: ReadonlySet<string>,
  filter: StandardFilter,
): readonly Violation[] {
  const projectFiles: ProjectRuleFile[] = inputs.files.map((f) => ({
    filePath: f.filePath,
    source: f.source,
    ast: f.ast.root,
    language: f.ast.language as Language,
    disableMap: f.disableMap ?? new Map<number, ReadonlySet<string>>(),
  }));
  const disableMaps = new Map<string, ReadonlyMap<number, ReadonlySet<string>>>();
  const sourcesByPath = new Map<string, string>();
  // Keep a filePath→Ast map so project-rule emits can resolve their
  // target node for `groupKey` (docs/adr/0008-violation-group-key.md).
  const astsByPath = new Map<string, Ast>();
  for (const f of inputs.files) astsByPath.set(f.filePath, f.ast);
  for (const f of projectFiles) {
    disableMaps.set(f.filePath, f.disableMap);
    sourcesByPath.set(f.filePath, f.source);
  }
  const out: Violation[] = [];
  for (const rule of inputs.rules) {
    invokeOneProjectRule(
      rule,
      projectFiles,
      enabled,
      filter,
      disableMaps,
      sourcesByPath,
      astsByPath,
      out,
    );
  }
  return out;
}

function invokeOneProjectRule(
  rule: Rule,
  projectFiles: readonly ProjectRuleFile[],
  enabled: ReadonlySet<string>,
  filter: StandardFilter,
  disableMaps: ReadonlyMap<string, ReadonlyMap<number, ReadonlySet<string>>>,
  sourcesByPath: ReadonlyMap<string, string>,
  astsByPath: ReadonlyMap<string, Ast>,
  out: Violation[],
): void {
  if (!rule.afterProject) return;
  if (!filter.isRuleActive(rule)) return;
  const sink: EmittedViolation[] = [];
  const ctx: ProjectContext = {
    files: projectFiles,
    enabledStandards: enabled,
    emit: (v) => sink.push(v),
  };
  try {
    const maybe = rule.afterProject(ctx);
    if (Array.isArray(maybe)) for (const v of maybe) sink.push(v);
  } catch (err) {
    // Project crashes don't have a specific file — use an empty
    // source so the findingId still carries (ruleId, "") but the
    // context-hash is stable regardless of which file triggered.
    out.push(projectRuleCrashViolation(rule.id, err));
    return;
  }
  const criteria = filter.citedCriteria(rule);
  const criteriaTitles = filter.citedCriteriaTitles(rule);
  for (const em of sink) {
    const dm = disableMaps.get(em.location.filePath);
    const disabled = dm?.get(em.location.line);
    if (disabled?.has("*") || disabled?.has(rule.id)) continue;
    const source = sourcesByPath.get(em.location.filePath) ?? "";
    const findingId = computeFindingId({
      ruleId: rule.id,
      filePath: em.location.filePath,
      source,
      line: em.location.line,
    });
    const groupKey = computeGroupKey({
      ruleId: rule.id,
      shape: shapeAtEmission(
        astsByPath,
        em.location.filePath,
        em.location.line,
        em.location.column,
      ),
    });
    out.push({
      ruleId: rule.id,
      fixClass: rule.fixClass,
      criteria,
      criteriaTitles,
      severity: em.severity,
      location: em.location,
      message: em.message,
      findingId,
      groupKey,
      ...(em.suggestion !== undefined && { suggestion: em.suggestion }),
      ...(em.fix !== undefined && { fix: em.fix }),
      ...(em.fixPaths !== undefined && { fixPaths: em.fixPaths }),
      ...(em.snippet !== undefined && { snippet: em.snippet }),
    });
  }
}

/**
 * Resolves the shape string for a project-rule emission. Mirrors the
 * per-file helper in rule-runner.ts but looks up the file's AST from
 * the `astsByPath` map — a project-rule emission can come from any
 * file in the scan. UNKNOWN_SHAPE when the file wasn't in the map
 * (shouldn't happen) or the location doesn't land on any node
 * (synthetic emit with a placeholder location).
 */
function shapeAtEmission(
  astsByPath: ReadonlyMap<string, Ast>,
  filePath: string,
  line: number,
  column: number,
): string {
  const ast = astsByPath.get(filePath);
  if (!ast) return UNKNOWN_SHAPE;
  const node = findTargetNodeAtLocation(ast.root, line, column);
  return node ? describeNodeShape(node) : UNKNOWN_SHAPE;
}

function projectRuleCrashViolation(ruleId: string, err: unknown): Violation {
  const severity: Severity = "error";
  const findingId = computeFindingId({
    ruleId: "internal/rule-crash",
    filePath: "",
    source: "",
    line: 1,
  });
  // Synthetic crashes have no target node — every crash record from
  // the project-rule path shares one groupKey with the per-file crash
  // path, so "all internal/rule-crash findings" groups honestly.
  const groupKey = computeGroupKey({ ruleId: "internal/rule-crash", shape: UNKNOWN_SHAPE });
  return {
    ruleId: "internal/rule-crash",
    // Synthetic crash reports route into the verify-in-source lane:
    // the agent reads the stack trace and the failing rule's source
    // to decide next steps. Mirrors the per-file crash stamp in
    // rule-runner.ts.
    fixClass: "verify-in-source",
    criteria: [],
    severity,
    location: { filePath: "", line: 1, column: 1 },
    message: `Project-scope rule '${ruleId}' crashed: ${err instanceof Error ? err.message : String(err)}`,
    suggestion: `This is a ra11y bug in rule '${ruleId}', not a problem with your code. Please file an issue with the stack trace if you can reproduce it.`,
    findingId,
    groupKey,
  };
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
  for (const c of runProjectFinders(inputs, finders, enabled, activeCriterionIds)) {
    out.push(c);
  }
  out.sort(compareCandidates);
  return dedupUniquePerCriterion(out, finders);
}

/**
 * Runs every finder's `afterProject` hook once with the full set of
 * parsed files. Used by cross-file finders (e.g. WCAG 3.2.3 Consistent
 * Navigation) that can only judge a location relative to its peers.
 *
 * A crashing project-finder contributes zero candidates silently —
 * advisory only, same contract as the per-file runner.
 */
function runProjectFinders(
  inputs: ScanInputs,
  finders: readonly CandidateFinder[],
  enabled: ReadonlySet<string>,
  activeCriterionIds: ReadonlySet<string>,
): readonly ReviewCandidate[] {
  const projectFiles = inputs.files.map((f) => ({
    filePath: f.filePath,
    source: f.source,
    ast: f.ast,
    disableMap: f.disableMap ?? new Map<number, ReadonlySet<string>>(),
  }));
  const pathToDisableMap = new Map<string, ReadonlyMap<number, ReadonlySet<string>>>();
  for (const f of projectFiles) pathToDisableMap.set(f.filePath, f.disableMap);

  const out: ReviewCandidate[] = [];
  for (const finder of finders) {
    invokeOneProjectFinder(
      finder,
      projectFiles,
      enabled,
      activeCriterionIds,
      pathToDisableMap,
      out,
    );
  }
  return out;
}

/**
 * Invokes one finder's `afterProject` hook and appends its surviving
 * candidates (those not silenced by per-file disableMaps) to `out`.
 * Split out so `runProjectFinders` stays under the cognitive-complexity
 * budget — the loop body is otherwise the whole function.
 */
function invokeOneProjectFinder(
  finder: CandidateFinder,
  projectFiles: readonly {
    readonly filePath: string;
    readonly source: string;
    readonly ast: Ast;
    readonly disableMap: ReadonlyMap<number, ReadonlySet<string>>;
  }[],
  enabled: ReadonlySet<string>,
  activeCriterionIds: ReadonlySet<string>,
  pathToDisableMap: ReadonlyMap<string, ReadonlyMap<number, ReadonlySet<string>>>,
  out: ReviewCandidate[],
): void {
  if (!finder.afterProject) return;
  if (!finder.criterionIds.some((id) => activeCriterionIds.has(id))) return;
  let emitted: readonly ReviewCandidate[] | undefined;
  try {
    emitted = finder.afterProject({ files: projectFiles, enabledStandards: enabled });
  } catch {
    return;
  }
  if (!emitted) return;
  for (const c of emitted) {
    const disableMap = pathToDisableMap.get(c.location.filePath);
    if (disableMap && isCandidateDisabled(disableMap, c.location.line, c.criterionId)) continue;
    out.push(c);
  }
}

function isCandidateDisabled(
  disableMap: ReadonlyMap<number, ReadonlySet<string>>,
  line: number,
  criterionId: string,
): boolean {
  const disabled = disableMap.get(line);
  if (!disabled) return false;
  return disabled.has("*") || disabled.has(criterionId);
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

/**
 * Built-in process-rule criterion IDs. These are ra11y's own hygiene /
 * process checks that aren't traceable to any WCAG SC, Section 508
 * provision, or EN 301 549 clause — suppression-accountability and
 * similar meta-rules. The scanner activates them unconditionally so the
 * backing finders fire regardless of which standards are enabled.
 *
 * Lives in the engine (not in a standard module) because a Standard is
 * pure data declaring WCAG/508/EN criteria — splicing ra11y's process
 * IDs into a real standard would break the Standards → Criteria → Rules
 * invariants. Kept deliberately tiny.
 */
const RA11Y_PROCESS_CRITERION_IDS: readonly string[] = ["ra11y:suppression-no-reason"];

/**
 * Collects the set of manual criterion IDs across enabled standards,
 * plus ra11y's process-rule criteria (see
 * {@link RA11Y_PROCESS_CRITERION_IDS}). Process criteria are always
 * active — they don't belong to any standard, so "enabled standards"
 * doesn't gate them.
 */
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
  for (const id of RA11Y_PROCESS_CRITERION_IDS) ids.add(id);
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
