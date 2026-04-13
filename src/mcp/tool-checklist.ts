/**
 * The `checklist` MCP tool. Split into its own file so src/mcp/tools.ts
 * stays under the file budget — the tool now includes element-presence
 * detection and relevance hints, which is meaningful logic to keep out
 * of the central tool-registration module.
 */

import type { ParsedFile } from "../engine/scanner.ts";
import { runScan } from "../engine/scanner.ts";
import { buildCoverageReport } from "../reports/coverage.ts";
import { BUILTIN_CANDIDATE_FINDERS } from "../review/index.ts";
import { BUILTIN_RULES } from "../rules/index.ts";
import { BUILTIN_STANDARDS } from "../standards/index.ts";
import {
  applyRuleSettings,
  findStandard,
  type McpTool,
  parseFiles,
  resolveLevel,
  resolveStandards,
  strArrayParam,
  strParam,
  textResult,
} from "./tools-helpers.ts";

export const checklistTool: McpTool = {
  def: {
    name: "checklist",
    description:
      "Get the manual review checklist — criteria that can't be fully automated. Includes evaluation prompts and candidate source locations. Call without `paths` for a project-wide checklist rooted at `cwd`. Items flagged `likelyRelevant: false` are criteria the scan can tell don't apply (e.g., no <video>/<audio> in the codebase means the 1.2.* media criteria are irrelevant) — triage the relevant ones first.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional. File or directory paths to scan. Omit for a project-wide checklist rooted at `cwd`.",
        },
        standard: { type: "string", description: "Standard ID." },
        level: { type: "string", enum: ["A", "AA", "AAA"], description: "Conformance level." },
        cwd: {
          type: "string",
          description:
            "Base directory. Used as the scan root when `paths` is omitted, and for resolving relative `paths` when given.",
        },
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

    const { result, report } = runScan({
      standards: BUILTIN_STANDARDS,
      rules: applyRuleSettings(BUILTIN_RULES, session.config.rules),
      enabled: standards,
      files,
      finders: BUILTIN_CANDIDATE_FINDERS,
    });

    const coverage = buildCoverageReport(result, BUILTIN_STANDARDS, level);
    const presence = detectElementPresence(files);

    const needsReview: Record<string, unknown>[] = [];
    const likelyIrrelevant: Record<string, unknown>[] = [];
    for (const entry of coverage) {
      const standard = findStandard(entry.standardId);
      if (!standard) continue;
      for (const criterionId of entry.manualCriteria) {
        const criterion = standard.criteria.find((c) => c.id === criterionId);
        if (!criterion) continue;
        const candidates = (report.candidates ?? []).filter((c) => c.criterionId === criterionId);
        const relevance = assessRelevance(criterion.id, presence);
        const item: Record<string, unknown> = {
          criterionId: criterion.id,
          title: criterion.title,
          level: criterion.level,
          candidates: candidates.map((c) => ({
            path: c.location.filePath,
            line: c.location.line,
            reason: c.reason,
          })),
        };
        if (relevance.likelyRelevant === false) {
          item["likelyRelevant"] = false;
          item["relevanceReason"] = relevance.reason;
          likelyIrrelevant.push(item);
        } else {
          needsReview.push(item);
        }
      }
    }

    const items = [...needsReview, ...likelyIrrelevant];
    const summary = {
      total: items.length,
      needsReview: needsReview.length,
      likelyIrrelevant: likelyIrrelevant.length,
    };

    return textResult({ summary, items });
  },
};

interface ElementPresence {
  readonly hasMedia: boolean;
}

/**
 * Walks parsed files once to learn what element families are present.
 * Used to tell the agent when a manual criterion is obviously irrelevant
 * (e.g., no `<video>` or `<audio>` → 1.2.* captions/audio criteria don't
 * apply to this repo). Zero AST traversal — a cheap text scan is enough
 * for a hint, and we're ok with the occasional false positive from a
 * string literal that happens to contain "<video".
 */
function detectElementPresence(files: readonly ParsedFile[]): ElementPresence {
  let hasMedia = false;
  for (const f of files) {
    const lower = f.source.toLowerCase();
    if (lower.includes("<video") || lower.includes("<audio")) {
      hasMedia = true;
      break;
    }
  }
  return { hasMedia };
}

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

/**
 * Returns a relevance hint for a manual criterion based on detected
 * elements. Conservative: only flags media criteria as irrelevant when
 * no <video>/<audio> is present. Everything else defaults to likely
 * relevant — human judgment is expected on the rest.
 */
function assessRelevance(
  criterionId: string,
  presence: ElementPresence,
): { readonly likelyRelevant: boolean; readonly reason?: string } {
  if (MEDIA_ONLY_CRITERIA.has(criterionId) && !presence.hasMedia) {
    return {
      likelyRelevant: false,
      reason: "No <video> or <audio> elements detected in the scanned files.",
    };
  }
  return { likelyRelevant: true };
}
