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
import type { ReportData, ScanResult, Severity, Violation } from "../../types/violation.ts";

const TOOL_NAME = "ra11y";
const TOOL_VERSION = "0.1.0";

// ─── Output types ────────────────────────────────────────────────────────────

type Effort = "trivial" | "moderate" | "significant";
type Category = "auto-fix" | "review" | "manual";
type Confidence = "high" | "medium" | "low";
type Safety = "safe" | "unsafe";

interface AgentFix {
  readonly oldText: string;
  readonly newText: string;
  readonly confidence: Confidence;
  readonly safety: Safety;
  readonly description: string;
}

interface AgentSnippet {
  readonly before: readonly string[];
  readonly highlighted: string;
  readonly after: readonly string[];
}

interface AgentFinding {
  readonly id: string;
  /**
   * Stable group identity — same rule firing on AST-equivalent nodes
   * across files all share this key. Lets agents batch one fix across
   * every finding with the same `groupKey`. See
   * docs/adr/0008-violation-group-key.md.
   */
  readonly groupKey: string;
  readonly ruleId: string;
  readonly criteria: readonly string[];
  /**
   * Short human titles aligned index-for-index with `criteria`. Present
   * when the engine stamped them (every real emitted violation); omitted
   * when the upstream Violation had no `criteriaTitles` field.
   */
  readonly criteriaTitles?: readonly string[];
  /**
   * Structured reason codes naming known escape hatches that could
   * make this finding a false positive in context. Informational only —
   * the agent reads the cited file and decides. Omitted when empty, per
   * docs/adr/0009-violation-could-be-wrong-because.md.
   */
  readonly couldBeWrongBecause?: readonly string[];
  readonly severity: Severity;
  readonly line: number;
  readonly column: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly message: string;
  readonly snippet: AgentSnippet;
  readonly fix: AgentFix | null;
  readonly effort: Effort;
  readonly category: Category;
  readonly suppressWith: string;
  readonly suppressPlacement: string;
}

interface AgentFile {
  readonly path: string;
  readonly findings: readonly AgentFinding[];
}

interface AgentReviewCandidate {
  readonly criterionId: string;
  readonly tier?: 1 | 2 | 3;
  readonly path: string;
  readonly line: number;
  readonly reason: string;
  readonly snippet?: string;
  readonly question?: string;
  readonly passCriteria?: string;
  readonly failExample?: string;
  readonly passExample?: string;
  readonly suggestedFix?: string;
}

interface AgentPlan {
  readonly totalFindings: number;
  readonly fixSuggestionAvailable: number;
  readonly reviewNeeded: number;
  readonly manualOnly: number;
  readonly estimatedEffort: Effort;
  readonly summary: string;
}

interface AgentMeta {
  readonly tool: string;
  readonly version: string;
  readonly standards: readonly string[];
  readonly level: string;
  readonly filesScanned: number;
  readonly durationMs: number;
}

interface AgentOutput {
  readonly plan: AgentPlan;
  readonly files: readonly AgentFile[];
  readonly reviewCandidates: readonly AgentReviewCandidate[];
  readonly meta: AgentMeta;
}

// ─── Formatter ───────────────────────────────────────────────────────────────

export const agentFormatter = defineFormatter({
  id: "agent",
  format(result: ScanResult, report: ReportData): string {
    const sorted = sortViolations(result.violations);
    const byFile = groupByFile(sorted);
    const files = buildFiles(byFile);
    const plan = buildPlan(files, result.violations.length);
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
  return paths.map((path) => {
    const violations = byFile.get(path) ?? [];
    return {
      path,
      findings: violations.map((v) => buildFinding(v)),
    };
  });
}

function buildFinding(v: Violation): AgentFinding {
  const hasSuggestion = typeof v.suggestion === "string" && v.suggestion.length > 0;
  const category: Category =
    v.severity === "info" ? "review" : hasSuggestion ? "auto-fix" : "review";

  const finding: AgentFinding = {
    // Stable identity — survives line-number drift in the same file.
    // See src/utils/finding-id.ts for the hash recipe.
    id: v.findingId,
    // Stable group identity — same rule firing on AST-equivalent nodes
    // across files share this key. docs/adr/0008-violation-group-key.md.
    groupKey: v.groupKey,
    ruleId: v.ruleId,
    criteria: [...v.criteria],
    // Aligned index-for-index with `criteria`. Conditional-spread so we
    // never emit an ambiguous `criteriaTitles: []` sentinel when the
    // upstream Violation omitted the field (CLAUDE.md §1 "Ambiguous
    // field shapes are dishonest").
    ...(v.criteriaTitles !== undefined && { criteriaTitles: [...v.criteriaTitles] }),
    // Named reason codes for known escape hatches; informational only,
    // never auto-suppressing. Omitted when empty — see
    // docs/adr/0009-violation-could-be-wrong-because.md.
    ...(v.couldBeWrongBecause && v.couldBeWrongBecause.length > 0
      ? { couldBeWrongBecause: [...v.couldBeWrongBecause] }
      : {}),
    severity: v.severity,
    line: v.location.line,
    column: v.location.column,
    ...(v.location.endLine !== undefined && { endLine: v.location.endLine }),
    ...(v.location.endColumn !== undefined && { endColumn: v.location.endColumn }),
    message: v.message,
    snippet: buildSnippet(v),
    fix: hasSuggestion ? buildFix(v) : null,
    effort: "trivial",
    category,
    suppressWith: buildSuppressPragma(v.location.filePath, v.ruleId),
    suppressPlacement: buildSuppressPlacement(v.location.filePath),
  };

  return finding;
}

/**
 * Per-file-type placement guidance so the agent lands the pragma in a
 * syntactically valid spot on the first edit. JSX is the common
 * footgun — the JSX-expression pragma form is not an attribute value,
 * and placing it inside a tag's attribute list is a syntax error.
 * Other languages get shorter notes.
 */
function buildSuppressPlacement(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx") || lower.endsWith(".jsx")) {
    return "Place on the line immediately above the opening JSX tag of the flagged element — not inside attributes, and not between adjacent JSX siblings without a wrapping expression. The `{/* … */}` wrapper is valid as a JSX expression or at module scope.";
  }
  if (lower.endsWith(".css")) {
    return "Place on the line immediately above the CSS rule whose declarations are flagged.";
  }
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return "Place on the line immediately above the opening tag of the flagged element.";
  }
  return "Place on the line immediately above the flagged statement.";
}

