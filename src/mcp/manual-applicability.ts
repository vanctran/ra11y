/**
 * Single source of truth for deciding which manual-review criteria
 * *apply* to a scanned file set and which are obviously irrelevant.
 *
 * Three MCP surfaces (`scan`/`scan_project`, `coverage`, `checklist`)
 * all need to report consistent counts for "criteria that still need a
 * human to look at." Prior to this module each one inlined its own
 * MEDIA_ONLY_CRITERIA set and its own media-detection loop, which is
 * why counts drifted — `manualReviewRequired: 21` on scan_project
 * vs `totalManualCriteria: 25` on checklist for the same scan.
 *
 * Usage: call `detectApplicability(files)` once per scan, then hand
 * the result to every surface that needs to partition or count the
 * manual-review pile.
 */

import type { ParsedFile } from "../engine/scanner.ts";

/**
 * WCAG criteria that only apply when the scanned files contain
 * `<video>` or `<audio>` elements. Captions, audio description, and
 * sign-language alternatives are not applicable to a text-only app.
 *
 * If ra11y adds finders for other "only-applicable-when-X" classes
 * (forms, tables, maps), they slot in next to `MEDIA_ONLY` with their
 * own presence predicate.
 */
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

export interface Applicability {
  readonly hasMedia: boolean;
}

/** Scans file sources once for `<video>`/`<audio>` markers. */
export function detectApplicability(files: readonly ParsedFile[]): Applicability {
  for (const f of files) {
    const lower = f.source.toLowerCase();
    if (lower.includes("<video") || lower.includes("<audio")) return { hasMedia: true };
  }
  return { hasMedia: false };
}

/** True when the criterion is manual-only AND the scan proves it doesn't apply. */
export function isLikelyIrrelevant(criterionId: string, applicability: Applicability): boolean {
  if (!applicability.hasMedia && MEDIA_ONLY_CRITERIA.has(criterionId)) return true;
  return false;
}

/** Human-readable reason the criterion was marked irrelevant, if any. */
export function irrelevanceReason(
  criterionId: string,
  applicability: Applicability,
): string | undefined {
  if (!applicability.hasMedia && MEDIA_ONLY_CRITERIA.has(criterionId)) {
    return "No <video> or <audio> elements detected in the scanned files.";
  }
  return undefined;
}

/**
 * Splits a list of manual criterion IDs into the applicable pile
 * (needs human review) and the likely-irrelevant pile (pruned by
 * scan evidence). Both surfaces keep IDs, so counts = `.length`.
 */
export function splitManualCriteria(
  manualCriteria: readonly string[],
  applicability: Applicability,
): { applicable: readonly string[]; likelyIrrelevant: readonly string[] } {
  const applicable: string[] = [];
  const likelyIrrelevant: string[] = [];
  for (const id of manualCriteria) {
    if (isLikelyIrrelevant(id, applicability)) likelyIrrelevant.push(id);
    else applicable.push(id);
  }
  return { applicable, likelyIrrelevant };
}
