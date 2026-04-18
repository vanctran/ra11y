/**
 * The `list_suppressions` MCP tool (Q2-LISTSUPP).
 *
 * Enumerates every active `ra11y-disable` / `ra11y-disable-next-line`
 * pragma in the scanned tree. Lightweight: parses sources for pragmas
 * only — does NOT run rules — so it's fast enough to power a
 * suppression audit, annual-review workflow, or CI gate that checks
 * the pragma population without a full scan.
 *
 * Shape contract (AI-first doctrine, `docs/kb/architecture/ai-first-consumer.md`):
 *
 *   - `suppressions: SuppressionEntry[]` is always present. An empty
 *     array is an affirmative fact ("tree is pragma-free"), not an
 *     ambiguous empty — surface, don't omit.
 *   - Each entry is `{ file, line, ruleId, criterionId, reason?, wildcard }`:
 *       - `file`: absolute path of the source that held the pragma.
 *       - `line`: 1-based line number where the pragma lives.
 *       - `ruleId`: populated only when the pragma names a rule ID
 *         (e.g. `keyboard/handler-missing`), otherwise null.
 *       - `criterionId`: populated only when the pragma names a
 *         criterion ID (e.g. `wcag22:1.4.3`), otherwise null.
 *       - `reason`: OMITTED when the pragma is bare. Never `""`,
 *         never `null` — conditional spread at the assembly site.
 *       - `wildcard`: true when the pragma has no rule/criterion
 *         tokens (i.e. `<!-- ra11y-disable -->`), in which case BOTH
 *         `ruleId` and `criterionId` are null.
 *   - Entries are emitted one per (pragma line × named token), so a
 *     pragma that silences two rule IDs produces two entries — this
 *     keeps the shape flat and auditable. Deterministic order: file
 *     ascending, then line ascending, then token ascending.
 *   - `meta` carries scan-confidence telemetry (`cwd`, `configSource`,
 *     `filesScanned`, `activeNativeWrappers`, `rulesEvaluated`) so the
 *     agent can tell whether the enumeration had teeth without a
 *     separate `scan_project` round-trip.
 *   - `nextStep` prose points at the follow-up call: if any entry has
 *     no `reason`, route to `review_candidates` where the bare pragmas
 *     surface under `suppression/no-reason`; otherwise confirm nothing
 *     is pending.
 *
 * Pairs with Q2-REASON — the `suppression/no-reason` review-candidate
 * finder flags bare pragmas one-by-one; this tool enumerates the full
 * pragma population at a glance. Two views, same source of truth
 * (`parseInlineDisablesDetailed`).
 */

import { parseInlineDisablesDetailed } from "../config/inline-disables.ts";
import { BUILTIN_RULES } from "../rules/index.ts";
import { gitRoot } from "../utils/git.ts";
import {
  applyRuleSettings,
  type McpTool,
  parseFiles,
  strArrayParam,
  strParam,
  textResult,
} from "./tools-helpers.ts";
import { type ActiveNativeWrapper, resolveWrapperSources } from "./wrappers-meta.ts";

/**
 * One pragma hit. Emitted one entry per (line × named token); a
 * wildcard pragma emits a single entry with both ID fields null and
 * `wildcard: true`. `reason` is omitted when the pragma is bare so
 * downstream consumers can distinguish "no reason supplied" from
 * "empty reason string" (AI-first consumer doctrine — ambiguous field
 * shapes are dishonest).
 */
export interface SuppressionEntry {
  readonly file: string;
  readonly line: number;
  readonly ruleId: string | null;
  readonly criterionId: string | null;
  readonly reason?: string;
  readonly wildcard: boolean;
}

