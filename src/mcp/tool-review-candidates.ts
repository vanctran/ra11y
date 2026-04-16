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
 * Included per candidate:
 *   - criterionId + normative title
 *   - location (file, line, col)
 *   - reason (why this location surfaced)
 *   - snippet (source excerpt, pre-trimmed)
 *   - reviewPrompt (from the finder; the exact question to answer)
 */

import { runScan } from "../engine/scanner.ts";
import { BUILTIN_CANDIDATE_FINDERS } from "../review/index.ts";
import { BUILTIN_RULES } from "../rules/index.ts";
import { BUILTIN_STANDARDS } from "../standards/index.ts";
import {
  applyRuleSettings,
  type McpTool,
  parseFiles,
  resolveLevel,
  resolveStandards,
  strArrayParam,
  strParam,
  textResult,
} from "./tools-helpers.ts";

export const reviewCandidatesTool: McpTool = {
  def: {
    name: "review_candidates",
    description:
      "List tier-1 manual-review candidates with source context and the exact pass/fail question. Use this to drive an LLM-assisted manual review loop: iterate candidates, read the snippet, answer the prompt, report verdict. Pair with `scan` for full coverage.",
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

    const filterCriterion = strParam(params, "criterionId");
    const candidates = (report.candidates ?? []).filter((c) => {
      if (filterCriterion && c.criterionId !== filterCriterion) return false;
      return isCriterionInLevel(c.criterionId, level);
    });

    const findersByCriterion = indexFindersByCriterion();
    const standardsById = new Map(BUILTIN_STANDARDS.map((s) => [s.id, s]));

    return textResult({
      level,
      standards,
      candidateCount: candidates.length,
      candidates: candidates.map((c) => {
        const standardId = c.criterionId.split(":")[0] ?? "";
        const criterionKey = c.criterionId;
        const standard = standardsById.get(standardId);
        const criterion = standard?.criteria.find((ck) => ck.id === criterionKey);
        const finder = findersByCriterion.get(criterionKey);
        return {
          criterionId: c.criterionId,
          title: criterion?.title ?? null,
          level: criterion?.level ?? null,
          location: c.location,
          reason: c.reason,
          snippet: c.snippet ?? null,
          reviewPrompt: finder?.docs.reviewPrompt ?? null,
          finderId: finder?.id ?? null,
        };
      }),
    });
  },
};

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
