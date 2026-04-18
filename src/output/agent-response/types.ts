/**
 * Shared agent-facing response shape types.
 *
 * These types are the single source of truth for the shape of agent-facing
 * JSON output. Both the CLI agent formatter (`src/output/formatters/agent.ts`)
 * and the MCP tools layer (`src/mcp/tools-helpers.ts`) consume this module so
 * the two surfaces stay structurally consistent.
 *
 * See docs/kb/architecture/output-formatters.md for the formatter contract
 * and docs/kb/architecture/ai-first-consumer.md for doctrine.
 */

import type { Severity } from "../../types/violation.ts";

export type Effort = "trivial" | "moderate" | "significant";
export type Category = "auto-fix" | "review" | "manual";
export type Confidence = "high" | "medium" | "low";
export type Safety = "safe" | "unsafe";

export interface AgentFix {
  readonly oldText: string;
  readonly newText: string;
  readonly confidence: Confidence;
  readonly safety: Safety;
  readonly description: string;
}

export interface AgentSnippet {
  readonly before: readonly string[];
  readonly highlighted: string;
  readonly after: readonly string[];
}

export interface AgentFinding {
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

export interface AgentFile {
  readonly path: string;
  readonly findings: readonly AgentFinding[];
}

export interface AgentReviewCandidate {
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

export interface AgentPlan {
  readonly totalFindings: number;
  readonly fixSuggestionAvailable: number;
  readonly reviewNeeded: number;
  readonly manualOnly: number;
  readonly estimatedEffort: Effort;
  readonly summary: string;
}

export interface AgentMeta {
  readonly tool: string;
  readonly version: string;
  readonly standards: readonly string[];
  readonly level: string;
  readonly filesScanned: number;
  readonly durationMs: number;
}

export interface AgentOutput {
  readonly plan: AgentPlan;
  readonly files: readonly AgentFile[];
  readonly reviewCandidates: readonly AgentReviewCandidate[];
  readonly meta: AgentMeta;
}
