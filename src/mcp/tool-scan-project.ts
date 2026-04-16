/**
 * The scan_project MCP tool. Lives in its own file so src/mcp/tools.ts
 * stays under the 500-line file budget — nothing here is meant to be
 * reused by other tools.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { filesChangedSince, gitRoot, stagedFiles } from "../utils/git.ts";
import { logger } from "../utils/logger.ts";
import { collectWrapperCandidates } from "./detect-wrappers-core.ts";
import {
  type McpTool,
  ms,
  parseExplicitPaths,
  parseFiles,
  resolveStandards,
  runScanAndFormat,
  type ScanFormatted,
  strArrayParam,
  strParam,
  textResult,
} from "./tools-helpers.ts";

export const scanProjectTool: McpTool = {
  def: {
    name: "scan_project",
    description:
      "Scan the entire project from the repo root. Auto-discovers every HTML/CSS/JSX/TSX/Vue/Svelte file, respecting default ignores (node_modules, dist, test files) and the project's `.gitignore`. Use this for a complete compliance check instead of `scan` when you want to be sure nothing is missed. Returns the scanned root so you can verify coverage. Keep the default minSeverity: 'info' — info findings are things the tool flagged but couldn't verify alone (component wrappers, cross-file references); you should read the source to resolve them. Filtering them out upfront will miss real issues.\n\nAlways pass `cwd` set to your project root — the loader uses it to discover `ra11y.config.ts` and the project's `.gitignore`. Omitting `cwd` falls back to the MCP server's spawn directory, which usually isn't the project root; `meta.configSource` will be null in that case.\n\nFor a pre-commit or CI-on-diff workflow, narrow the scan with `changedOnly: true` (staged files only) or `since: 'main'` (files changed vs a ref, including uncommitted WIP).",
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description:
            "Root directory to scan. Defaults to the current working directory. Pass your repo root to scan every parseable file.",
        },
        standard: {
          type: "string",
          description: "Standard ID (e.g. wcag22). Defaults to session config.",
        },
        level: {
          type: "string",
          enum: ["A", "AA", "AAA"],
          description: "Conformance level. Defaults to session config.",
        },
        minSeverity: {
          type: "string",
          enum: ["error", "warning", "info"],
          description:
            "Minimum severity to include. Default 'info' is recommended — info findings are cases static analysis can't resolve but you can (by reading component source / cross-file references). Only raise to 'warning' for unattended CI gates.",
        },
        changedOnly: {
          type: "boolean",
          description:
            "Scan only files currently staged in git (pre-commit use case). Falls back to a full scan if cwd isn't a git repo.",
        },
        since: {
          type: "string",
          description:
            "Git ref (e.g. 'main', 'HEAD~1'). Scans only files that differ between the ref and HEAD, plus uncommitted WIP. Ideal for CI on a PR diff.",
        },
        verboseMeta: {
          type: "boolean",
          description:
            "When true, analysisCoverage expands its counts into the actual lists — `parseErrorFiles` (paths that failed to parse), `opaqueCustomComponentNames` (PascalCase tags not in nativeWrappers), and `rulesByExtension` (which rules ran against which file types). Off by default to keep responses terse; enable when triaging coverage gaps.",
        },
        autoDetectWrappers: {
          type: "boolean",
          description:
            "When true, run the `detect_native_wrappers` heuristic inline and register PascalCase-with-onClick components as nativeWrappers for this scan. Use on the first run of a codebase so the opaqueCustomComponents count is accurate without an onboarding round-trip. The detected list is surfaced in `meta.autoDetectedWrappers` — copy the names you confirm to your ra11y.config.ts for durable registration. Scope is scan-only; session and project config are unaffected.",
        },
        additionalPaths: {
          type: "array",
          items: { type: "string" },
          description:
            'Paths to scan in addition to the auto-discovered tree, with `.gitignore` and default build-dir skips (`dist`, `build`, `out`, `.next`, …) bypassed. Use to include post-compile CSS/HTML that Tailwind or the bundler produces — e.g. `["dist/assets"]` — so color-contrast and focus-visible rules have real styles to evaluate. User `exclude` patterns still apply. Relative paths resolve from `cwd`.',
        },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async handler(params, session) {
    const explicitCwd = strParam(params, "cwd");
    // When cwd isn't passed, prefer the git root over the MCP server's
    // spawn directory — that's almost always the project the user means.
    // Falls through to process.cwd() for non-git scans (tmp fixtures, etc.).
    const spawnCwd = process.cwd();
    const root = explicitCwd ?? gitRoot(spawnCwd) ?? spawnCwd;
    const autoPromoted = explicitCwd === undefined && root !== spawnCwd;
    const projectConfig = await session.loadProjectConfig(root);
    const configHint = buildConfigHint(projectConfig.sourcePath, explicitCwd, root, autoPromoted);
    const standards = resolveStandards(strParam(params, "standard"), session);
    const roots = resolveScanRoots(params, root);
    const t0 = performance.now();
    const baseFiles = await parseFiles(roots, session, root);
    const additionalPaths = strArrayParam(params, "additionalPaths") ?? [];
    const additionalFiles =
      additionalPaths.length > 0 ? await parseExplicitPaths(additionalPaths, session, root) : [];
    const files = mergeFilesByPath(baseFiles, additionalFiles);
    const parseMs = ms(t0);
    if (files.length === 0) {
      logger.debug(`scan_project: 0 parseable files (${parseMs}ms discover)`);
      return textResult({
        plan: { totalFindings: 0, summary: "No parseable files found." },
        files: [],
        meta: { filesScanned: 0, scannedRoot: root, scanMode: describeMode(params) },
      });
    }
    const autoDetect = params["autoDetectWrappers"] === true;
    // When config is missing, also run the detector so the agent can
    // see what `nativeWrappers` would cover for this codebase — silent
    // misses on onboarding were the most common field report. The
    // detector is O(parsed files) and runs on files we've already
    // parsed, so the extra cost is negligible. Registration is still
    // gated on autoDetect === true; suggestion-only when it's off.
    const configMissing = projectConfig.sourcePath === null;
    const shouldDetect = autoDetect || configMissing;
    const detected = shouldDetect ? collectWrapperCandidates(files) : [];
    const detectedNames = detected.map((c) => c.component);
    const t1 = performance.now();
    // Only hand detected names to the scanner when autoDetect is true —
    // suggestion-only mode (config missing, flag off) must not silently
    // register anything.
    const registeredWrappers = autoDetect ? detectedNames : [];
    const { formatted } = await runScanAndFormat(
      files,
      session,
      standards,
      strParam(params, "minSeverity"),
      session.effectiveRules(projectConfig),
      {
        fromFile: projectConfig.nativeWrappers,
        fromSession: session.config.nativeWrappers,
        // Auto-detected wrappers ride their own channel — the session-
        // override audit (sessionNativeWrappers) must not mis-attribute
        // them to a stale configure() call. Still scan-scoped: never
        // written to session or project config.
        ...(registeredWrappers.length > 0 ? { fromAutoDetect: registeredWrappers } : {}),
      },
      root,
      params["verboseMeta"] === true,
    );
    logger.debug(
      `scan_project: ${files.length} files, parse ${parseMs}ms + scan ${ms(t1)}ms = ${ms(t0)}ms`,
    );
    const nextStep = suggestNextStep(formatted, describeMode(params));
    return textResult({
      ...formatted,
      meta: {
        ...formatted.meta,
        scannedRoot: root,
        scanMode: describeMode(params),
        configSource: projectConfig.sourcePath,
        configSearchedFrom: root,
        ...(projectConfig.sourcePath === null
          ? {
              configNote: `No ra11y.config found at ${root} — using built-in defaults (no nativeWrappers, no per-rule overrides). Drop a ra11y.config.ts at the project root to register design-system wrappers and customize severities.`,
            }
          : {}),
        ...(configHint === null ? {} : { configHint }),
        ...buildWrapperMeta({ autoDetect, configMissing, detectedNames }),
        ...(additionalPaths.length > 0
          ? {
              additionalPathsScanned: {
                paths: additionalPaths,
                filesAdded: files.length - baseFiles.length,
                note: "These paths bypassed `.gitignore` and the default build-dir skips. User `exclude` patterns still applied.",
              },
            }
          : {}),
        nextStep,
      },
    });
  },
};

/**
 * Builds the wrapper-related meta fields. Two distinct shapes:
 *   - `autoDetectedWrappers` + note: registered for this scan (flag on).
 *   - `suggestedNativeWrappers` + note: onboarding hint only (config
 *     missing, flag off) — NOT registered. The agent retries with
 *     `autoDetectWrappers: true` or writes a config.
 * Empty object when neither applies.
 */
