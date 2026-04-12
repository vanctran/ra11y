/**
 * MCP tool definitions — name, description, inputSchema, handler.
 *
 * 8 tools:
 *   scan, scan_file, explain_rule, suggest_fix,
 *   coverage, checklist, list_rules, configure
 *
 * Every handler is a pure function over the scanner's output + session state.
 * No MCP-specific logic leaks into src/engine/.
 */

import { runScan } from "../engine/scanner.ts";
import { buildCoverageReport } from "../reports/coverage.ts";
import { BUILTIN_CANDIDATE_FINDERS } from "../review/index.ts";
import { BUILTIN_RULES } from "../rules/index.ts";
import { BUILTIN_STANDARDS } from "../standards/index.ts";
import {
  applyRuleSettings,
  buildConfigureOpts,
  buildSourceContext,
  errorResult,
  filterBySeverity,
  findRule,
  findStandard,
  formatFinding,
  type McpTool,
  numParam,
  parseFiles,
  resolveLevel,
  resolveStandards,
  runScanAndFormat,
  strArrayParam,
  strParam,
  textResult,
} from "./tools-helpers.ts";

export type { McpTool, McpToolDef, McpToolResult } from "./tools-helpers.ts";

// ─── Tool: scan ─────────────────────────────────────────────────────────────

const scanTool: McpTool = {
  def: {
    name: "scan",
    description:
      "Scan files or directories for accessibility violations. Returns findings grouped by file with fix suggestions. Start here to find issues. Keep the default minSeverity: 'info' — info findings are high-value signals the tool can't verify alone (PascalCase component wrappers, cross-file CSS/JSX, etc.) and are exactly what you can resolve by reading the code.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "File or directory paths to scan.",
        },
        standard: {
          type: "string",
          description: "Standard ID (e.g. wcag22, wcag21). Defaults to session config.",
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
            "Minimum severity to include. Default is 'info' and you should keep it — info findings are low-confidence cases where static analysis can't resolve a component boundary or cross-file reference, but you CAN by reading the source. Skipping them ships false negatives on real issues. Only raise to 'warning' for CI gates where no human is in the loop.",
        },
        cwd: {
          type: "string",
          description:
            "Base directory for resolving relative paths. Pass your current working directory (e.g. a git worktree) to avoid picking up the server's spawn-time cwd.",
        },
      },
      required: ["paths"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async handler(params, session) {
    const paths = strArrayParam(params, "paths");
    if (!paths || paths.length === 0) {
      return errorResult("paths must be a non-empty array of file or directory paths.");
    }

    const standards = resolveStandards(strParam(params, "standard"), session);
    const files = await parseFiles(paths, session, strParam(params, "cwd"));
    if (files.length === 0) {
      return textResult({
        pass: true,
        plan: { totalFindings: 0, summary: "No parseable files found." },
        files: [],
        meta: { filesScanned: 0, scannedPaths: paths },
      });
    }

    const { formatted } = runScanAndFormat(
      files,
      session,
      standards,
      strParam(params, "minSeverity"),
    );

    return textResult({
      ...formatted,
      meta: { ...formatted.meta, scannedPaths: paths },
    });
  },
};

// ─── Tool: scan_project ─────────────────────────────────────────────────────

const scanProjectTool: McpTool = {
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
    const standards = resolveStandards(strParam(params, "standard"), session);
    const files = await parseFiles([root], session, root);

    if (files.length === 0) {
      return textResult({
        pass: true,
        scannedRoot: root,
        plan: { totalFindings: 0, summary: "No parseable files found." },
        files: [],
        meta: { filesScanned: 0, scannedRoot: root },
      });
    }

    const { formatted } = runScanAndFormat(
      files,
      session,
      standards,
      strParam(params, "minSeverity"),
    );

    return textResult({
      ...formatted,
      scannedRoot: root,
      meta: { ...formatted.meta, scannedRoot: root },
    });
  },
};

