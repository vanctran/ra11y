/**
 * The `propose_baseline` MCP tool.
 *
 * Reads current scan findings and emits a *proposed* baseline — one
 * entry per violation, each tagged with a machine-readable `reason`
 * code that groups entries an agent can triage by category. The tool
 * is strictly read-only: it never writes `.ra11y-baseline.json`. The
 * agent reviews the proposal, decides which categories to
 * grandfather, then calls the mutating `baseline` tool (mode: "create")
 * to actually persist.
 *
 * Shape contract (AI-first doctrine, `docs/kb/architecture/ai-first-consumer.md`):
 *
 *   - `proposed: Array<{filePath, ruleId, findingId, reason, rationale}>`
 *     — one entry per current violation, deterministic. Each entry
 *     reuses the existing stable `findingId` so an agent can cross-
 *     reference against `scan_project` output without re-deriving it.
 *   - `counts: { wrapperUndetected, thirdPartyHtml, legacyRoute,
 *     designSystemInternal, unclassified }` — FIVE distinct headline
 *     counters, one per reason code. Per CLAUDE.md §1 "Composite
 *     headline counts are dishonest," we never sum them into a single
 *     `itemsProposed` number; the agent sizes per category.
 *   - `meta` carries the standard scan-confidence telemetry
 *     (`scannedRoot`, `configSource`, `rulesEvaluated`, `filesScanned`)
 *     so the agent can cross-check against `scan_project` without a
 *     second round-trip.
 *   - `nextStep` prose + `nextStepStructured: { tool: "baseline", args:
 *     { mode: "create" } }` routes the agent to the mutating call that
 *     actually writes the file.
 *
 * Reason-code heuristics, each deterministic from the scan:
 *
 *   - `wrapper-undetected` — the finding fires on a PascalCase
 *     component whose name appears in the auto-detect `assumed` list
 *     (the one-hop AST probe considered the candidate but could not
 *     confirm a native interactive root). These are the findings most
 *     likely to be design-system false-positives the agent should
 *     verify by reading the component source.
 *   - `third-party-html` — the finding's file path contains
 *     `/node_modules/`, `/vendor/`, or `/.yarn/`, or the basename
 *     matches `*.min.{html,js,css}`. Canonical "not our code"
 *     locations; safe to grandfather without reading.
 *   - `legacy-route` — the finding's file path (relative to
 *     `scannedRoot`) matches a caller-supplied `legacyRoutes` glob.
 *     NOT auto-classified — per CLAUDE.md §1 "No heuristic
 *     suppression," we never guess which routes are legacy from
 *     filename patterns; the caller declares them explicitly.
 *   - `design-system-internal` — the finding's file path matches a
 *     caller-supplied `designSystemPaths` glob. Same explicit-only
 *     contract as `legacy-route`.
 *   - `unclassified` — the default when no heuristic matches. This is
 *     the correct majority case: the agent reads the finding and
 *     decides whether to grandfather.
 *
 * Precedence (first match wins): legacy-route → design-system-internal
 * → third-party-html → wrapper-undetected → unclassified. User-declared
 * classifications beat path heuristics; deterministic path signals
 * beat component-name heuristics; fall through to unclassified.
 *
 * Doctrine invariants folded into the shape:
 *
 *   - Surface, don't suppress: every violation shows up in `proposed`,
 *     tagged with the reason code the agent uses to triage. No bucket
 *     is "suggested to skip"; no finding is dropped by the tool.
 *   - Composite headline counts are dishonest: five separate counters
 *     instead of one "itemsProposed" summary. Agents batch per
 *     category.
 *   - No heuristic suppression: `legacy-route` and
 *     `design-system-internal` require explicit input. We do NOT
 *     guess what's legacy by reading filenames — the caller is the
 *     authority.
 *   - Read-only: this tool never writes. The mutating surface is
 *     `baseline` (mode: "create").
 */

import { existsSync } from "node:fs";
import { runScan } from "../engine/scanner.ts";
import { BUILTIN_RULES } from "../rules/index.ts";
import { BUILTIN_STANDARDS } from "../standards/index.ts";
import { gitRoot } from "../utils/git.ts";
import { compileGlobs } from "../utils/glob.ts";
import { classifyWrapperCandidates, collectWrapperCandidates } from "./detect-wrappers-core.ts";
import {
  buildProposedEntries,
  buildProposedNextStep,
  tallyReasons,
} from "./propose-baseline-classify.ts";
import {
  applyRuleSettings,
  errorResult,
  type McpTool,
  parseFiles,
  resolveStandards,
  strArrayParam,
  strParam,
  textResult,
} from "./tools-helpers.ts";

export type { BaselineReason } from "./propose-baseline-classify.ts";

