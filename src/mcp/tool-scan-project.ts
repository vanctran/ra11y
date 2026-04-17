/**
 * The scan_project MCP tool. Lives in its own file so src/mcp/tools.ts
 * stays under the 500-line file budget — nothing here is meant to be
 * reused by other tools.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ParsedFile } from "../engine/scanner.ts";
import { filesChangedSince, gitRoot, stagedFiles } from "../utils/git.ts";
import { logger } from "../utils/logger.ts";
import { collectBuildArtifacts } from "./build-artifacts.ts";
import { classifyWrapperCandidates, collectWrapperCandidates } from "./detect-wrappers-core.ts";
import { buildNextStep } from "./next-step.ts";
import {
  errorResult,
  type McpTool,
  ms,
  parseExplicitPaths,
  parseFiles,
  resolveStandards,
  runScanAndFormat,
  type StructuredErrorCode,
  strArrayParam,
  strParam,
  textResult,
} from "./tools-helpers.ts";
import { warningsField, warningsFieldFromScanMeta } from "./warnings.ts";
import type { NativeWrapperSources } from "./wrappers-meta.ts";

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
    const cwdError = checkCwdExists(explicitCwd);
    if (cwdError) return cwdError;
    // When cwd isn't passed, prefer a host-declared root (MCP
    // `roots` capability) over the spawn directory's git root. The
    // host is the best arbiter of "what project is active right now"
    // — an agent-side IDE will have a declared root even when the
    // server was spawned elsewhere. Fall through to git-root, then
    // process.cwd() for non-root, non-git scans.
    const spawnCwd = process.cwd();
    const hostRoot = explicitCwd === undefined ? session.firstRootPath() : null;
    const root = explicitCwd ?? hostRoot ?? gitRoot(spawnCwd) ?? spawnCwd;
    const autoPromoted = explicitCwd === undefined && root !== spawnCwd;
    const rootSource = resolveRootSource({ explicitCwd, hostRoot, root, spawnCwd });
    const projectConfig = await session.loadProjectConfig(root);
    const configHint = buildConfigHint(projectConfig.sourcePath, explicitCwd, root, autoPromoted);
    const standards = resolveStandards(strParam(params, "standard"), session);
    const scanScope = resolveScanScope(params, root);
    if (scanScope.kind === "error") return scopeErrorToResult(scanScope);
    const { roots, mode: actualMode, fallbackReason } = scanScope;
    const t0 = performance.now();
    const baseFiles = await parseFiles(roots, session, root);
    const additionalPaths = strArrayParam(params, "additionalPaths") ?? [];
    const additionalFiles =
      additionalPaths.length > 0 ? await parseExplicitPaths(additionalPaths, session, root) : [];
    const files = mergeFilesByPath(baseFiles, additionalFiles);
    const parseMs = ms(t0);
    if (files.length === 0) {
      logger.debug(`scan_project: 0 parseable files (${parseMs}ms discover)`);
      return buildEmptyFilesResult({
        root,
        actualMode,
        fallbackReason,
        rootSource,
        configSource: projectConfig.sourcePath,
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
    const classified = classifyIfAutoDetect(autoDetect, files, detectedNames);
    const t1 = performance.now();
    const { formatted } = await runScanAndFormat(
      files,
      session,
      standards,
      strParam(params, "minSeverity"),
      session.effectiveRules(projectConfig),
      buildWrapperSources(projectConfig.nativeWrappers, session.config.nativeWrappers, classified),
      root,
      params["verboseMeta"] === true,
    );
    logger.debug(
      `scan_project: ${files.length} files, parse ${parseMs}ms + scan ${ms(t1)}ms = ${ms(t0)}ms`,
    );
    const nextStep = buildNextStep(formatted, {
      iterativeTip:
        actualMode === "full"
          ? ' For iterative work on a branch, pass `since: "HEAD~1"` or `changedOnly: true` to scan only diffs.'
          : "",
    });
    const nextStepStructuredField = structuredField(nextStep);
    // Deterministic compiled-CSS / bundler-output label. Findings on
    // these files STILL appear in `formatted.files` — this is additive
    // information so an agent knows to investigate whether a given
    // finding sits on generated code before editing. Per CLAUDE.md §1
    // "Ambiguous field shapes are dishonest," the field is omitted
    // entirely when the detector finds no artifacts (never `[]`).
    const buildArtifacts = buildArtifactsFields(files);
    return textResult({
      ...formatted,
      ...warningsFieldFromScanMeta({
        meta: formatted.meta,
        rootSource,
        configSource: projectConfig.sourcePath,
        scannedBuildArtifactsPresent: buildArtifacts.present,
      }),
      meta: {
        ...formatted.meta,
        scannedRoot: root,
        scanMode: actualMode,
        ...(fallbackReason === undefined ? {} : { fallbackReason }),
        rootSource,
        ...buildRootsOverlapMeta({ explicitCwd, hostRoot, root, session }),
        configSource: projectConfig.sourcePath,
        configSearchedFrom: root,
        ...buildArtifacts.metaField,
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
        nextStep: nextStep.prose,
        ...nextStepStructuredField,
      },
    });
  },
};

/**
 * One-hop AST probe (P1-F): when autoDetect is on, split detected
 * names into `confirmed` (defining file's JSX root is a native
 * interactive element) vs `assumed` (can't confirm). Only confirmed
 * names reach the effective native-wrapper allowlist and silence
 * findings; assumed names stay opaque so the scanner treats the
 * component like any other unresolved PascalCase element. Extracted
 * so the handler stays under Biome's cognitive-complexity cap.
 */
