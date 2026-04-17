/**
 * Dedupes review candidates across enabled standards.
 *
 * A single candidate finder (e.g. `review/images-of-text`) declares
 * many `criterionIds` — one per standard it satisfies, across the
 * WCAG 2.2 / 2.1 / Section 508 / EN 301 549 matrix. By construction
 * the finder emits one candidate per criterion at the same
 * `(filePath, line, column)`, because the scanner would otherwise
 * drop cross-standard coverage. That produces a correct violation
 * tree but a repetitive MCP response: the same file:line appears 4-6
 * times for the same check.
 *
 * `scan_project` doesn't emit review candidates directly — it rolls
 * them up into `actionableManualItems` counts. `scan_file` does
 * surface them, and without this collapse the agent sees identical
 * lines repeated under different standard prefixes. The canonical
 * shape is a single candidate with `criteria: string[]` — the same
 * shape violations have carried since the rule runner started
 * stamping `citedCriteria` across standards.
 *
 * Grouping key: `(filePath, line, column, reason)`. Candidates whose
 * `reason` differs are genuinely distinct (the images-of-text finder,
 * for example, appends a logotype-exemption hint on 1.4.5-family
 * criteria that 1.4.9 doesn't carry — different reason = different
 * advice to verify, even if the line is the same). Collapsing on the
 * reason preserves that signal; collapsing only on location would
 * erase it.
 */

import type { ReviewCandidate } from "../types/review.ts";

/**
 * Shape of a candidate in the `scan_file` response after dedup.
 * `criteria` is a sorted list of every criterion ID the candidate
 * satisfies — mirrors `Violation.criteria` on findings.
 */
export interface DedupedReviewCandidate {
  readonly criteria: readonly string[];
  readonly line: number;
  readonly column: number;
  readonly reason: string;
  readonly snippet?: string;
}

/**
 * Groups candidates by `(filePath, line, column, reason)` and folds
 * the per-criterion copies into one entry with an array `criteria`.
 * Input is already sorted by the scanner; we preserve first-seen
 * order so the response is deterministic across runs.
 */
export function dedupeReviewCandidatesForSingleFile(
  candidates: readonly ReviewCandidate[],
): readonly DedupedReviewCandidate[] {
  const byKey = new Map<
    string,
    {
      criteria: Set<string>;
      line: number;
      column: number;
      reason: string;
      snippet: string | undefined;
      order: number;
    }
  >();
  let nextOrder = 0;
  for (const c of candidates) {
    const key = `${c.location.filePath}\u0000${c.location.line}\u0000${c.location.column}\u0000${c.reason}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.criteria.add(c.criterionId);
      continue;
    }
    byKey.set(key, {
      criteria: new Set([c.criterionId]),
      line: c.location.line,
      column: c.location.column,
      reason: c.reason,
      snippet: c.snippet,
      order: nextOrder++,
    });
  }
  return [...byKey.values()]
    .sort((a, b) => a.order - b.order)
    .map((g) => ({
      criteria: [...g.criteria].sort(),
      line: g.line,
      column: g.column,
      reason: g.reason,
      // Omit snippet when undefined — empty-string is a dishonest
      // shape (CLAUDE.md §1 "Ambiguous field shapes are dishonest").
      ...(g.snippet === undefined ? {} : { snippet: g.snippet }),
    }));
}