export const listSuppressionsTool: McpTool = {
  def: {
    name: "list_suppressions",
    description:
      "List every active ra11y-disable pragma in the scanned tree. Useful for suppression audit, annual review, and finding bare-reason pragmas (which also surface under review_candidates via suppression/no-reason). Does NOT run rules; fast enumeration only.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description:
            "Root directory to enumerate. Defaults to the host-declared root, then the git root of the MCP server's spawn directory, then process.cwd().",
        },
        additionalPaths: {
          type: "array",
          items: { type: "string" },
          description:
            "Paths to include in addition to the auto-discovered tree, bypassing `.gitignore` and default build-dir skips. Typically used for post-compile CSS/HTML that lives under `dist/` or `build/`. Relative paths resolve from `cwd`.",
        },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async handler(params, session) {
    const explicitCwd = strParam(params, "cwd");
    const spawnCwd = process.cwd();
    const hostRoot = explicitCwd === undefined ? session.firstRootPath() : null;
    const root = explicitCwd ?? hostRoot ?? gitRoot(spawnCwd) ?? spawnCwd;

    const projectConfig = await session.loadProjectConfig(root);
    const additionalPaths = strArrayParam(params, "additionalPaths") ?? [];
    const files = await parseFiles([root, ...additionalPaths], session, root);

    const entries = collectSuppressions(files);
    // Rule count parity with scan_project.meta.rulesEvaluated: applies
    // the same on/off filtering the scanner would. Lets an agent
    // cross-check that the enumeration ran under the same effective
    // ruleset without a second tool call.
    const effective = session.effectiveRules(projectConfig);
    const rulesEvaluated = applyRuleSettings(BUILTIN_RULES, effective).length;

    // Unified tagged list (Q2R2-WRAPPER-SOURCES). `list_suppressions`
    // doesn't run the auto-detect pass, so fromAutoDetect stays empty
    // — every entry carries `source: "config"` or `"session"` (the
    // `confirmed` flag is omitted for these channels per the
    // wrappers-meta contract).
    const { bySource } = resolveWrapperSources(
      { fromFile: projectConfig.nativeWrappers, fromSession: session.config.nativeWrappers },
      session,
    );
    const activeNativeWrappers = buildListSuppressionsWrappers(bySource);

    return textResult({
      suppressions: entries,
      meta: {
        cwd: root,
        configSource: projectConfig.sourcePath,
        filesScanned: files.length,
        rulesEvaluated,
        ...(activeNativeWrappers.length > 0 ? { activeNativeWrappers } : {}),
      },
      nextStep: buildNextStep(entries),
    });
  },
};

/**
 * Builds the tagged-entry list for `list_suppressions`. Config entries
 * come first (alphabetical), then session entries (alphabetical). No
 * `confirmed` field on either — the flag is auto-detect only (P1-F),
 * and this tool never auto-detects. Per CLAUDE.md §1 "Ambiguous field
 * shapes are dishonest," `confirmed` is omitted entirely for
 * author-supplied sources.
 */
function buildListSuppressionsWrappers(bySource: {
  readonly fromConfig: readonly string[];
  readonly fromSession: readonly string[];
}): readonly ActiveNativeWrapper[] {
  const out: ActiveNativeWrapper[] = [];
  const seen = new Set<string>();
  for (const name of [...bySource.fromConfig].sort()) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, source: "config" });
  }
  for (const name of [...bySource.fromSession].sort()) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, source: "session" });
  }
  return out;
}

/**
 * Walks each parsed file's source for pragma declarations and flattens
 * them into the audit list. One entry per (line × named token) — a
 * pragma that silences two rule IDs produces two entries so downstream
 * filtering by ID stays exact. Wildcard pragmas (no tokens named)
 * produce a single entry with both ID fields null.
 *
 * Order is deterministic: file ascending, then line ascending, then
 * token ascending within a line. An agent paginating the response
 * gets the same slice on the same input every time.
 */