function classifyIfAutoDetect(
  autoDetect: boolean,
  files: readonly ParsedFile[],
  detectedNames: readonly string[],
): { readonly confirmed: readonly string[]; readonly assumed: readonly string[] } {
  if (!autoDetect) return { confirmed: [], assumed: [] };
  return classifyWrapperCandidates(files, detectedNames);
}

/**
 * Builds the `NativeWrapperSources` payload handed to
 * `runScanAndFormat`. `fromAutoDetect` rides its own channel — the
 * session-override audit (sessionNativeWrappers) must not
 * mis-attribute scan-scoped auto-detected names to a stale
 * configure() call. Confirmed vs assumed split carries through to
 * `activeNativeWrappersBySource.fromAutoDetect`. The field is
 * omitted entirely when autoDetect produced no candidates, so the
 * shape never ships an empty `{confirmed: [], assumed: []}`.
 */
function buildWrapperSources(
  fromFile: readonly string[],
  fromSession: readonly string[],
  classified: { readonly confirmed: readonly string[]; readonly assumed: readonly string[] },
): NativeWrapperSources {
  const autoDetectHasAny = classified.confirmed.length > 0 || classified.assumed.length > 0;
  return {
    fromFile,
    fromSession,
    ...(autoDetectHasAny ? { fromAutoDetect: classified } : {}),
  };
}

/**
 * Names the reason this scan picked `root`. Surfaces as `rootSource`
 * in `meta` so agents can tell whether they're scanning what the host
 * expected — `explicit` / `host-root` / `git` / `spawn-cwd` — without
 * reading server logs.
 */
function resolveRootSource(args: {
  explicitCwd: string | undefined;
  hostRoot: string | null;
  root: string;
  spawnCwd: string;
}): "explicit" | "host-root" | "git" | "spawn-cwd" {
  if (args.explicitCwd !== undefined) return "explicit";
  if (args.hostRoot !== null && args.root === args.hostRoot) return "host-root";
  if (args.root !== args.spawnCwd) return "git";
  return "spawn-cwd";
}

/**
 * Surface overlap when the caller *and* the host both had an opinion
 * about the scan scope. Explicit cwd wins (see precedence in the
 * handler), but we note that the host's first root differs so the
 * agent can decide whether to flip to the host's preference next call.
 */
interface RootsOverlapArgs {
  explicitCwd: string | undefined;
  hostRoot: string | null;
  root: string;
  session: import("./session.ts").McpSession;
}