export const proposeBaselineTool: McpTool = {
  def: {
    name: "propose_baseline",
    description:
      'Read-only: propose a structured baseline from the current scan state without writing anything to disk. Each would-be baseline entry carries a machine-readable `reason` code (`wrapper-undetected` / `third-party-html` / `legacy-route` / `design-system-internal` / `unclassified`) plus a one-line rationale so the agent can triage by category before calling `baseline` with mode: "create" to actually persist. Five distinct headline counters (one per reason) — never summed into a single "itemsProposed" number. Deterministic; no LLM; identical findings in, identical proposal out.\n\nUse `legacyRoutes` / `designSystemPaths` to tag findings in paths you (the agent) already know are legacy / design-system internals — glob patterns are matched against paths relative to `scannedRoot`. Heuristic reason codes (`third-party-html`, `wrapper-undetected`) fire automatically from the scan state; per "no heuristic suppression" we deliberately do NOT guess which routes are legacy from filename alone.',
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description:
            "Project root. Defaults to the git root of the MCP server's spawn directory, then process.cwd(). Controls discovery of ra11y.config.ts and the relative-path basis used for `legacyRoutes` / `designSystemPaths` glob matching.",
        },
        legacyRoutes: {
          type: "array",
          items: { type: "string" },
          description:
            'Glob patterns (gitignore-style, `**` supported) naming file paths the caller has already identified as legacy routes — findings on matching files get `reason: "legacy-route"` so the agent can batch-grandfather them. Paths are matched relative to `scannedRoot`. Example: `["src/legacy/**", "app/old/**/*.html"]`. NOT auto-classified — per AI-first doctrine the caller is the authority on which routes are legacy.',
        },
        designSystemPaths: {
          type: "array",
          items: { type: "string" },
          description:
            'Glob patterns (gitignore-style, `**` supported) naming file paths the caller has already identified as design-system internals — findings on matching files get `reason: "design-system-internal"` so the agent can batch-grandfather them. Paths are matched relative to `scannedRoot`. Example: `["packages/ui/src/**"]`. NOT auto-classified — per AI-first doctrine the caller is the authority on which paths are design-system internals.',
        },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async handler(params, session) {
    const explicitCwd = strParam(params, "cwd");
    if (explicitCwd !== undefined && !existsSync(explicitCwd)) {
      return errorResult({
        code: "cwd-not-found",
        message: `Requested cwd does not exist on disk: ${explicitCwd}`,
        details: { cwd: explicitCwd },
        remediation:
          "Pass `cwd` as a path to an existing directory. Relative paths resolve against the MCP server's spawn directory.",
      });
    }
    const spawnCwd = process.cwd();
    const root = explicitCwd ?? gitRoot(spawnCwd) ?? spawnCwd;

    const legacyRoutes = strArrayParam(params, "legacyRoutes") ?? [];
    const designSystemPaths = strArrayParam(params, "designSystemPaths") ?? [];
    const legacyMatcher = compileGlobs(legacyRoutes);
    const designMatcher = compileGlobs(designSystemPaths);

    const projectConfig = await session.loadProjectConfig(root);
    const files = await parseFiles([root], session, root);
    const effective = session.effectiveRules(projectConfig);
    const activeRules = applyRuleSettings(BUILTIN_RULES, effective);
    const standards = resolveStandards(undefined, session);

    // Run the wrapper probe over the parsed file set to derive the
    // `assumed` names — components the one-hop AST probe considered
    // but could NOT confirm as native-element wrappers. These are the
    // candidates an agent should verify by reading the defining
    // source; a finding on a call site of an assumed name gets the
    // `wrapper-undetected` reason code so the agent can batch-review
    // them first.
    const candidates = collectWrapperCandidates(files);
    const { assumed } = classifyWrapperCandidates(
      files,
      candidates.map((c) => c.component),
    );
    const assumedSet = new Set(assumed);

    const { result } = runScan({
      standards: BUILTIN_STANDARDS,
      rules: activeRules,
      enabled: standards,
      files,
      level: session.config.level,
    });

    const proposed = buildProposedEntries({
      violations: result.violations,
      root,
      assumedWrappers: assumedSet,
      legacyMatcher,
      designMatcher,
    });

    const counts = tallyReasons(proposed);

    return textResult({
      proposed,
      counts,
      meta: {
        scannedRoot: root,
        configSource: projectConfig.sourcePath,
        filesScanned: files.length,
        rulesEvaluated: activeRules.length,
        standards: [...result.enabledStandards].sort(),
      },
      nextStep: buildProposedNextStep(proposed.length, counts),
      nextStepStructured: { tool: "baseline", args: { mode: "create" } },
    });
  },
};
