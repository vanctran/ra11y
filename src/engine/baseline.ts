/**
 * Baseline mode — the "adopt on a messy codebase" feature.
 *
 * A baseline is a snapshot of every current violation, stored as a
 * JSON file in the repo root (default: `.ra11y-baseline.json`). When
 * the user runs ra11y with `--baseline check`, the scanner compares
 * each violation against the baseline and fails only on violations
 * that are NOT already listed. The existing mess is grandfathered in;
 * new regressions still break the build.
 *
 * Three commands:
 *   - create: run a scan, write the current violations to the file
 *   - check:  run a scan, filter out violations present in the file,
 *             exit 0 if none remain (regardless of the pre-existing
 *             count), exit 3 if new violations appeared
 *   - update: run a scan, rewrite the file with the current set,
 *             removing violations that have been fixed
 *
 * Cross-run identity: baselines are matched by `Violation.findingId`
 * — the same opaque token the scanner stamps on every finding. The
 * findingId is computed from `(ruleId, relativeFilePath,
 * lineContextHash)` and is resilient to line-number drift within the
 * file, so unrelated edits above a violation don't invalidate its
 * baseline entry. See `src/utils/finding-id.ts` for the recipe.
 *
 * Legacy note: baseline files generated before v0.2.0 used a
 * `sha1(ruleId + filePath + message)` fingerprint. The `fingerprintOf`
 * helper below still computes that value so `scan_diff` can consume
 * pre-existing baselines during the transition, but new writes stamp
 * `findingId` into the `hash` field. Bumping `BASELINE_VERSION` would
 * force regeneration; for now we accept the silent identity change
 * since `hash` is an opaque token and the file still round-trips.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import type { ScanResult, Violation } from "../types/violation.ts";

export const BASELINE_FILENAME = ".ra11y-baseline.json";
export const BASELINE_VERSION = 1;

/** The wire shape of the `.ra11y-baseline.json` file. */
export interface BaselineFile {
  readonly version: number;
  readonly generatedAt: string;
  readonly ra11yVersion: string;
  readonly standards: readonly string[];
  readonly violations: readonly BaselineEntry[];
}

export interface BaselineEntry {
  readonly hash: string;
  readonly ruleId: string;
  readonly filePath: string;
  readonly message: string;
}

export interface BaselineDiff {
  /** Violations present in the scan and in the baseline — grandfathered. */
  readonly grandfathered: readonly Violation[];
  /** Violations present in the scan but NOT in the baseline — new regressions. */
  readonly newViolations: readonly Violation[];
  /** Entries in the baseline that no longer appear in the scan — good news. */
  readonly resolved: readonly BaselineEntry[];
}

/**
 * Returns the stable cross-run identity of a violation. Baselines key
 * by this value — the same `findingId` the scanner stamps on every
 * finding. Line-number drift within the file does not change it; see
 * `src/utils/finding-id.ts`.
 */
export function fingerprint(violation: Violation): string {
  return violation.findingId;
}

/**
 * Legacy component-level fingerprint kept so callers that still
 * operate on `(ruleId, filePath, message)` tuples (e.g. MCP
 * scan_diff's formatted-finding path) can compute the same value we
 * used before the `findingId` switch. New call sites should prefer
 * `Violation.findingId` directly; this helper exists for back-compat.
 */
export function fingerprintOf(ruleId: string, filePath: string, message: string): string {
  const canonical = [ruleId, normalizeFilePath(filePath), message].join("\u0000");
  return createHash("sha1").update(canonical).digest("hex");
}

function normalizeFilePath(filePath: string): string {
  // Collapse backslashes to forward slashes and drop any `./` prefix
  // so baselines are portable between macOS, Linux, and Windows.
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** Converts a ScanResult into a fresh BaselineFile ready to write. */
export function buildBaselineFile(
  result: ScanResult,
  now: string = new Date().toISOString(),
): BaselineFile {
  const seen = new Set<string>();
  const entries: BaselineEntry[] = [];
  for (const v of result.violations) {
    const hash = fingerprint(v);
    if (seen.has(hash)) continue;
    seen.add(hash);
    entries.push({
      hash,
      ruleId: v.ruleId,
      filePath: normalizeFilePath(v.location.filePath),
      message: v.message,
    });
  }
  entries.sort(compareEntries);
  return {
    version: BASELINE_VERSION,
    generatedAt: now,
    ra11yVersion: "0.0.0",
    standards: result.enabledStandards,
    violations: entries,
  };
}

function compareEntries(a: BaselineEntry, b: BaselineEntry): number {
  if (a.filePath !== b.filePath) return a.filePath < b.filePath ? -1 : 1;
  if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
  return a.hash.localeCompare(b.hash);
}

/** Loads the baseline file if it exists; returns null otherwise. */
export async function loadBaseline(path: string): Promise<BaselineFile | null> {
  if (!existsSync(path)) return null;
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as BaselineFile;
  if (parsed.version !== BASELINE_VERSION) {
    throw new Error(
      `${path}: baseline version ${parsed.version} is incompatible with current ra11y (expected ${BASELINE_VERSION}). Regenerate with --baseline create.`,
    );
  }
  return parsed;
}

/** Writes a baseline file to disk with a canonical indent. */
export async function writeBaseline(path: string, baseline: BaselineFile): Promise<void> {
  await writeFile(path, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
}

/**
 * Splits a ScanResult against a baseline into three buckets:
 * grandfathered, newViolations, resolved.
 */
export function diffAgainstBaseline(result: ScanResult, baseline: BaselineFile): BaselineDiff {
  const baselineHashes = new Set(baseline.violations.map((v) => v.hash));
  const grandfathered: Violation[] = [];
  const newViolations: Violation[] = [];
  const scanHashes = new Set<string>();

  for (const v of result.violations) {
    const hash = fingerprint(v);
    scanHashes.add(hash);
    if (baselineHashes.has(hash)) grandfathered.push(v);
    else newViolations.push(v);
  }

  const resolved = baseline.violations.filter((e) => !scanHashes.has(e.hash));

  return { grandfathered, newViolations, resolved };
}
