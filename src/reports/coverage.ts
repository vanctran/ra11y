/**
 * Coverage report — per-standard automation and pass/fail counts.
 *
 * Given a ScanResult and the loaded Standard objects, computes:
 *   - how many criteria each standard declares
 *   - how many of those are statically automatable (not "manual")
 *   - how many automatable criteria currently have zero violations
 *   - how many automatable criteria have at least one violation
 *
 * This is the foundation data for --coverage, --vpat, and
 * --certification. All three of those downstream reports pivot on
 * the same shape, so they share the same builder.
 */

import type { Standard } from "../types/standard.ts";
import type { CoverageEntry, ScanResult } from "../types/violation.ts";

export interface PerStandardCoverage {
  readonly standardId: string;
  readonly standardName: string;
  readonly version: string;
  readonly total: number;
  readonly automatable: number;
  readonly manual: number;
  readonly passing: number;
  readonly failing: number;
  /** Criterion IDs that have at least one violation. */
  readonly failingCriteria: readonly string[];
  /** Criterion IDs that are manual-only and need human review. */
  readonly manualCriteria: readonly string[];
  /** 0–100 automated-pass rate (passing / automatable). */
  readonly automatedPassRate: number;
}

/** Builds a per-standard coverage report from scan results + loaded standards. */
export function buildCoverageReport(
  result: ScanResult,
  loadedStandards: readonly Standard[],
  level?: "A" | "AA" | "AAA",
): readonly PerStandardCoverage[] {
  const enabledSet = new Set(result.enabledStandards);
  const failingByStandard = indexFailingCriteria(result);
  const maxLevel = levelRank(level ?? "AAA");

  const out: PerStandardCoverage[] = [];
  for (const standard of loadedStandards) {
    if (!enabledSet.has(standard.id)) continue;
    const filtered = filterByLevel(standard, maxLevel);
    out.push(buildOne(filtered, failingByStandard.get(standard.id) ?? new Set()));
  }
  return out;
}

const LEVEL_RANKS: Readonly<Record<string, number>> = { A: 1, AA: 2, AAA: 3, base: 1 };

function levelRank(level: string): number {
  return LEVEL_RANKS[level] ?? 3;
}

function filterByLevel(standard: Standard, maxLevel: number): Standard {
  const filtered = standard.criteria.filter((c) => levelRank(c.level) <= maxLevel);
  return { ...standard, criteria: filtered };
}

function buildOne(standard: Standard, failingSet: ReadonlySet<string>): PerStandardCoverage {
  let automatable = 0;
  let manual = 0;
  let passing = 0;
  let failing = 0;
  const failingCriteria: string[] = [];
  const manualCriteria: string[] = [];

  for (const criterion of standard.criteria) {
    if (criterion.automatable === "manual") {
      manual += 1;
      manualCriteria.push(criterion.id);
      continue;
    }
    automatable += 1;
    if (failingSet.has(criterion.id)) {
      failing += 1;
      failingCriteria.push(criterion.id);
    } else {
      passing += 1;
    }
  }

  const automatedPassRate = automatable > 0 ? Math.round((passing / automatable) * 100) : 0;

  return {
    standardId: standard.id,
    standardName: standard.name,
    version: standard.version,
    total: standard.criteria.length,
    automatable,
    manual,
    passing,
    failing,
    failingCriteria: failingCriteria.sort(),
    manualCriteria: manualCriteria.sort(),
    automatedPassRate,
  };
}

function indexFailingCriteria(result: ScanResult): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const violation of result.violations) {
    for (const criterionId of violation.criteria) {
      const colonIndex = criterionId.indexOf(":");
      if (colonIndex < 0) continue;
      const standardId = criterionId.slice(0, colonIndex);
      let set = map.get(standardId);
      if (!set) {
        set = new Set();
        map.set(standardId, set);
      }
      set.add(criterionId);
    }
  }
  return map;
}

/** Adapter to the engine's simpler CoverageEntry shape. */
export function toEngineCoverageEntry(report: PerStandardCoverage): CoverageEntry {
  return {
    standardId: report.standardId,
    automated: report.automatable,
    total: report.total,
    passing: report.passing,
    failing: report.failing,
  };
}
