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
 *
 * Per-criterion detail hangs off {@link PerStandardCoverage.criteria}
 * so callers can surface attestation state without re-walking the
 * standard. Attestation integration lives in
 * {@link mergeAttestationIntoCoverage}: a fresh coverage report
 * omits `attested` everywhere; the merge helper folds durable
 * attestations in per the AI-first consumer model (surface, don't
 * suppress — agents read the attested state directly).
 */

import type { AttestationRecord } from "../types/evidence.ts";
import type { Standard } from "../types/standard.ts";
import type { CoverageEntry, ScanResult } from "../types/violation.ts";
import {
  type AttestationStalenessProbe,
  createGitStalenessProbe,
  indexAttestationsByCriterion,
  pickMostRecentAttestation,
} from "./attestation-surface.ts";

/**
 * Per-criterion detail carried on a coverage entry. `static` is the
 * verdict the static scanner can defend by itself; `attested` — when
 * present — carries the most recent durable attestation's verdict and
 * staleness (stamp commit vs. HEAD scope intersection).
 *
 * Shape rules (AI-first consumer model):
 *   - `attested` is omitted when no attestation speaks to this
 *     criterion; never emit `null` or an empty object.
 *   - `stale` is omitted when the probe answered cleanly and the
 *     attestation is fresh, or when the probe couldn't answer at all
 *     (staleness indeterminate; we don't guess).
 */
export interface CoverageCriterion {
  readonly criterionId: string;
  readonly static: "pass" | "fail" | "manual";
  readonly attested?: {
    readonly verdict: "pass" | "fail" | "n/a" | "pending";
    readonly stale?: true;
  };
}

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
  /**
   * Per-criterion detail — one entry per criterion in the standard
   * (after level filtering). Always populated; `attested` is omitted
   * on entries that carry no durable attestation. Callers that need
   * aggregate counts only can ignore this field.
   */
  readonly criteria: readonly CoverageCriterion[];
  /**
   * Count of manual-only criteria that have a non-stale `pass` or
   * `n/a` attestation. These are folded into the aggregate pass
   * numerator and the `coveredManualCriteria` list; `manual` itself
   * is left intact so consumers can still see the full manual surface.
   * Present only when a merge has happened; omitted on the untouched
   * base report.
   */
  readonly coveredManual?: number;
  /**
   * Criterion IDs for manual criteria covered by attestation — same
   * set that `coveredManual` counts. Sorted for determinism.
   */
  readonly coveredManualCriteria?: readonly string[];
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
  const criteria: CoverageCriterion[] = [];

  for (const criterion of standard.criteria) {
    if (criterion.automatable === "manual") {
      manual += 1;
      manualCriteria.push(criterion.id);
      criteria.push({ criterionId: criterion.id, static: "manual" });
      continue;
    }
    automatable += 1;
    if (failingSet.has(criterion.id)) {
      failing += 1;
      failingCriteria.push(criterion.id);
      criteria.push({ criterionId: criterion.id, static: "fail" });
    } else {
      passing += 1;
      criteria.push({ criterionId: criterion.id, static: "pass" });
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
    criteria,
  };
}

/**
 * Indexes criteria that have real violations (error/warning severity).
 * Info-severity findings are notes for review, not failures — a criterion
 * with only info-level findings is "passing with notes", not a gap.
 */
function indexFailingCriteria(result: ScanResult): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const violation of result.violations) {
    if (violation.severity === "info") continue;
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

/**
 * Folds durable attestations into an existing coverage report. For
 * each criterion the helper looks up every attestation that speaks
 * to it, picks the most-recent via
 * {@link pickMostRecentAttestation}, probes staleness through git
 * (when `cwd` is inside a repo), and decorates the matching
 * {@link CoverageCriterion} with `attested`.
 *
 * Aggregate pass-rate semantics (per doctrine): static verdict wins.
 *   - `static === "pass"` with any attestation → still counted as
 *     covered (attestation surfaces but doesn't override).
 *   - `static === "fail"` with a `pass` attestation → still fails;
 *     a real violation exists in the tree and the attestation is
 *     surfaced alongside it so the agent can triage. Fail attestations
 *     do not flip static-pass criteria to fail — the static scan is
 *     authoritative for the automated slice.
 *   - `static === "manual"` with a non-stale `pass` or `n/a`
 *     attestation → folded into the pass numerator. Stale
 *     attestations and `pending`/`fail` verdicts do NOT count as
 *     covered (the agent explicitly has not-yet-verdicted or has
 *     asserted failure).
 *
 * The original coverage array is not mutated; this is a pure
 * transformation. When the staleness probe cannot be built (cwd
 * outside a git repo, or omitted entirely) the merge still runs —
 * attestations still surface, but without `stale` annotations.
 *
 * @param coverage - Coverage entries produced by {@link buildCoverageReport}.
 * @param attestations - Durable records from the attestation store
 *   plus inline pragmas; order is not significant.
 * @param source - Either a `cwd` string (git-backed probe resolved
 *   from disk), or `{ cwd }` / `{ probe }` for callers that already
 *   own a resolved probe. Plain `undefined` disables staleness
 *   entirely — honest shape when the probe is unavailable.
 */
export function mergeAttestationIntoCoverage(
  coverage: readonly PerStandardCoverage[],
  attestations: readonly AttestationRecord[],
  source?: string | { readonly cwd?: string; readonly probe?: AttestationStalenessProbe },
): readonly PerStandardCoverage[] {
  if (coverage.length === 0) return coverage;
  const indexed = indexAttestationsByCriterion(attestations);
  const probe = resolveProbe(source);
  return coverage.map((entry) => mergeOne(entry, indexed, probe));
}

function resolveProbe(
  source:
    | string
    | { readonly cwd?: string; readonly probe?: AttestationStalenessProbe }
    | undefined,
): AttestationStalenessProbe | undefined {
  if (source === undefined) return undefined;
  if (typeof source === "string") return createGitStalenessProbe(source);
  if (source.probe !== undefined) return source.probe;
  if (source.cwd !== undefined) return createGitStalenessProbe(source.cwd);
  return undefined;
}

function mergeOne(
  entry: PerStandardCoverage,
  indexed: ReadonlyMap<string, readonly AttestationRecord[]>,
  probe: AttestationStalenessProbe | undefined,
): PerStandardCoverage {
  const coveredManualCriteria: string[] = [];
  const nextCriteria: CoverageCriterion[] = entry.criteria.map((c) => {
    const records = indexed.get(c.criterionId);
    if (records === undefined || records.length === 0) return c;
    const record = pickMostRecentAttestation(records);
    if (record === undefined) return c;
    const verdict: "pass" | "fail" | "n/a" | "pending" = record.verdict ?? "pending";
    const staleResult = probe === undefined ? null : probe.isStale(record);
    const attested: { verdict: typeof verdict; stale?: true } =
      staleResult === true ? { verdict, stale: true } : { verdict };
    if (c.static === "manual" && !attested.stale && (verdict === "pass" || verdict === "n/a")) {
      coveredManualCriteria.push(c.criterionId);
    }
    return { ...c, attested };
  });

  // Static verdict wins for the automatable-pass counters — manual
  // coverage via attestation is tracked separately so consumers can
  // see both numbers. `passing` / `failing` stay on static evidence;
  // `coveredManual` names the newly-certified-by-attestation slice.
  const coveredManual = coveredManualCriteria.length;
  if (coveredManual === 0) return { ...entry, criteria: nextCriteria };
  return {
    ...entry,
    criteria: nextCriteria,
    coveredManual,
    coveredManualCriteria: coveredManualCriteria.sort(),
  };
}
