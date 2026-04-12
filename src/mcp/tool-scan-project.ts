/**
 * The scan_project MCP tool. Lives in its own file so src/mcp/tools.ts
 * stays under the 500-line file budget — nothing here is meant to be
 * reused by other tools.
 */

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
      "Scan the entire project from the repo root. Auto-discovers every HTML/CSS/JSX/TSX/Vue/Svelte file, respecting default ignores (node_modules, dist, test files). Use this for a complete compliance check instead of `scan` when you want to be sure nothing is missed. Returns the scanned root so you can verify coverage. Keep the default minSeverity: 'info' — info findings are things the tool flagged but couldn't verify alone (component wrappers, cross-file references); you should read the source to resolve them. Filtering them out upfront will miss real issues.",
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
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async handler(params, session) {
    const root = strParam(params, "cwd") ?? process.cwd();
    const projectConfig = await session.loadProjectConfig(root);
    const standards = resolveStandards(strParam(params, "standard"), session);
    const t0 = performance.now();
    const files = await parseFiles([root], session, root);
    const parseMs = ms(t0);
    if (files.length === 0) {
      logger.debug(`scan_project: 0 parseable files (${parseMs}ms discover)`);
      return textResult({
        pass: true,
        scannedRoot: root,
        plan: { totalFindings: 0, summary: "No parseable files found." },
        files: [],
        meta: { filesScanned: 0, scannedRoot: root },
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
    return textResult({
      ...formatted,
      scannedRoot: root,
      configSource: projectConfig.sourcePath,
      meta: { ...formatted.meta, scannedRoot: root, configSource: projectConfig.sourcePath },
    });
  },
};
