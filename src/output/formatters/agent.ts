/**
 * Agent formatter — compact JSON output optimised for AI coding agents.
 *
 * Produces a single JSON object with four top-level keys:
 *   - `plan`   — executive summary: counts, effort estimate, natural-language blurb
 *   - `files`  — findings grouped by file path, sorted deterministically
 *   - `reviewCandidates` — manual-review locations surfaced by finders
 *   - `meta`   — tool / standard / run metadata
 *
 * No indentation (compact). Every byte matters in a context window.
 * Pipe through `jq` for human inspection.
 */

import { defineFormatter } from "../../api/plugin.ts";
import { EVALUATION_PROMPTS } from "../../review/evaluation-prompts.ts";
import type { ReviewCandidate } from "../../types/review.ts";
import type { ReportData, ScanResult, Violation } from "../../types/violation.ts";
import { buildAgentFinding } from "../agent-response/build-finding.ts";
import { buildAgentPlan } from "../agent-response/build-plan.ts";
import type {
  AgentFile,
  AgentMeta,
  AgentOutput,
  AgentReviewCandidate,
} from "../agent-response/types.ts";

const TOOL_NAME = "ra11y";
const TOOL_VERSION = "0.1.0";

// ─── Formatter ───────────────────────────────────────────────────────────────

export const agentFormatter = defineFormatter({
  id: "agent",
  format(result: ScanResult, report: ReportData): string {
    const sorted = sortViolations(result.violations);
    const byFile = groupByFile(sorted);
    const files = buildFiles(byFile);
    const plan = buildAgentPlan(sorted, files, result.violations.length);
    const reviewCandidates = buildReviewCandidates(report.candidates ?? []);
    const meta = buildMeta(result);

    const output: AgentOutput = { plan, files, reviewCandidates, meta };
    return JSON.stringify(output);
  },
});

// ─── Builders ────────────────────────────────────────────────────────────────

function sortViolations(violations: readonly Violation[]): readonly Violation[] {
  return [...violations].sort((a, b) => {
    const fp = a.location.filePath.localeCompare(b.location.filePath);
    if (fp !== 0) return fp;
    const ld = a.location.line - b.location.line;
    if (ld !== 0) return ld;
    const cd = a.location.column - b.location.column;
    if (cd !== 0) return cd;
    return a.ruleId.localeCompare(b.ruleId);
  });
}

function groupByFile(violations: readonly Violation[]): Map<string, Violation[]> {
  const map = new Map<string, Violation[]>();
  for (const v of violations) {
    const list = map.get(v.location.filePath);
    if (list === undefined) {
      map.set(v.location.filePath, [v]);
    } else {
      list.push(v);
    }
  }
  return map;
}

function buildFiles(byFile: Map<string, Violation[]>): readonly AgentFile[] {
  const paths = [...byFile.keys()].sort();
  return paths.map((path) => ({
    path,
    findings: (byFile.get(path) ?? []).map((v) => buildAgentFinding(v)),
  }));
}

function buildReviewCandidates(
  candidates: readonly ReviewCandidate[],
): readonly AgentReviewCandidate[] {
  return [...candidates]
    .sort((a, b) => {
      const fp = a.location.filePath.localeCompare(b.location.filePath);
      if (fp !== 0) return fp;
      return a.location.line - b.location.line;
    })
    .map((c) => {
      const prompt = EVALUATION_PROMPTS.get(c.criterionId);
      return {
        criterionId: c.criterionId,
        ...(prompt !== undefined && { tier: prompt.tier }),
        path: c.location.filePath,
        line: c.location.line,
        reason: c.reason,
        ...(c.snippet !== undefined && { snippet: c.snippet }),
        ...(prompt !== undefined && { question: prompt.question }),
        ...(prompt !== undefined && { passCriteria: prompt.passCriteria }),
        ...(prompt?.failExample !== undefined && { failExample: prompt.failExample }),
        ...(prompt?.passExample !== undefined && { passExample: prompt.passExample }),
        ...(prompt !== undefined && { suggestedFix: prompt.suggestedFix }),
      };
    });
}

function buildMeta(result: ScanResult): AgentMeta {
  return {
    tool: TOOL_NAME,
    version: TOOL_VERSION,
    standards: [...result.enabledStandards].sort(),
    level: "AA",
    filesScanned: result.filesScanned,
    durationMs: Math.round(result.durationMs),
  };
}
