/**
 * Candidate finder: suppression/no-reason
 * Criterion: ra11y:suppression-no-reason
 *
 * Not a WCAG rule. Enforces suppression-reason hygiene per ra11y's
 * AI-first consumer doctrine; see
 * `docs/kb/architecture/ai-first-consumer.md`.
 *
 * A `ra11y-disable` / `ra11y-disable-next-line` pragma carries an
 * optional `: reason` or `-- reason` suffix captured by
 * `parseInlineDisablesDetailed`. A pragma without a reason silently
 * suppresses violations — accountability disappears into the diff. This
 * finder surfaces a review candidate at every bare pragma so the agent
 * reviewing a PR can propose a reason (or decide the suppression is
 * wrong and remove it).
 *
 * Design choices aligned with AI-first doctrine:
 *
 * - **Emit one candidate per bare pragma.** No rate-limiting, no file-
 *   level rollup. A file with 20 bare pragmas emits 20 candidates. The
 *   agent reads them in milliseconds and drafts reasons one-by-one.
 * - **No heuristic reason generation.** The finder does not try to
 *   guess a reason from the surrounding code — reason text is the human
 *   audit trail, and a synthesized reason defeats the point. The agent
 *   reads the source and writes the reason.
 * - **Confidence: "medium".** The static evidence (missing reason) is
 *   deterministic, but the author's intent is not — they may have just
 *   forgotten the reason slot, or they may have decided the suppression
 *   is self-evident. The agent's next read resolves it.
 * - **`ra11y-enable` is ignored.** It closes a region; a bare enable is
 *   not an accountability gap.
 * - **Process-rule namespace.** The criterion ID lives under `ra11y:`
 *   (not any WCAG/508/EN standard). The scanner activates these
 *   criteria unconditionally so the finder runs regardless of which
 *   standards are enabled — suppression hygiene is orthogonal to
 *   conformance.
 *
 * Self-suppression semantics:
 *
 * - A bare wildcard pragma (`<!-- ra11y-disable -->`) records `*` in
 *   the disableMap at its line, which silences every criterion
 *   including this finder's. That is intentional — a wildcard
 *   explicitly opts out of everything. Authors who want the finder to
 *   fire with a wildcard must supply a reason: `<!-- ra11y-disable:
 *   prompt-fragment, not rendered UI -->`.
 * - A rule- or criterion-scoped bare pragma
 *   (`<!-- ra11y-disable wcag22:1.3.3 -->`) only silences the listed
 *   token, so this finder's `ra11y:suppression-no-reason` candidate is
 *   unaffected and surfaces normally.
 *
 * Review finder — not biased toward false positives. The bare-pragma
 * evidence is deterministic; the question the candidate poses
 * ("document why this suppression is correct") is always worth asking.
 */

import { defineCandidateFinder } from "../../api/plugin.ts";
import { parseInlineDisablesDetailed } from "../../config/inline-disables.ts";
import type { ReviewCandidate } from "../../types/review.ts";
import type { FileContext } from "../../types/rule.ts";

/**
 * Process-rule criterion ID. The `ra11y:` namespace is reserved for
 * ra11y's own hygiene / process rules that aren't traceable to a WCAG
 * SC, Section 508 provision, or EN 301 549 clause. The scanner treats
 * every `ra11y:` criterion as always-active so these finders run
 * regardless of the enabled standards.
 */
export const SUPPRESSION_NO_REASON_CRITERION = "ra11y:suppression-no-reason";

/**
 * File extensions this finder applies to. Matches the set of languages
 * where `ra11y-disable` pragmas are recognized: JSX/TSX source, plain
 * TS/JS, HTML, and CSS.
 */
const APPLIES_TO_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js", ".html", ".htm", ".css"] as const;

export const finder = defineCandidateFinder({
  id: "suppression/no-reason",
  criterionIds: [SUPPRESSION_NO_REASON_CRITERION],
  scope: "document",
  appliesTo: { fileExtensions: [...APPLIES_TO_EXTENSIONS] },
  docs: {
    description:
      "Surfaces ra11y-disable pragmas that skipped the optional `: reason` slot. A bare pragma is still honored — the candidate asks the agent to document why the suppression is correct.",
    reviewPrompt:
      "Read the pragma's target code and either (a) add a `: <why>` suffix that explains why the suppression is correct, or (b) remove the pragma if the finding should be addressed. A silent suppression is an accountability gap even if the check is a false positive — future maintainers need the justification.",
    references: ["https://www.w3.org/TR/WCAG22/"],
  },
  afterFile(ctx: FileContext): readonly ReviewCandidate[] {
    return findBarePragmas(ctx);
  },
});

function findBarePragmas(ctx: FileContext): readonly ReviewCandidate[] {
  const { declarations } = parseInlineDisablesDetailed(ctx.source);
  const out: ReviewCandidate[] = [];
  for (const decl of declarations) {
    // `ra11y-enable` closes a region; a bare enable is not an
    // accountability gap. Only disable-family pragmas carry the
    // "why was this silenced?" question.
    if (decl.kind === "enable") continue;
    // A pragma with a captured reason string (even one character)
    // clears the hygiene bar. `parseInlineDisablesDetailed` normalizes
    // "colon with no text after" to `reason: undefined`, so
    // `ra11y-disable foo/bar:` is still treated as bare — documented
    // at the finder's docstring so reviewers know the edge case.
    if (decl.reason !== undefined) continue;
    out.push({
      criterionId: SUPPRESSION_NO_REASON_CRITERION,
      location: {
        filePath: ctx.filePath,
        line: decl.line,
        column: 1,
      },
      reason: formatReason(decl.ruleIds),
      // Confidence "medium": the missing-reason evidence is
      // deterministic, but the author's intent is not. They may have
      // forgotten the slot, or judged the suppression self-evident,
      // or pasted a snippet from elsewhere. The agent's next read
      // resolves it in seconds.
      confidence: "medium",
    });
  }
  return out;
}

function formatReason(ruleIds: readonly string[]): string {
  const target = summarizeTargets(ruleIds);
  return `ra11y-disable pragma without reason (${target}) — add ': <why the suppression is correct>' to keep the suppression auditable`;
}

/**
 * Names the rule IDs / criterion IDs the pragma silenced, for the
 * candidate's reason text. A wildcard pragma (ruleIds `["*"]`) reads as
 * `"silences all rules"`. A specific pragma reads as `"silences
 * <ruleId>"` or `"silences <id1>, <id2>"`. The detail is additive
 * context; the agent decides whether the blanket or targeted suppression
 * is appropriate.
 */
function summarizeTargets(ruleIds: readonly string[]): string {
  if (ruleIds.length === 1 && ruleIds[0] === "*") return "silences all rules";
  return `silences ${ruleIds.join(", ")}`;
}