function buildWrapperMeta(args: {
  autoDetect: boolean;
  configMissing: boolean;
  detectedNames: readonly string[];
}): Record<string, unknown> {
  const { autoDetect, configMissing, detectedNames } = args;
  if (autoDetect) {
    return {
      autoDetectedWrappers: detectedNames,
      autoDetectedWrappersNote:
        detectedNames.length === 0
          ? "autoDetectWrappers ran but found no PascalCase components with onClick to register."
          : `autoDetectWrappers registered ${detectedNames.length} component(s) for this scan only. Copy the names you confirm to \`nativeWrappers\` in ra11y.config.ts for durable registration; remove any that actually render a <div>/<span> internally — those are real bugs.`,
    };
  }
  if (configMissing && detectedNames.length > 0) {
    return {
      suggestedNativeWrappers: detectedNames,
      suggestedNativeWrappersNote: `No ra11y.config.ts was found, but the detector spotted ${detectedNames.length} PascalCase component(s) with onClick that look like native-element wrappers. To use them for this scan, re-call scan_project with \`autoDetectWrappers: true\`. To make it durable, add them to \`nativeWrappers\` in a ra11y.config.ts at the project root. Not yet registered for this scan.`,
    };
  }
  return {};
}

/**
 * When config discovery failed AND the caller didn't pass `cwd` explicitly,
 * warn that the server's spawn directory is almost certainly the wrong
 * place to look. If a ra11y.config.* file is reachable by walking up the
 * filesystem from the spawn dir (past the .git barrier that stops the
 * loader), name its exact path so agents can retry with the right cwd in
 * one step instead of spelunking.
 */
