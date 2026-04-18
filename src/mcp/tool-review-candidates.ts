/**
 * The `review_candidates` MCP tool. Surfaces the tier-1 manual-review
 * candidates (produced by `src/review/finders/`) with enough source
 * context for an LLM caller to answer the criterion's review prompt
 * pass/fail without further filesystem access.
 *
 * This is the programmatic counterpart to the `checklist` tool:
 * `checklist` groups by criterion; `review_candidates` groups by
 * candidate so an agent can iterate one-by-one.
 *
 * Response shape:
 *   - `prompts: { [criterionId]: { text, finderId } }` — keyed by
 *     criterion, present only when at least one candidate has an
 *     associated finder prompt. The prompt text is identical for every
 *     candidate of the same criterion, so hoisting it to the top level
 *     dedupes the ~450-char prose that would otherwise repeat on each
 *     row (~6 KB of duplication on a 15-candidate criterion).
 *   - `candidates[]` — each entry carries `criterionId`, `location`,
 *     `reason`, optional `snippet`. The caller looks up
 *     `prompts[candidate.criterionId]` when it needs the review prompt;
 *     omission is the honest signal that no finder prompt is available
 *     for that criterion, not a `reviewPrompt: null` sentinel.
 */

import { runScan } from "../engine/scanner.ts";
import { BUILTIN_CANDIDATE_FINDERS } from "../review/index.ts";
import { BUILTIN_RULES } from "../rules/index.ts";
import { BUILTIN_STANDARDS } from "../standards/index.ts";
import { buildSnippetForReason, type SourceEntry, sourceIndex } from "./source-snippet.ts";
import {
  applyRuleSettings,
  errorResult,
  firstUnknownStandard,
  type McpTool,
  parseFiles,
  resolveLevel,
  resolveStandards,
  strArrayParam,
  strParam,
  textResult,
} from "./tools-helpers.ts";
import { warningsField } from "./warnings.ts";

