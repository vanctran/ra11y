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

import type { FixClass } from "../../types/rule.ts";
import type { Severity } from "../../types/violation.ts";

export type Effort = "trivial" | "moderate" | "significant";
export type Category = "auto-fix" | "review" | "manual";
export type Confidence = "high" | "medium" | "low";
export type Safety = "safe" | "unsafe";

/**
 * A structured fix suggestion attached to a single finding.
 *
 * `oldText` and `newText` are present only when the rule emits a mechanical
 * edit that can be applied verbatim. For guidance-only findings they are
 * omitted — per CLAUDE.md §1 "Ambiguous field shapes are dishonest," empty
 * string sentinels (`oldText: ""`) are a silent-miss hazard. Use the
 * `description` field for prose guidance in both cases.
 *
 * Confidence lives on the parent {@link AgentFinding} — one confidence
 * per finding, derived from severity. A separate per-fix confidence
 * was redundant.
 */
export interface AgentFix {
  readonly oldText?: string;
  readonly newText?: string;
  readonly safety: Safety;
  readonly description: string;
}

export interface AgentSnippet {
  readonly before: readonly string[];
  readonly highlighted: string;
  readonly after: readonly string[];
}

export interface AgentFinding {
  /**
   * Stable identity — lets agents verify "did my edit close finding
   * X?" by exact ID rather than (file, line, ruleId) fuzzy match that
   * breaks on line-number drift. Disambiguated from `ruleId` /
   * `groupKey` by the `Id` suffix. Derived from
   * `Violation.findingId` — see `src/utils/finding-id.ts`.
   */
  readonly findingId: string;
  /**
   * Stable group identity — same rule firing on AST-equivalent nodes
   * across files all share this key. Lets agents batch one fix across
   * every finding with the same `groupKey`. See
   * docs/adr/0008-violation-group-key.md.
   */
  readonly groupKey: string;
  readonly ruleId: string;
  /**
   * Per-finding remediation lane stamped from the rule's `fixClass`
   * metadata. Lets agents batch-route at scan time without a per-
   * finding `suggest_fix` round-trip. See
   * docs/adr/0007-violation-fix-class-metadata.md. Distinct axis from
   * `suggest_fix.kind` ("what does the payload contain") — do not
   * conflate.
   */
  readonly fixClass: FixClass;
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
  /**
   * Top-level confidence for this finding, derived deterministically
   * from `severity`: `error` → `high`, `warning` → `medium`, `info` →
   * `low`. Lives on the finding (not on {@link AgentFix}) so callers
   * can consume it without reading into the optional `fix` object —
   * including findings that emit no fix at all.
   */
  readonly confidence: Confidence;
  readonly line: number;
  readonly column: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly message: string;
  readonly snippet: AgentSnippet;
  /** Present when the violation has a mechanical edit or prose guidance; absent otherwise. */
  readonly fix?: AgentFix;
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

/**
 * Executive summary for the agent: counts, effort, and a natural-language blurb.
 *
 * `mechanicalEditsAvailable` counts violations where `fixPaths?.primary.edit`
 * is present — deterministic, batch-apply work.
 * `guidanceFixesAvailable` counts violations with prose-only guidance but no
 * mechanical edit — route-to-rewrite work.
 *
 * These two replace the former `fixSuggestionAvailable` composite, which summed
 * categorically different sub-buckets. Per CLAUDE.md §1 "Composite headline
 * counts are dishonest," split counters are the honest shape.
 */
export interface AgentPlan {
  readonly totalFindings: number;
  readonly mechanicalEditsAvailable: number;
  readonly guidanceFixesAvailable: number;
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
