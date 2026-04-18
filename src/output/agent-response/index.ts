/**
 * Agent-response module — shared types and builders for agent-facing JSON output.
 *
 * Consumed by:
 *   - `src/output/formatters/agent.ts` (CLI `--format agent`)
 *   - `src/mcp/tools-helpers.ts` (MCP tool handlers)
 *
 * See docs/kb/architecture/output-formatters.md and
 * docs/kb/architecture/ai-first-consumer.md.
 */

export type {
  AgentFile,
  AgentFinding,
  AgentFix,
  AgentMeta,
  AgentOutput,
  AgentPlan,
  AgentReviewCandidate,
  AgentSnippet,
  Category,
  Confidence,
  Effort,
  Safety,
} from "./types.ts";
