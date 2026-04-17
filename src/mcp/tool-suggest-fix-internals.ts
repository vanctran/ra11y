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
 * Every outcome also carries a `verifyCommand` (prose) +
 * `verifyCommandStructured` (`{ tool: "scan_file", args: { file,
 * ruleId } }`) pair naming the canonical re-check the agent should run
 * after applying the fix. Both fields are always populated — a
 * `suggest_fix` response without a re-verify is never meaningful, so
 * this is one of the few places that does NOT conditional-spread (the
 * CLAUDE.md §1 "present-when-meaningful" rule doesn't apply when the
 * field is always meaningful). See Track Q2 item Q2-VERIFYCMD.
 *
 * Pure function, no I/O. Lives in its own file so `tools.ts` stays
 * under the file-size budget; the suggest_fix handler imports this
 * directly.
 */

import type { FixPath, Violation } from "../types/violation.ts";
import { widenToUniqueAnchor } from "./unique-anchor.ts";

/**
 * Machine-parseable verify hint. `tool` is always `"scan_file"` — the
 * narrowest, most deterministic verify surface (one file, one pass).
 * `scan_project` is deliberately NOT used here: broader scans dilute
 * the honest signal ("did this specific fix land?") with unrelated
 * findings and cost the agent a slower round-trip.
 *
 * `args.file` mirrors the `file` that was passed into `suggest_fix`
 * (canonical `file` parameter per P2-R, never re-derived). `args.ruleId`
 * is optional — included when the rule is known so the agent can
 * post-filter the verify scan's findings to the rule it just fixed.
 * `scan_file` itself doesn't filter by `ruleId`, so the field is
 * advisory: it documents "what you were trying to fix" for the
 * consumer, not a server-side filter.
 */
export interface VerifyCommandStructured {
  readonly tool: "scan_file";
  readonly args: {
    readonly file: string;
    readonly ruleId?: string;
  };
}

export interface BuildSuggestFixPayloadArgs {
  readonly ruleId: string;
  readonly line: number;
  readonly match: Violation | undefined;
  readonly sourceContext: string;
  readonly source: string;
  /**
   * Canonical file path from the suggest_fix request. Passed through
   * to `verifyCommandStructured.args.file` so the verify hint names the
   * exact same path the fix was computed against — never re-derived
   * here to avoid shape-drift between the request and the verify
   * pointer.
   */
  readonly filePath: string;
}

/**
 * Builds the `verifyCommand` prose + `verifyCommandStructured`
 * machine form naming `scan_file` on the fix target. Both are always
 * emitted on every `suggest_fix` response — there is always a way to
 * re-check after applying the fix, so the fields are never ambiguous
 * (no conditional-spread).
 */
export function buildVerifyCommand(
  filePath: string,
  ruleId: string,
): {
  readonly verifyCommand: string;
  readonly verifyCommandStructured: VerifyCommandStructured;
} {
  return {
    verifyCommand: `mcp: scan_file({ file: ${JSON.stringify(filePath)} }) and confirm \`${ruleId}\` no longer fires at this location`,
    verifyCommandStructured: {
      tool: "scan_file",
      args: { file: filePath, ruleId },
    },
  };
}

export function buildSuggestFixPayload(args: BuildSuggestFixPayloadArgs): Record<string, unknown> {
  const { ruleId, line, match, sourceContext, source, filePath } = args;
  const verify = buildVerifyCommand(filePath, ruleId);
  if (!match) {
    return {
      kind: "none",
      explanation: `No violation for ${ruleId} at line ${line}.`,
      confidence: "low",
      ...verify,
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
      ...verify,
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
    ...verify,
  };
}
