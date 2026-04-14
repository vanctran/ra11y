/**
 * The scan_project MCP tool. Lives in its own file so src/mcp/tools.ts
 * stays under the 500-line file budget — nothing here is meant to be
 * reused by other tools.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { filesChangedSince, gitRoot, stagedFiles } from "../utils/git.ts";
import { logger } from "../utils/logger.ts";
import {
  type McpTool,
  ms,
  parseFiles,
  resolveStandards,
  runScanAndFormat,
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
    const files = await parseFiles(roots, session, root);
    const parseMs = ms(t0);
    if (files.length === 0) {
      logger.debug(`scan_project: 0 parseable files (${parseMs}ms discover)`);
      return textResult({
        scannedRoot: root,
        plan: { totalFindings: 0, summary: "No parseable files found." },
        files: [],
        meta: { filesScanned: 0, scannedRoot: root, scanMode: describeMode(params) },
      });
    }
    const t1 = performance.now();
    const { formatted } = await runScanAndFormat(
      files,
      session,
      standards,
      strParam(params, "minSeverity"),
      session.effectiveRules(projectConfig),
      {
        fromFile: projectConfig.nativeWrappers,
        fromSession: session.config.nativeWrappers,
      },
      root,
    );
    logger.debug(
      `scan_project: ${files.length} files, parse ${parseMs}ms + scan ${ms(t1)}ms = ${ms(t0)}ms`,
    );
    const totalFindings =
      typeof formatted.plan["totalFindings"] === "number"
        ? (formatted.plan["totalFindings"] as number)
        : 0;
    const nextStep = suggestNextStep(totalFindings === 0, describeMode(params));
    return textResult({
      ...formatted,
      scannedRoot: root,
      configSource: projectConfig.sourcePath,
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
        nextStep,
      },
    });
  },
};

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
 * Points agents at the next tool in the workflow. Static analysis is only
 * half of WCAG; a clean scan should nudge toward the manual-review path
 * rather than implying conformance.
 */
function suggestNextStep(pass: boolean, mode: string): string {
  const iterativeTip =
    mode === "full"
      ? ' For iterative work on a branch, pass `since: "HEAD~1"` or `changedOnly: true` to scan only diffs.'
      : "";
  if (pass) {
    return `Automated checks clean. Call \`checklist\` for the manual-review half (criteria + grounded candidates).${iterativeTip} To gate commits on this, wire \`ra11y scan --changed\` into lint-staged or a pre-commit hook — it scans only git-staged files, so feedback is near-instant. Caveat: runtime checks (focus traps, live regions, ARIA state, post-render contrast) are out of scope here; pair with axe-core in Playwright/Vitest for the runtime half. Do not claim "a11y clean" from this result alone.`;
  }
  return `Use \`explain_rule\` on unclear findings, \`suggest_fix\` for a concrete patch, and \`scan_file\` to verify each file after editing.${iterativeTip}`;
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

function describeMode(params: Record<string, unknown>): string {
  if ((params as { changedOnly?: unknown }).changedOnly === true) return "changedOnly";
  const since = strParam(params, "since");
  if (since !== undefined && since.length > 0) return `since:${since}`;
  return "full";
}
