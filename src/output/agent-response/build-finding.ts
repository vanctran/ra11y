/**
 * buildAgentFinding — Violation → AgentFinding builder.
 *
 * Single implementation consumed by both the CLI agent formatter
 * (`src/output/formatters/agent.ts`) and the MCP tools layer.
 *
 * Hollow-fix rule: `AgentFix.oldText` / `newText` are emitted only when the
 * violation carries a mechanical edit via `fixPaths?.primary.edit`. For
 * guidance-only findings (prose `suggestion` but no edit), `fix` carries only
 * `description`, `confidence`, and `safety` — no empty-string sentinels. Per
 * CLAUDE.md §1 "Ambiguous field shapes are dishonest."
 */

import type { Violation } from "../../types/violation.ts";
import type { AgentFinding, AgentFix, AgentSnippet, Category, Confidence } from "./types.ts";

/** @internal */
export function severityToConfidence(severity: string): Confidence {
  if (severity === "error") return "high";
  if (severity === "warning") return "medium";
  return "low";
}

function buildSnippet(v: Violation): AgentSnippet {
  if (typeof v.snippet === "string" && v.snippet.length > 0) {
    return { before: [], highlighted: v.snippet, after: [] };
  }
  return { before: [], highlighted: "", after: [] };
}

function buildFix(v: Violation): AgentFix | undefined {
  const hasMechanicalEdit = v.fixPaths?.primary.edit !== undefined;
  const hasGuidance = typeof v.suggestion === "string" && v.suggestion.length > 0;

  if (hasMechanicalEdit && v.fixPaths !== undefined) {
    // Deterministic rewrite — emit both text fields so an agent can apply verbatim.
    const edit = v.fixPaths.primary.edit;
    if (edit !== undefined) {
      return {
        oldText: edit.oldText,
        newText: edit.newText,
        safety: "safe",
        description: v.suggestion ?? v.fixPaths.primary.label,
      };
    }
  }

  if (hasGuidance && typeof v.suggestion === "string") {
    // Prose guidance only — no hollow oldText/newText sentinels.
    return {
      safety: "safe",
      description: v.suggestion,
    };
  }

  return undefined;
}

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

/**
 * Per-file-type placement guidance so the agent lands the pragma in a
 * syntactically valid spot on the first edit.
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

/**
 * Convert a single {@link Violation} into an {@link AgentFinding}.
 *
 * The `category` field uses `"auto-fix"` when there is a mechanical edit,
 * `"review"` for guidance-only or no-suggestion findings at non-info severity,
 * and `"review"` for info-severity findings.
 */
export function buildAgentFinding(v: Violation): AgentFinding {
  const hasMechanicalEdit = v.fixPaths?.primary.edit !== undefined;
  const hasSuggestion = typeof v.suggestion === "string" && v.suggestion.length > 0;
  const category: Category = hasMechanicalEdit
    ? "auto-fix"
    : v.severity === "info"
      ? "review"
      : hasSuggestion
        ? "auto-fix"
        : "review";

  const fix = buildFix(v);

  return {
    findingId: v.findingId,
    groupKey: v.groupKey,
    ruleId: v.ruleId,
    fixClass: v.fixClass,
    criteria: [...v.criteria],
    ...(v.criteriaTitles !== undefined && { criteriaTitles: [...v.criteriaTitles] }),
    ...(v.couldBeWrongBecause && v.couldBeWrongBecause.length > 0
      ? { couldBeWrongBecause: [...v.couldBeWrongBecause] }
      : {}),
    severity: v.severity,
    confidence: severityToConfidence(v.severity),
    line: v.location.line,
    column: v.location.column,
    ...(v.location.endLine !== undefined && { endLine: v.location.endLine }),
    ...(v.location.endColumn !== undefined && { endColumn: v.location.endColumn }),
    message: v.message,
    snippet: buildSnippet(v),
    ...(fix === undefined ? {} : { fix }),
    effort: "trivial",
    category,
    suppressWith: buildSuppressPragma(v.location.filePath, v.ruleId),
    suppressPlacement: buildSuppressPlacement(v.location.filePath),
  };
}
