/**
 * Candidate runner.
 *
 * Invokes candidate finders against a parsed file, collecting review
 * candidates for manual criteria. Structurally parallel to rule-runner.ts
 * but emits ReviewCandidate[] instead of Violation[]. A crashing finder
 * contributes zero candidates silently — candidates are advisory, not
 * compliance-critical.
 *
 * See docs/architecture.md.
 */

import type { CandidateFinder, ReviewCandidate } from "../types/review.ts";
import type { Language } from "../types/rule.ts";
import { buildContext, type ContextInput } from "./context-builder.ts";

/** Per-file input to the candidate runner. */
export interface CandidateRunnerInput extends ContextInput {
  readonly finders: readonly CandidateFinder[];
  /** Criterion IDs that are active (manual criteria under enabled standards). */
  readonly activeCriterionIds: ReadonlySet<string>;
}

/** Runs every applicable finder against the given file and returns candidates. */
export function runFindersForFile(input: CandidateRunnerInput): readonly ReviewCandidate[] {
  const out: ReviewCandidate[] = [];
  const language = input.ast.language as Language;
  const fileExt = extractExtension(input.filePath);

  for (const finder of input.finders) {
    if (!isFinderActive(finder, input.activeCriterionIds)) continue;
    if (!appliesFinder(finder, fileExt, language)) continue;
    runOneFinder(finder, input, out);
  }

  return out;
}

function isFinderActive(finder: CandidateFinder, activeCriterionIds: ReadonlySet<string>): boolean {
  return finder.criterionIds.some((id) => activeCriterionIds.has(id));
}

function appliesFinder(finder: CandidateFinder, fileExt: string, _language: Language): boolean {
  const extensions = finder.appliesTo?.fileExtensions;
  if (!extensions || extensions.length === 0) return true;
  return extensions.includes(fileExt);
}

function runOneFinder(
  finder: CandidateFinder,
  input: CandidateRunnerInput,
  out: ReviewCandidate[],
): void {
  const sink: ReviewCandidate[] = [];
  const ctx = buildContext(input, sink as never);

  try {
    const fileCtx = { ...ctx, nodes: input.ast.root };
    collectCandidates(finder.find?.(ctx), out, input.filePath);
    collectCandidates(finder.afterFile?.(fileCtx), out, input.filePath);
  } catch {
    // Crashing finder → zero candidates, no noise. Advisory only.
  }
}

function collectCandidates(
  maybe: readonly ReviewCandidate[] | undefined,
  out: ReviewCandidate[],
  filePath: string,
): void {
  if (!Array.isArray(maybe)) return;
  for (const c of maybe) {
    out.push({
      ...c,
      location: { ...c.location, filePath },
    });
  }
}

function extractExtension(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  return dot === -1 ? "" : filePath.slice(dot);
}
