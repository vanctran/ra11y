/**
 * Shape the `suggest_fix` response from a resolved violation match.
 *
 * Three outcomes:
 *   - `kind: "none"` — no violation at that line (or unmatched rule).
 *   - `kind: "edit"` — the rule emitted fixPaths with a mechanical
 *     `primary.edit`; the agent can apply it via Edit directly. The
 *     edit is widened to a unique anchor window via `widenToUniqueAnchor`
 *     before serialization so apply_fix's literal find-and-replace
 *     matches exactly once. When no unique anchor fits in the cap, the
 *     payload carries a `caveat` string so the agent can disambiguate
 *     before applying.
 *   - `kind: "guidance"` — fixPaths without mechanical edits, or
 *     prose-only suggestion. The labels + snippet + sourceContext are
 *     enough for the agent to compose the edit.
 *
 * Pure function, no I/O. Lives in its own file so `tools.ts` stays
 * under the file-size budget; the suggest_fix handler imports this
 * directly.
 */

import type { FixPath, Violation } from "../types/violation.ts";
import { widenToUniqueAnchor } from "./unique-anchor.ts";

export interface BuildSuggestFixPayloadArgs {
  readonly ruleId: string;
  readonly line: number;
  readonly match: Violation | undefined;
  readonly sourceContext: string;
  readonly source: string;
}

export function buildSuggestFixPayload(args: BuildSuggestFixPayloadArgs): Record<string, unknown> {
  const { ruleId, line, match, sourceContext, source } = args;
  if (!match) {
    return {
      kind: "none",
      explanation: `No violation for ${ruleId} at line ${line}.`,
      confidence: "low",
    };
  }
  const confidence = match.severity === "error" ? "high" : "medium";
  // Omit empty `snippet` rather than emitting `snippet: ""` — a
  // sentinel-empty field forces the agent to re-read and disambiguate
  // whether the value is unavailable or genuinely empty. Present-only-
  // when-populated is the honest shape.
  const snippetField = match.snippet ? { snippet: match.snippet } : {};
  if (match.fixPaths) {
    const mechanical = match.fixPaths.primary.edit;
    const widened = mechanical
      ? widenToUniqueAnchor({
          source,
          oldText: mechanical.oldText,
          newText: mechanical.newText,
          line,
        })
      : null;
    const primary: FixPath = widened
      ? {
          ...match.fixPaths.primary,
          edit: { oldText: widened.oldText, newText: widened.newText },
        }
      : match.fixPaths.primary;
    const caveatField = widened?.caveat ? { caveat: widened.caveat } : {};
    return {
      kind: mechanical ? "edit" : "guidance",
      primary,
      alternatives: match.fixPaths.alternatives,
      explanation: match.suggestion ?? match.message,
      ...snippetField,
      ...caveatField,
      sourceContext,
      confidence,
    };
  }
  const explanation = match.suggestion
    ? match.suggestion
    : `Violation found but no fix guidance available for ${ruleId}. ${match.message}`;
  return {
    kind: "guidance",
    explanation,
    ...snippetField,
    sourceContext,
    confidence: match.suggestion ? confidence : "low",
  };
}