export const reviewCandidatesTool: McpTool = {
  def: {
    name: "review_candidates",
    description:
      "List tier-1 manual-review candidates with source context. Use this to drive an LLM-assisted manual review loop: iterate candidates, read the snippet, answer the prompt, report verdict. The pass/fail review prompt is deduped to `prompts[criterionId].text` at the top level — each candidate carries `criterionId`, look up the prompt there. Pair with `scan` for full coverage.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "File or directory paths to scan. Omit for project root.",
        },
        standard: { type: "string", description: "Standard ID (e.g. wcag22)." },
        level: {
          type: "string",
          enum: ["A", "AA", "AAA"],
          description: "Conformance level filter.",
        },
        criterionId: {
          type: "string",
          description: "Optional. Filter to candidates for a single criterion (e.g. wcag22:1.2.1).",
        },
        cwd: { type: "string", description: "Base directory for relative paths." },
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
    const filterCriterion = strParam(params, "criterionId");
    if (filterCriterion !== undefined && !isKnownCriterion(filterCriterion)) {
      return errorResult({
        code: "criterion-not-found",
        message: `Unknown criterion '${filterCriterion}'.`,
        details: { requested: filterCriterion },
        remediation:
          "Use `explain_standard` to list criterion IDs for a given standard (e.g. wcag22:1.2.1).",
      });
    }
    const level = resolveLevel(strParam(params, "level"), session);
    const files = await parseFiles(paths, session, cwd);

    const { report } = runScan({
      standards: BUILTIN_STANDARDS,
      rules: applyRuleSettings(BUILTIN_RULES, session.config.rules),
      enabled: standards,
      files,
      finders: BUILTIN_CANDIDATE_FINDERS,
      level,
    });

    const candidates = (report.candidates ?? []).filter((c) => {
      if (filterCriterion && c.criterionId !== filterCriterion) return false;
      return isCriterionInLevel(c.criterionId, level);
    });

    const findersByCriterion = indexFindersByCriterion();
    const standardsById = new Map(BUILTIN_STANDARDS.map((s) => [s.id, s]));
    const sources = sourceIndex(files);

    // Build the keyed prompt map on the fly from the criterion IDs
    // actually present in the candidate list. We only emit an entry when
    // a finder exists for that criterion — omission is the honest
    // signal (see CLAUDE.md §1 "Ambiguous field shapes are dishonest")
    // rather than `{ text: "", finderId: null }`.
    const prompts: Record<string, { readonly text: string; readonly finderId: string }> = {};
    for (const c of candidates) {
      if (prompts[c.criterionId] !== undefined) continue;
      const finder = findersByCriterion.get(c.criterionId);
      if (finder === undefined) continue;
      prompts[c.criterionId] = {
        text: finder.docs.reviewPrompt,
        finderId: finder.id,
      };
    }
    const hasPrompts = Object.keys(prompts).length > 0;

    // Doctrine (CLAUDE.md §1 "Zero-output success is ambiguous failure"):
    // `{ candidateCount: 0, candidates: [] }` reads as "clean codebase"
    // when it may be "tool never ran." `review_candidates` has no
    // root-resolution step (takes `paths` directly, defaulting to
    // `[cwd]`) and doesn't load project config here; mirror the `scan`
    // tool's warning inputs so the malformed-input case surfaces the
    // honest `scanned_zero_files` code rather than a silent success.
    return textResult({
      level,
      standards,
      candidateCount: candidates.length,
      // Omit `prompts` entirely when empty (zero candidates or zero
      // finder-backed candidates) rather than emitting `prompts: {}`.
      // Per CLAUDE.md §1, conditional-spread at the assembly site.
      ...(hasPrompts ? { prompts } : {}),
      candidates: candidates.map((c) => {
        const standardId = c.criterionId.split(":")[0] ?? "";
        const criterionKey = c.criterionId;
        const standard = standardsById.get(standardId);
        const criterion = standard?.criteria.find((ck) => ck.id === criterionKey);
        const snippet = candidateSnippet(c, sources);
        // `confidence` is required on every grounded candidate —
        // finders set it based on what their static signal can claim
        // (deterministic match -> "high", structural-with-context
        // ambiguity -> "medium", narrow-heuristic -> "low"). Passed
        // through verbatim so an agent's threshold/filter logic reads
        // the same across automated findings and review candidates.
        return {
          criterionId: c.criterionId,
          title: criterion?.title ?? null,
          level: criterion?.level ?? null,
          location: c.location,
          reason: c.reason,
          confidence: c.confidence,
          ...(snippet === undefined ? {} : { snippet }),
        };
      }),
      ...warningsField({
        filesScanned: files.length,
        rootSource: null,
        configSource: undefined,
        analysisCoverage: undefined,
        filesByExtension: undefined,
      }),
    });
  },
};

/**
 * Produces the `snippet` field for a single candidate: prefers the
 * finder-supplied `snippet` when present (finders sometimes know the
 * right window better than ±3 lines — e.g. a cross-file reasoner),
 * falls back to a cache-only lookup on `(filePath, line)`. Returns
 * `undefined` when no honest snippet can be built so the caller
 * conditional-spreads the field away.
 */
function candidateSnippet(
  c: { location: { filePath: string; line: number }; snippet?: string; reason: string },
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

function indexFindersByCriterion(): Map<string, (typeof BUILTIN_CANDIDATE_FINDERS)[number]> {
  const out = new Map<string, (typeof BUILTIN_CANDIDATE_FINDERS)[number]>();
  for (const finder of BUILTIN_CANDIDATE_FINDERS) {
    for (const cid of finder.criterionIds) {
      if (!out.has(cid)) out.set(cid, finder);
    }
  }
  return out;
}

function isCriterionInLevel(criterionId: string, level: string): boolean {
  const rank: Record<string, number> = { A: 1, AA: 2, AAA: 3 };
  for (const standard of BUILTIN_STANDARDS) {
    const c = standard.criteria.find((x) => x.id === criterionId);
    if (c) return (rank[c.level] ?? 0) <= (rank[level] ?? 3);
  }
  return true;
}

function isKnownCriterion(criterionId: string): boolean {
  for (const std of BUILTIN_STANDARDS) {
    if (std.criteria.some((c) => c.id === criterionId)) return true;
  }
  return false;
}
