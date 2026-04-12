/**
 * The scan_project MCP tool. Lives in its own file so src/mcp/tools.ts
 * stays under the 500-line file budget — nothing here is meant to be
 * reused by other tools.
 */

import { filesChangedSince, stagedFiles } from "../utils/git.ts";
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
    const root = strParam(params, "cwd") ?? process.cwd();
    const projectConfig = await session.loadProjectConfig(root);
    const standards = resolveStandards(strParam(params, "standard"), session);
    const roots = resolveScanRoots(params, root);
    const t0 = performance.now();
    const files = await parseFiles(roots, session, root);
    const parseMs = ms(t0);
    if (files.length === 0) {
      logger.debug(`scan_project: 0 parseable files (${parseMs}ms discover)`);
      return textResult({
        pass: true,
        scannedRoot: root,
        plan: { totalFindings: 0, summary: "No parseable files found." },
        files: [],
        meta: { filesScanned: 0, scannedRoot: root, scanMode: describeMode(params) },
      });
    }
    const t1 = performance.now();
    const { formatted } = runScanAndFormat(
      files,
      session,
      standards,
      strParam(params, "minSeverity"),
      session.effectiveRules(projectConfig),
      session.effectiveNativeWrappers(projectConfig),
    );
    logger.debug(
      `scan_project: ${files.length} files, parse ${parseMs}ms + scan ${ms(t1)}ms = ${ms(t0)}ms`,
    );
    const nextStep = suggestNextStep(formatted.pass);
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
        nextStep,
      },
    });
  },
};

/**
 * Points agents at the next tool in the workflow. Static analysis is only
 * half of WCAG; a clean scan should nudge toward the manual-review path
 * rather than implying conformance.
 */
function suggestNextStep(pass: boolean): string {
  if (pass) {
    return "Automated checks clean. Call `coverage` to see how many WCAG criteria are inherently manual, then `checklist` for the evaluation prompts and candidate source locations.";
  }
  return "Use `explain_rule` on unclear findings, `suggest_fix` for a concrete patch, and `scan_file` to verify each file after editing.";
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