function collectSuppressions(
  files: readonly { readonly filePath: string; readonly source: string }[],
): readonly SuppressionEntry[] {
  const out: SuppressionEntry[] = [];
  const sortedFiles = [...files].sort((a, b) => a.filePath.localeCompare(b.filePath));
  for (const file of sortedFiles) {
    const { declarations } = parseInlineDisablesDetailed(file.source);
    const fileEntries: SuppressionEntry[] = [];
    for (const decl of declarations) {
      // `ra11y-enable` closes a region — not a suppression. Skip so
      // the audit list reads as "every active silence."
      if (decl.kind === "enable") continue;
      for (const entry of buildEntriesForDeclaration(file.filePath, decl)) {
        fileEntries.push(entry);
      }
    }
    // Sort within file: by line, then by token. Entries produced by a
    // single pragma with multiple tokens are adjacent but
    // alphabetically stable for reproducible test output.
    fileEntries.sort((a, b) => {
      if (a.line !== b.line) return a.line - b.line;
      return tokenKey(a).localeCompare(tokenKey(b));
    });
    out.push(...fileEntries);
  }
  return out;
}

/**
 * Expands a single `SuppressionDeclaration` into one or more
 * `SuppressionEntry` values.
 *
 *   - Wildcard pragma (`ruleIds === ["*"]`) → one entry with
 *     `wildcard: true` and both ID fields null.
 *   - Named pragma (`ruleIds === ["wcag22:1.4.3", "keyboard/foo"]`) →
 *     one entry per token. A token containing `:` classifies as a
 *     criterion ID; otherwise as a rule ID (the in-source pragma
 *     grammar doesn't allow ambiguity — criteria are namespaced).
 *
 * `reason` is conditionally spread so bare pragmas omit the field
 * entirely rather than ship `reason: ""` or `reason: null`.
 */
function buildEntriesForDeclaration(
  file: string,
  decl: {
    readonly kind: "disable" | "disable-next-line" | "enable";
    readonly line: number;
    readonly ruleIds: readonly string[];
    readonly reason?: string;
  },
): readonly SuppressionEntry[] {
  const reasonField = decl.reason === undefined ? {} : { reason: decl.reason };
  if (decl.ruleIds.length === 1 && decl.ruleIds[0] === "*") {
    return [
      {
        file,
        line: decl.line,
        ruleId: null,
        criterionId: null,
        ...reasonField,
        wildcard: true,
      },
    ];
  }
  return decl.ruleIds.map((token) => ({
    file,
    line: decl.line,
    ruleId: isCriterionId(token) ? null : token,
    criterionId: isCriterionId(token) ? token : null,
    ...reasonField,
    wildcard: false,
  }));
}

/**
 * Criterion IDs are namespaced `<standard>:<number>` (e.g.
 * `wcag22:1.4.3`, `section508:1194.22.c`). Rule IDs use `/` as the
 * separator (e.g. `keyboard/handler-missing`) and never contain `:`.
 * The pragma parser preserves the distinction verbatim, so a `:` in
 * the token is a reliable classifier.
 */
function isCriterionId(token: string): boolean {
  return token.includes(":");
}

function tokenKey(entry: SuppressionEntry): string {
  if (entry.wildcard) return "*";
  return entry.ruleId ?? entry.criterionId ?? "";
}

/**
 * Points the agent at the next productive call. When any entry is
 * bare, `review_candidates` is where the per-pragma "please document
 * why" prompts live (via the `suppression/no-reason` finder). When
 * every pragma has a reason, the audit is complete for this scan.
 */
function buildNextStep(entries: readonly SuppressionEntry[]): string {
  if (entries.length === 0) {
    return "No ra11y-disable pragmas found in the scanned tree — nothing to audit.";
  }
  const bareCount = entries.filter((e) => e.reason === undefined).length;
  if (bareCount > 0) {
    return `${bareCount} pragma${bareCount === 1 ? "" : "s"} missing a reason — call review_candidates to get suppression/no-reason candidates for each bare pragma and draft reason text.`;
  }
  return "All suppressions have reason text — no action.";
}