// ─── Tool: scan_file ────────────────────────────────────────────────────────

const scanFileTool: McpTool = {
  def: {
    name: "scan_file",
    description:
      "Scan a single file for accessibility violations. Fast with cached ASTs — use for the fix-verify loop after editing a file.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to scan." },
        standard: { type: "string", description: "Standard ID. Defaults to session config." },
        level: { type: "string", enum: ["A", "AA", "AAA"], description: "Conformance level." },
        minSeverity: {
          type: "string",
          enum: ["error", "warning", "info"],
          description:
            "Minimum severity to include. Default 'info' is recommended — info findings are cases static analysis can't resolve but you can (by reading component source / cross-file references). Only raise to 'warning' for unattended CI gates.",
        },
        cwd: {
          type: "string",
          description: "Base directory for resolving the path if it is relative.",
        },
      },
      required: ["path"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async handler(params, session) {
    const filePath = strParam(params, "path");
    if (!filePath || filePath.length === 0) {
      return errorResult("path must be a non-empty string.");
    }

    const parsed = await session.parseFile(filePath, strParam(params, "cwd"));
    if (!parsed) {
      return errorResult(`Unsupported or unreadable file: ${filePath}`);
    }

    const standards = resolveStandards(strParam(params, "standard"), session);
    const { result, report } = runScan({
      standards: BUILTIN_STANDARDS,
      rules: applyRuleSettings(BUILTIN_RULES, session.config.rules),
      enabled: standards,
      files: [parsed],
      finders: BUILTIN_CANDIDATE_FINDERS,
    });

    const filtered = filterBySeverity(result.violations, strParam(params, "minSeverity"));

    return textResult({
      findings: filtered.map(formatFinding),
      reviewCandidates: (report.candidates ?? []).map((c) => ({
        criterionId: c.criterionId,
        line: c.location.line,
        reason: c.reason,
        snippet: c.snippet,
      })),
    });
  },
};

// ─── Tool: explain_rule ─────────────────────────────────────────────────────