function buildSnippet(v: Violation): AgentSnippet {
  if (typeof v.snippet === "string" && v.snippet.length > 0) {
    return { before: [], highlighted: v.snippet, after: [] };
  }
  return { before: [], highlighted: "", after: [] };
}

function buildFix(v: Violation): AgentFix {
  return {
    oldText: "",
    newText: "",
    confidence: severityToConfidence(v.severity),
    safety: "safe",
    description: v.suggestion ?? "",
  };
}

/**
 * Comment syntax by file type. TSX/JSX gets the `{/* … *\/}` form so it
 * pastes correctly inside a JSX element (where most violations live);
 * that form is also valid at module scope.
 */
function buildSuppressPragma(filePath: string, ruleId: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".css")) return `/* ra11y-disable-next-line ${ruleId} */`;
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return `<!-- ra11y-disable-next-line ${ruleId} -->`;
  }
  if (lower.endsWith(".tsx") || lower.endsWith(".jsx")) {
    return `{/* ra11y-disable-next-line ${ruleId} */}`;
  }
  return `// ra11y-disable-next-line ${ruleId}`;
}

function severityToConfidence(severity: Severity): Confidence {
  if (severity === "error") return "high";
  if (severity === "warning") return "medium";
  return "low";
}

function buildPlan(files: readonly AgentFile[], totalFindings: number): AgentPlan {
  let fixSuggestionAvailable = 0;
  let reviewNeeded = 0;
  let manualOnly = 0;

  const ruleCounts = new Map<string, number>();

  for (const file of files) {
    for (const finding of file.findings) {
      if (finding.category === "auto-fix") fixSuggestionAvailable += 1;
      else if (finding.category === "review") reviewNeeded += 1;
      else manualOnly += 1;

      const count = ruleCounts.get(finding.ruleId) ?? 0;
      ruleCounts.set(finding.ruleId, count + 1);
    }
  }

  const effort = computeEffort(totalFindings, fixSuggestionAvailable);
  const summary = buildSummary(
    totalFindings,
    fixSuggestionAvailable,
    reviewNeeded,
    manualOnly,
    ruleCounts,
  );

  return {
    totalFindings,
    fixSuggestionAvailable,
    reviewNeeded,
    manualOnly,
    estimatedEffort: effort,
    summary,
  };
}

function computeEffort(total: number, fixSuggestions: number): Effort {
  if (total === 0) return "trivial";
  if (fixSuggestions === 0) return "trivial"; // all notes/review — nothing to fix
  if (fixSuggestions > MODERATE_THRESHOLD) return "moderate";
  return "trivial";
}

const MODERATE_THRESHOLD = 5;

function buildSummary(
  total: number,
  fixSuggestions: number,
  reviewNeeded: number,
  manualOnly: number,
  ruleCounts: Map<string, number>,
): string {
  if (total === 0) return "No accessibility violations found.";

  const parts: string[] = [];
  if (fixSuggestions > 0) parts.push(`${fixSuggestions} with fix suggestions`);
  if (reviewNeeded > 0) parts.push(`${reviewNeeded} need review`);
  if (manualOnly > 0) parts.push(`${manualOnly} manual`);

  const countSuffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  const noun = total === 1 ? "finding" : "findings";
  let summary = `${total} ${noun}${countSuffix}.`;

  const topRules = topN(ruleCounts, TOP_RULES_COUNT);
  if (topRules.length > 0) {
    const ruleList = topRules.map(([id, n]) => `${id} (${n})`).join(", ");
    summary += ` Most common: ${ruleList}.`;
  }

  return summary;
}

const TOP_RULES_COUNT = 3;

function topN(map: Map<string, number>, n: number): [string, number][] {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
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
