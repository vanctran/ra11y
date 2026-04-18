/**
 * Per-rule coverage confidence — derived from the evaluation tracker
 * the rule runner filled during a scan loop, produces one
 * {@link PerRuleCoverage} entry per active rule whose
 * `appliesTo.fileExtensions` could fail to match any scanned file.
 *
 * Lives next to the scanner (not under `src/mcp/`) because the shape is
 * engine-owned — both the CLI reports and the MCP responses pivot off
 * the same array on `ScanResult.perRuleCoverage`.
 *
 * The canonical acute case motivating this module is Tailwind pre-build:
 * `contrast/minimum` targets `.css`, a Tailwind project's source tree
 * has 0 eligible CSS files, the rule reports 0 findings — and the agent
 * reads "0 findings" as "clean" when the truth is "the rule never had
 * anything to evaluate." Surfacing `coverageConfidence: "low"` with a
 * reason + remediation gives the agent the signal it needs to call
 * `scan_project` again with `additionalPaths: ["dist/assets"]`.
 */

import type { Rule } from "../types/rule.ts";
import type { PerRuleCoverage } from "../types/violation.ts";
import type { RuleEvaluationTracker } from "./rule-runner.ts";
import type { StandardFilter } from "./standard-filter.ts";

/**
 * Minimum evaluated-file count for a rule's coverage to register as
 * `"high"` confidence. At the floor (1) a single-file match is enough
 * to vouch for the rule on this scan — the threshold guards against
 * the Tailwind-pre-build acute case (rule targets `.css`, scan sees 0
 * eligible sources) without demanding a saturating evaluation count
 * no real project would hit. Deliberately not user-configurable to
 * start — see `docs/kb/architecture/ai-first-consumer.md` on numeric
 * thresholds.
 */
const MIN_FILES_FOR_HIGH_CONFIDENCE = 1;

/**
 * Derives {@link PerRuleCoverage} entries from the tracker the rule
 * runner filled during the scan loop. One entry per active rule that
 * carries an `appliesTo.fileExtensions` constraint (the shape the
 * coverage concept applies to — `contrast/minimum` targets `.css`, so
 * 0 eligible CSS files is a meaningful under-scan signal). Rules
 * without an extension gate match every file and don't benefit from
 * the surface; they're excluded so the array stays focused on the
 * cases agents actually branch on. Project-scoped rules (afterProject)
 * never get a per-file entry and are structurally absent from the
 * tracker, which matches — their confidence is always qualitative.
 *
 * Sort is alphabetical by rule ID so cross-run diff is stable; each
 * {@link PerRuleCoverage} is assembled with conditional spread on
 * `reason` / `remediation` per CLAUDE.md §1 "Ambiguous field shapes
 * are dishonest" — the fields are present only on low-confidence
 * entries.
 */
export function buildPerRuleCoverage(
  tracker: RuleEvaluationTracker,
  rules: readonly Rule[],
  filter: StandardFilter,
): readonly PerRuleCoverage[] {
  const out: PerRuleCoverage[] = [];
  const ruleById = new Map<string, Rule>();
  for (const r of rules) ruleById.set(r.id, r);
  const ids = [...tracker.counts.keys()].sort();
  for (const id of ids) {
    const rule = ruleById.get(id);
    if (!rule) continue;
    if (!filter.isRuleActive(rule)) continue;
    const extensions = rule.appliesTo?.fileExtensions;
    if (!extensions || extensions.length === 0) continue;
    const counts = tracker.counts.get(id);
    if (!counts) continue;
    out.push(buildCoverageEntry(id, counts.eligible, counts.evaluated, extensions));
  }
  return out;
}

/**
 * Assembles one {@link PerRuleCoverage} record. Low-confidence branches
 * name the condition (`"no files matching …"` vs `"all eligible files
 * were excluded or empty"`) and supply a one-line remediation the
 * agent can act on without docs — e.g. "add built CSS via
 * additionalPaths." High-confidence entries omit both reason and
 * remediation — the fields are present-when-meaningful (CLAUDE.md §1
 * "Ambiguous field shapes are dishonest").
 */
function buildCoverageEntry(
  ruleId: string,
  eligible: number,
  evaluated: number,
  extensions: readonly string[],
): PerRuleCoverage {
  if (eligible === 0) {
    return {
      ruleId,
      filesEvaluated: evaluated,
      filesEligible: eligible,
      coverageConfidence: "low",
      reason: `no files matching ${extensions.join(", ")} were scanned`,
      remediation: `add ${primaryExtension(extensions)} source files to the scan path, or pass \`additionalPaths\` when the content is compiled output (e.g. \`additionalPaths: ["dist/assets"]\` for Tailwind)`,
    };
  }
  if (evaluated < MIN_FILES_FOR_HIGH_CONFIDENCE) {
    return {
      ruleId,
      filesEvaluated: evaluated,
      filesEligible: eligible,
      coverageConfidence: "low",
      reason: "all eligible files were excluded or empty",
      remediation: "check exclude patterns and file contents",
    };
  }
  return {
    ruleId,
    filesEvaluated: evaluated,
    filesEligible: eligible,
    coverageConfidence: "high",
  };
}

/**
 * Names a representative extension for the remediation string —
 * `.css`-targeted rules get "CSS", `.html/.htm` → "HTML", etc.
 * Purely cosmetic; falls back to the raw list when the first entry
 * is unfamiliar.
 */
function primaryExtension(extensions: readonly string[]): string {
  const head = extensions[0]?.toLowerCase() ?? "";
  if (head === ".css") return "CSS";
  if (head === ".html" || head === ".htm") return "HTML";
  if (head === ".tsx" || head === ".jsx" || head === ".ts" || head === ".js") {
    return "JSX/TSX";
  }
  return extensions.join(", ");
}