const explainRuleTool: McpTool = {
  def: {
    name: "explain_rule",
    description:
      "Get full details for a rule — description, rationale, normative WCAG quote, good/bad examples, and spec references. Use when a finding needs context.",
    inputSchema: {
      type: "object",
      properties: {
        ruleId: { type: "string", description: "Rule ID (e.g. contrast/minimum)." },
      },
      required: ["ruleId"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  handler(params) {
    const ruleId = strParam(params, "ruleId");
    if (!ruleId) {
      return errorResult("ruleId is required.");
    }
    const rule = findRule(ruleId);
    if (!rule) {
      return errorResult(`Rule '${ruleId}' not found. Use list_rules to see available rules.`);
    }

    return textResult({
      id: rule.id,
      severity: rule.severity,
      satisfies: [...rule.satisfies],
      description: rule.docs.description,
      rationale: rule.docs.rationale,
      normativeQuote: rule.docs.normativeQuote ?? null,
      goodExample: rule.docs.goodExample,
      badExample: rule.docs.badExample,
      references: [...rule.docs.references],
    });
  },
};

// ─── Tool: suggest_fix ──────────────────────────────────────────────────────

const suggestFixTool: McpTool = {
  def: {
    name: "suggest_fix",
    description:
      "Get a concrete search-and-replace fix for a violation. Provide the source context around the issue. Returns oldText/newText for a direct edit.",
    inputSchema: {
      type: "object",
      properties: {
        ruleId: { type: "string", description: "Rule ID of the violation." },
        file: { type: "string", description: "File path containing the violation." },
        line: { type: "number", description: "Line number of the violation." },
        sourceContext: {
          type: "string",
          description: "Source code around the violation (±3 lines). If omitted, read from file.",
        },
        cwd: {
          type: "string",
          description: "Base directory for resolving the file path if relative.",
        },
      },
      required: ["ruleId", "file", "line"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async handler(params, session) {
    const ruleId = strParam(params, "ruleId");
    const filePath = strParam(params, "file");
    const line = numParam(params, "line");

    if (!(ruleId && filePath) || line === undefined) {
      return errorResult("ruleId, file, and line are required.");
    }

    if (!findRule(ruleId)) {
      return errorResult(`Rule '${ruleId}' not found.`);
    }

    // Parse the file to find the specific violation and its suggestion.
    const parsed = await session.parseFile(filePath, strParam(params, "cwd"));
    if (!parsed) {
      return errorResult(`Unsupported or unreadable file: ${filePath}`);
    }

    const standards = resolveStandards(undefined, session);
    const { result } = runScan({
      standards: BUILTIN_STANDARDS,
      rules: applyRuleSettings(BUILTIN_RULES, session.config.rules),
      enabled: standards,
      files: [parsed],
    });

    // Find the matching violation.
    const match = result.violations.find((v) => v.ruleId === ruleId && v.location.line === line);

    const sourceContext =
      strParam(params, "sourceContext") ?? buildSourceContext(parsed.source, line);

    if (!match?.suggestion) {
      return textResult({
        oldText: "",
        newText: "",
        explanation: match
          ? `Violation found but no auto-fix available for ${ruleId}. ${match.message}`
          : `No violation for ${ruleId} at line ${line}.`,
        confidence: "low",
      });
    }

    return textResult({
      oldText: match.snippet ?? "",
      newText: "",
      explanation: match.suggestion,
      confidence: match.severity === "error" ? "high" : "medium",
      sourceContext,
    });
  },
};

// ─── Tool: coverage ─────────────────────────────────────────────────────────

const coverageTool: McpTool = {
  def: {
    name: "coverage",
    description:
      "Check overall compliance coverage — passing/failing/manual counts per standard. Use after fixing violations to see if you're done.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "File or directory paths to scan.",
        },
        standard: { type: "string", description: "Standard ID." },
        level: { type: "string", enum: ["A", "AA", "AAA"], description: "Conformance level." },
        cwd: {
          type: "string",
          description: "Base directory for resolving relative paths.",
        },
      },
      required: ["paths"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async handler(params, session) {
    const paths = strArrayParam(params, "paths");
    if (!paths || paths.length === 0) {
      return errorResult("paths must be a non-empty array.");
    }

    const standards = resolveStandards(strParam(params, "standard"), session);
    const level = resolveLevel(strParam(params, "level"), session);
    const files = await parseFiles(paths, session, strParam(params, "cwd"));

    const { result } = runScan({
      standards: BUILTIN_STANDARDS,
      rules: applyRuleSettings(BUILTIN_RULES, session.config.rules),
      enabled: standards,
      files,
    });

    const coverage = buildCoverageReport(result, BUILTIN_STANDARDS, level);
    const entries = coverage.map((c) => ({
      standardId: c.standardId,
      score: c.automatedPassRate,
      criteriaTotal: c.total,
      criteriaCovered: c.automatable,
      criteriaPassing: c.passing,
      gaps: c.failingCriteria,
      manualReview: c.manualCriteria,
    }));

    return textResult(entries.length === 1 ? entries[0] : entries);
  },
};

// ─── Tool: checklist ────────────────────────────────────────────────────────

const checklistTool: McpTool = {
  def: {
    name: "checklist",
    description:
      "Get the manual review checklist — criteria that can't be fully automated. Includes evaluation prompts and candidate source locations.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "File or directory paths to scan.",
        },
        standard: { type: "string", description: "Standard ID." },
        level: { type: "string", enum: ["A", "AA", "AAA"], description: "Conformance level." },
        cwd: {
          type: "string",
          description: "Base directory for resolving relative paths.",
        },
      },
      required: ["paths"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async handler(params, session) {
    const paths = strArrayParam(params, "paths");
    if (!paths || paths.length === 0) {
      return errorResult("paths must be a non-empty array.");
    }

    const standards = resolveStandards(strParam(params, "standard"), session);
    const level = resolveLevel(strParam(params, "level"), session);
    const files = await parseFiles(paths, session, strParam(params, "cwd"));

    const { result, report } = runScan({
      standards: BUILTIN_STANDARDS,
      rules: applyRuleSettings(BUILTIN_RULES, session.config.rules),
      enabled: standards,
      files,
      finders: BUILTIN_CANDIDATE_FINDERS,
    });

    const coverage = buildCoverageReport(result, BUILTIN_STANDARDS, level);

    const items: Record<string, unknown>[] = [];
    for (const entry of coverage) {
      const standard = findStandard(entry.standardId);
      if (!standard) continue;
      for (const criterionId of entry.manualCriteria) {
        const criterion = standard.criteria.find((c) => c.id === criterionId);
        if (!criterion) continue;
        const candidates = (report.candidates ?? []).filter((c) => c.criterionId === criterionId);
        items.push({
          criterionId: criterion.id,
          title: criterion.title,
          level: criterion.level,
          candidates: candidates.map((c) => ({
            path: c.location.filePath,
            line: c.location.line,
            reason: c.reason,
          })),
        });
      }
    }

    return textResult({ items });
  },
};

// ─── Tool: list_rules ───────────────────────────────────────────────────────

const listRulesTool: McpTool = {
  def: {
    name: "list_rules",
    description:
      "List all available accessibility rules with their ID, severity, and what criteria they satisfy. Call once to understand what ra11y checks.",
    inputSchema: {
      type: "object",
      properties: {
        standard: {
          type: "string",
          description: "Filter to rules that satisfy criteria in this standard.",
        },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  handler(params) {
    let rules = BUILTIN_RULES;

    const standardFilter = strParam(params, "standard");
    if (standardFilter) {
      const prefix = `${standardFilter}:`;
      rules = rules.filter((r) => r.satisfies.some((s) => s.startsWith(prefix)));
    }

    return textResult({
      rules: rules.map((r) => ({
        id: r.id,
        description: r.docs.description,
        severity: r.severity,
        satisfies: [...r.satisfies],
      })),
    });
  },
};

// ─── Tool: configure ────────────────────────────────────────────────────────

const configureTool: McpTool = {
  def: {
    name: "configure",
    description:
      'Set session defaults for standard, level, excludes, and per-rule severity so subsequent tool calls don\'t repeat these parameters. Use `rules` to disable or demote specific rules (e.g. {"keyboard/handler-missing": "off"}) for component libraries with known-safe wrappers.',
    inputSchema: {
      type: "object",
      properties: {
        standard: { type: "string", description: "Default standard ID (e.g. wcag22)." },
        level: { type: "string", enum: ["A", "AA", "AAA"], description: "Default level." },
        exclude: {
          type: "array",
          items: { type: "string" },
          description: "Glob patterns to exclude from scanning.",
        },
        rules: {
          type: "object",
          description:
            "Per-rule severity overrides. Values: 'error', 'warning', 'info', or 'off'. Example: {\"keyboard/handler-missing\": \"off\"}.",
          additionalProperties: { type: "string", enum: ["error", "warning", "info", "off"] },
        },
      },
    },
    annotations: { idempotentHint: true },
  },
  handler(params, session) {
    const config = session.configure(buildConfigureOpts(params));
    const ruleCount = BUILTIN_RULES.filter((r) =>
      r.satisfies.some((s) => s.startsWith(`${config.standard}:`)),
    ).length;
    return textResult({
      active: { standard: config.standard, level: config.level, ruleCount },
    });
  },
};

// ─── Export ─────────────────────────────────────────────────────────────────

export const MCP_TOOLS: readonly McpTool[] = [
  scanTool,
  scanProjectTool,
  scanFileTool,
  explainRuleTool,
  suggestFixTool,
  coverageTool,
  checklistTool,
  listRulesTool,
  configureTool,
];