function buildConfigHint(
  sourcePath: string | null,
  explicitCwd: string | undefined,
  resolvedCwd: string,
  autoPromoted: boolean,
): string | null {
  if (sourcePath !== null) return null;
  // Only surface the hint when there's something actionable the agent
  // can do about it. A project that genuinely has no ra11y.config and
  // is scanned with the correct cwd needs no repeated warning — the
  // hint must earn its place in every response, not be wallpaper.
  const nearby = findNearbyConfig(resolvedCwd);
  if (nearby !== null) {
    return `No ra11y.config found walking up from ${resolvedCwd}${explicitCwd === undefined ? " (the MCP server's spawn directory)" : ""}. A config exists at ${nearby} — retry with \`cwd: "${dirname(nearby)}"\` to load it.`;
  }
  // No nearby config and caller was explicit about cwd: they're
  // running on defaults intentionally. Silent.
  if (explicitCwd !== undefined) return null;
  // No explicit cwd, no config, no nearby candidate — warn that the
  // spawn directory probably isn't the project root.
  if (!autoPromoted) {
    return `No ra11y.config was found walking up from ${resolvedCwd} (the MCP server's spawn directory). If your project root is elsewhere, pass \`cwd\` pointing at it — the loader will then find both the config and the project's .gitignore.`;
  }
  return null;
}

const CONFIG_FILENAMES = [
  "ra11y.config.ts",
  "ra11y.config.js",
  "ra11y.config.mjs",
  "ra11y.config.json",
] as const;

const MAX_ANCESTORS_TO_SEARCH = 6;

/**
 * Searches ancestor directories (past .git, which the normal loader
 * stops at) for a ra11y.config.* file. Bounded to a few levels so we
 * don't crawl the entire filesystem on every scan.
 */
