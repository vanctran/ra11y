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
import type { Rule } from "../types/rule.ts";
import type { Standard } from "../types/standard.ts";
import type { ReportData, ScanResult, Violation } from "../types/violation.ts";
import { CriteriaRegistry } from "./registry/criteria.ts";
import { RulesRegistry } from "./registry/rules.ts";
import { StandardsRegistry } from "./registry/standards.ts";
import { createStandardFilter } from "./standard-filter.ts";
import { runRulesForFile } from "./rule-runner.ts";

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

  const durationMs = Math.max(0, now() - start);

  const result: ScanResult = {
    violations: allViolations,
    filesScanned: inputs.files.length,
    durationMs,
    enabledStandards: [...enabled].sort(),
    isTTY: inputs.isTTY ?? false,
  };

  const report: ReportData = buildReportData(allViolations, standardsRegistry, criteriaRegistry, enabled);

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
  criteria: CriteriaRegistry,
  enabled: ReadonlySet<string>,
): ReportData {
  const coverage = [];
  const manualReviewNeeded: string[] = [];

  for (const standardId of enabled) {
    const standard = standards.get(standardId);
    if (!standard) continue;
    let automated = 0;
    let total = 0;
    let passing = 0;
    let failing = 0;
    const failingCriteria = new Set<string>();
    for (const v of violations) {
      for (const critId of v.criteria) {
        if (critId.startsWith(`${standardId}:`)) failingCriteria.add(critId);
      }
    }
    for (const criterion of standard.criteria) {
      total += 1;
      if (criterion.automatable !== "manual") {
        automated += 1;
        if (failingCriteria.has(criterion.id)) failing += 1;
        else passing += 1;
      } else {
        manualReviewNeeded.push(criterion.id);
      }
    }
    coverage.push({ standardId, automated, total, passing, failing });
  }

  // Deduplicate manualReviewNeeded in case multiple standards surface the same criterion.
  const dedupedManual = [...new Set(manualReviewNeeded)].sort();
  return { coverage, manualReviewNeeded: dedupedManual };
}

function now(): number {
  // performance.now() is available on Node 22+ and Bun.
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  if (perf?.now) return perf.now();
  return Date.now();
}