function buildRootsOverlapMeta(args: RootsOverlapArgs): Record<string, unknown> {
  const { explicitCwd, root, session } = args;
  const roots = session.roots;
  if (roots.length === 0) return {};
  const firstPath = session.firstRootPath();
  if (explicitCwd !== undefined && firstPath !== null && explicitCwd !== firstPath) {
    return {
      hostDeclaredRoots: roots.map((r) => r.uri),
      rootsOverlapNote: `Host declared ${roots.length} root(s); explicit cwd \`${explicitCwd}\` overrides. First host root is \`${firstPath}\`. Scanning \`${root}\`.`,
    };
  }
  return { hostDeclaredRoots: roots.map((r) => r.uri) };
}

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
          : `autoDetectWrappers registered ${detectedNames.length} component(s) for this scan only. For durable registration, add them to \`nativeWrappers\` in ra11y.config.ts — if the file does not exist, create it with:\n\n  import { defineConfig } from "@ra11y/core";\n\n  export default defineConfig({\n    nativeWrappers: [${detectedNames.map((n) => `"${n}"`).join(", ")}],\n  });\n\nRemove any that actually render a <div>/<span> internally — those are real bugs.`,
    };
  }
  if (configMissing && detectedNames.length > 0) {
    const nameList = detectedNames.map((n) => `"${n}"`).join(", ");
    return {
      suggestedNativeWrappers: detectedNames,
      suggestedNativeWrappersNote: `No ra11y.config.ts was found, but the detector spotted ${detectedNames.length} PascalCase component(s) with onClick that look like native-element wrappers. To use them for this scan, re-call scan_project with \`autoDetectWrappers: true\`. To make it durable, create \`ra11y.config.ts\` at the project root with:\n\n  import { defineConfig } from "@ra11y/core";\n\n  export default defineConfig({\n    nativeWrappers: [${nameList}],\n  });\n\nNot yet registered for this scan.`,
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

// Next-step prose is built by the shared `buildNextStep` helper
// (`src/mcp/next-step.ts`) so scan_project and scan_file stay in
// lockstep. A prior in-file implementation drifted from scan_file's
// shape; the extraction is deliberate parity infrastructure, not a
// refactor for its own sake.

/**
 * The scan scope for a given `scan_project` invocation. Either the
 * (roots, mode) pair the scanner consumes — with an optional
 * `fallbackReason` when the requested mode couldn't execute and we
 * degraded to a full scan — or an `error` descriptor the handler
 * surfaces via `errorResult` before any scan work happens.
 *
 * The error variant exists for `changedOnly: true` inside a git repo
 * with zero staged files: the previous behavior silently fell back to
 * a full scan AND reported `scanMode: "changedOnly"`, which made
 * pre-commit / CI-on-diff workflows believe their diff gate was
 * working when it wasn't. Hard-erroring is the honest shape.
 *
 * The `full-fallback` variant covers `changedOnly: true` outside a git
 * repo — genuinely unavoidable, but we stop lying about what ran by
 * reporting `scanMode: "full-fallback"` + a named `fallbackReason`.
 */
type ScanScope =
  | {
      readonly kind: "scan";
      readonly roots: readonly string[];
      readonly mode: string;
      readonly fallbackReason?: string;
    }
  | {
      readonly kind: "error";
      readonly code: StructuredErrorCode;
      readonly message: string;
      readonly details: Record<string, unknown>;
      readonly remediation: string;
    };

/**
 * Decides which files to scan, and what to truthfully report as
 * `scanMode`, based on the git-aware params. Three branches:
 *
 *   - `changedOnly: true`:
 *       - not a git repo        → full-fallback (kept for compatibility
 *                                  with the pre-fix behavior, but now
 *                                  with a named fallbackReason).
 *       - repo, nothing staged  → error envelope `no_staged_files`.
 *       - repo, files staged    → scan those paths as `changedOnly`.
 *   - `since: "<ref>"`:
 *       - empty result          → full-fallback (fallbackReason names why).
 *       - any result            → scan those paths as `since:<ref>`.
 *   - neither flag              → full scan of `root`.
 */
function resolveScanScope(params: Record<string, unknown>, root: string): ScanScope {
  const changedOnly = (params as { changedOnly?: unknown }).changedOnly === true;
  const since = strParam(params, "since");
  if (changedOnly) {
    if (gitRoot(root) === null) {
      return {
        kind: "scan",
        roots: [root],
        mode: "full-fallback",
        fallbackReason: "not-a-git-repo",
      };
    }
    const files = stagedFiles(root);
    if (files.length === 0) {
      return {
        kind: "error",
        code: "no-staged-files",
        message:
          "changedOnly: true was set, but no files are staged in the git index — the scan would silently run against the full tree. Stage the files you want to scan, or omit changedOnly to request a full scan explicitly.",
        details: { gitRoot: gitRoot(root), cwd: root },
        remediation:
          "Stage files with `git add <path>` before calling with changedOnly: true; or drop changedOnly to run a full scan.",
      };
    }
    return { kind: "scan", roots: files, mode: "changedOnly" };
  }
  if (since !== undefined && since.length > 0) {
    if (gitRoot(root) === null) {
      return {
        kind: "scan",
        roots: [root],
        mode: "full-fallback",
        fallbackReason: "not-a-git-repo",
      };
    }
    const files = filesChangedSince(since, root);
    if (files.length === 0) {
      return {
        kind: "scan",
        roots: [root],
        mode: "full-fallback",
        fallbackReason: `no-files-changed-since:${since}`,
      };
    }
    return { kind: "scan", roots: files, mode: `since:${since}` };
  }
  return { kind: "scan", roots: [root], mode: "full" };
}

/**
 * Narrows a `ScanScope` error variant to the MCP `errorResult` shape.
 * Lives next to `resolveScanScope` so the error-surfacing path and the
 * scope-decision path stay together, and extracted as its own function
 * so the handler's cognitive complexity stays linear — the early-return
 * plus the `if (files.length === 0)` branch would otherwise tip it over
 * the lint threshold.
 */
function scopeErrorToResult(scope: Extract<ScanScope, { kind: "error" }>) {
  return errorResult({
    code: scope.code,
    message: scope.message,
    details: scope.details,
    remediation: scope.remediation,
  });
}

/**
 * Builds the zero-parseable-files response, with truthful scan-mode and
 * optional `fallbackReason` (when git-aware narrowing fell back to a
 * full scan that still parsed nothing). Extracted so the handler's
 * cognitive-complexity score stays under the lint cap.
 */
function buildEmptyFilesResult(args: {
  readonly root: string;
  readonly actualMode: string;
  readonly fallbackReason: string | undefined;
  readonly rootSource: "explicit" | "host-root" | "git" | "spawn-cwd";
  readonly configSource: string | null;
}) {
  const { root, actualMode, fallbackReason, rootSource, configSource } = args;
  return textResult({
    plan: { totalFindings: 0, summary: "No parseable files found." },
    files: [],
    meta: {
      filesScanned: 0,
      scannedRoot: root,
      scanMode: actualMode,
      ...(fallbackReason === undefined ? {} : { fallbackReason }),
    },
    ...warningsField({
      filesScanned: 0,
      rootSource,
      configSource,
      analysisCoverage: undefined,
      filesByExtension: undefined,
    }),
  });
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

/**
 * Hard-error envelope when the caller passed a `cwd` that doesn't
 * exist on disk. Without this, `parseFiles` returns 0 silently and
 * the response shape reads as a clean codebase — the silent-success
 * failure mode CLAUDE.md §1 warns against. Returns `null` when `cwd`
 * is undefined or exists; returns the error envelope otherwise.
 * Extracted from the handler to keep its cognitive complexity inside
 * the lint budget.
 */
function checkCwdExists(explicitCwd: string | undefined): ReturnType<typeof errorResult> | null {
  if (explicitCwd === undefined) return null;
  if (existsSync(explicitCwd)) return null;
  return errorResult({
    code: "cwd-not-found",
    message: `Requested cwd does not exist on disk: ${explicitCwd}`,
    details: { cwd: explicitCwd },
    remediation:
      "Pass `cwd` as a path to an existing directory. Relative paths resolve against the MCP server's spawn directory.",
  });
}

/**
 * Builds the spreadable build-artifacts field pair: a `metaField` to
 * mix into the response's `meta` block (omitted when no artifacts) and
 * a `present` boolean for `warningsFieldFromScanMeta`. Extracted from
 * the handler so the conditional spread doesn't add to its cognitive
 * complexity score.
 */
/**
 * Conditional-spread the structured form of `nextStep` — omitted when
 * the prose degrades to generic advice (no concrete first finding), per
 * CLAUDE.md §1 "Ambiguous field shapes are dishonest." Extracted so the
 * handler's cognitive complexity stays inside the lint budget.
 */
function structuredField(nextStep: { readonly structured?: unknown }): {
  readonly nextStepStructured?: unknown;
} {
  if (nextStep.structured === undefined) return {};
  return { nextStepStructured: nextStep.structured };
}

function buildArtifactsFields(files: readonly ParsedFile[]): {
  readonly present: boolean;
  readonly metaField: { readonly scannedBuildArtifacts?: readonly string[] };
} {
  const paths = collectBuildArtifacts(files);
  return {
    present: paths.length > 0,
    metaField: paths.length > 0 ? { scannedBuildArtifacts: paths } : {},
  };
}