function findNearbyConfig(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < MAX_ANCESTORS_TO_SEARCH; i += 1) {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = join(dir, filename);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * Points agents at the next tool in the workflow. Static analysis is
 * only half of WCAG; a clean scan should nudge toward manual review
 * rather than implying conformance. When findings or actionable manual
 * items exist, the guidance is directive — names a specific tool and
 * the first file:line worth calling it on — so the agent doesn't have
 * to parse the response twice to figure out where to start.
 */
interface NextStepInputs {
  readonly violations: number;
  readonly fixable: number;
  readonly actionableManual: number;
  readonly notes: number;
  readonly first: FirstFinding | null;
  readonly iterativeTip: string;
}

function suggestNextStep(formatted: ScanFormatted, mode: string): string {
  const inputs: NextStepInputs = {
    violations: numFromPlan(formatted.plan, "violations"),
    fixable: numFromPlan(formatted.plan, "fixSuggestionAvailable"),
    actionableManual: numFromPlan(formatted.plan, "actionableManualItems"),
    notes: numFromPlan(formatted.plan, "notes"),
    first: firstCallableFinding(formatted.files),
    iterativeTip:
      mode === "full"
        ? ' For iterative work on a branch, pass `since: "HEAD~1"` or `changedOnly: true` to scan only diffs.'
        : "",
  };
  if (inputs.violations === 0 && inputs.notes === 0) return cleanScanNextStep(inputs);
  if (inputs.violations > 0 && inputs.first !== null)
    return violationNextStep(inputs, inputs.first);
  if (inputs.notes > 0 && inputs.first !== null) return notesNextStep(inputs, inputs.first);
  return `Use \`explain_rule\` on unclear findings, \`suggest_fix\` for a concrete patch, and \`scan_file\` to verify each file after editing.${inputs.iterativeTip}`;
}

function cleanScanNextStep(inputs: NextStepInputs): string {
  if (inputs.actionableManual > 0) {
    const pl = inputs.actionableManual === 1 ? "on has" : "a have";
    return `Automated checks clean; ${inputs.actionableManual} manual-review criteri${pl} grounded candidates. Call \`checklist\` next.${inputs.iterativeTip}`;
  }
  return `Automated checks clean. Call \`checklist\` for the manual-review half (criteria + grounded candidates).${inputs.iterativeTip} Pair with axe-core in Playwright/Vitest for runtime checks (focus traps, live regions, ARIA state, post-render contrast); do not claim "a11y clean" from this result alone.`;
}

function violationNextStep(inputs: NextStepInputs, first: FirstFinding): string {
  const vPlural = inputs.violations === 1 ? "" : "s";
  if (inputs.fixable > 0) {
    const fPlural = inputs.fixable === 1 ? "" : "s";
    return `${inputs.violations} violation${vPlural} (${inputs.fixable} with fix suggestion${fPlural}). Start with \`suggest_fix\` on ${first.path}:${first.line} (rule \`${first.ruleId}\`).${manualTail(inputs)}${inputs.iterativeTip}`;
  }
  return `${inputs.violations} violation${vPlural} with no machine-generated fix. Call \`explain_rule\` on \`${first.ruleId}\` and apply manually; verify with \`scan_file ${first.path}\` after editing.${inputs.iterativeTip}`;
}

function notesNextStep(inputs: NextStepInputs, first: FirstFinding): string {
  const nPlural = inputs.notes === 1 ? "" : "s";
  return `No errors/warnings, ${inputs.notes} info-level note${nPlural} (scanner flagged things it can't fully verify). Open \`scan_file ${first.path}\` or read the source to resolve.${manualTail(inputs)}${inputs.iterativeTip}`;
}

function manualTail(inputs: NextStepInputs): string {
  if (inputs.actionableManual <= 0) return "";
  const plural = inputs.actionableManual === 1 ? "" : "s";
  return ` Then \`checklist\` for the ${inputs.actionableManual} grounded manual-review item${plural}.`;
}

function numFromPlan(plan: Record<string, unknown>, key: string): number {
  const raw = plan[key];
  return typeof raw === "number" ? raw : 0;
}

interface FirstFinding {
  readonly path: string;
  readonly line: number;
  readonly ruleId: string;
}

/**
 * Pulls the first finding's (file, line, ruleId) from the sorted
 * `files` entries so the next-step hint can name a concrete call site.
 * Falls back to null when the response has no findings or the shape
 * doesn't expose the fields we want — the caller degrades to generic
 * text in that case.
 */
function firstCallableFinding(
  files: readonly { readonly path: string; readonly findings: unknown[] }[],
): FirstFinding | null {
  for (const file of files) {
    for (const raw of file.findings) {
      const extracted = readFindingRuleIdAndLine(raw);
      if (extracted !== null) return { path: file.path, ...extracted };
    }
  }
  return null;
}

function readFindingRuleIdAndLine(
  raw: unknown,
): { readonly ruleId: string; readonly line: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const ruleId = f["ruleId"];
  const line = f["line"];
  if (typeof ruleId !== "string" || typeof line !== "number") return null;
  return { ruleId, line };
}

/**
 * Resolves which files to scan based on the optional git-aware params.
 * Falls back to the full tree if the git helper returns nothing (not a
 * repo, nothing staged, or unknown ref).
 */
function resolveScanRoots(params: Record<string, unknown>, root: string): readonly string[] {
  const changedOnly = (params as { changedOnly?: unknown }).changedOnly === true;
  const since = strParam(params, "since");
  if (changedOnly) {
    const files = stagedFiles(root);
    return files.length > 0 ? files : [root];
  }
  if (since !== undefined && since.length > 0) {
    const files = filesChangedSince(since, root);
    return files.length > 0 ? files : [root];
  }
  return [root];
}

/**
 * De-dupes a second batch of parsed files against the first by
 * filePath. `additionalPaths` is meant for targets that wouldn't
 * otherwise be scanned, but a caller can overlap them with the main
 * tree — in that case the original parsed file wins.
 */
function mergeFilesByPath<T extends { readonly filePath: string }>(
  primary: readonly T[],
  secondary: readonly T[],
): readonly T[] {
  if (secondary.length === 0) return primary;
  const seen = new Set(primary.map((f) => f.filePath));
  const extras = secondary.filter((f) => !seen.has(f.filePath));
  if (extras.length === 0) return primary;
  return [...primary, ...extras];
}

function describeMode(params: Record<string, unknown>): string {
  if ((params as { changedOnly?: unknown }).changedOnly === true) return "changedOnly";
  const since = strParam(params, "since");
  if (since !== undefined && since.length > 0) return `since:${since}`;
  return "full";
}
