/**
 * MCP tool definitions — name, description, inputSchema, handler.
 *
 * `MCP_TOOLS` (exported below) is the canonical inventory consumed by
 * `tools/list`. Tools whose handlers fit in one file live here; larger
 * tools live in their own `tool-*.ts` module and are imported into the
 * `MCP_TOOLS` array.
 *
 * Every handler is a pure function over the scanner's output + session
 * state. No MCP-specific logic leaks into `src/engine/`.
 */

import { isAbsolute, resolve } from "node:path";
import { BUILTIN_RULES } from "../rules/index.ts";
import { BUILTIN_STANDARDS } from "../standards/index.ts";
import { applyMetaCacheMode, metaModeSchema } from "./meta-cache.ts";
import { buildNextStep } from "./next-step.ts";
import { pathExists } from "./path-exists.ts";
import { dedupeReviewCandidatesForSingleFile } from "./review-candidate-dedup.ts";
import { includeRuleDetailsSchema, ruleCatalogField } from "./rule-catalog.ts";
import { applyFixTool } from "./tool-apply-fix.ts";
import { attestTool } from "./tool-attest.ts";
import { auditTool } from "./tool-audit.ts";
import { baselineTool } from "./tool-baseline.ts";
import { bootstrapTool } from "./tool-bootstrap.ts";
import { checklistTool } from "./tool-checklist.ts";
import { conformanceStatementTool } from "./tool-conformance-statement.ts";
import { coverageTool } from "./tool-coverage.ts";
import { detectNativeWrappersTool } from "./tool-detect-wrappers.ts";
import { explainStandardTool } from "./tool-explain-standard.ts";
import { listAttestationsTool } from "./tool-list-attestations.ts";
import { listSuppressionsTool } from "./tool-list-suppressions.ts";
import { proposeBaselineTool } from "./tool-propose-baseline.ts";
import { proposeConfigTool } from "./tool-propose-config.ts";
import { reviewCandidatesTool } from "./tool-review-candidates.ts";
import { scanDiffTool } from "./tool-scan-diff.ts";
import { scanProcessTool } from "./tool-scan-process.ts";
import { scanProjectTool } from "./tool-scan-project.ts";
import { suggestFixTool } from "./tool-suggest-fix.ts";
import { suppressTool } from "./tool-suppress.ts";
import { wrapperIntrospectTool } from "./tool-wrapper-introspect.ts";
import {
  buildConfigureOpts,
  errorResult,
  findRule,
  type McpTool,
  parseFiles,
  resolveStandards,
  runScanAndFormat,
  strArrayParam,
  strParam,
  textResult,
} from "./tools-helpers.ts";
import { warningsField, warningsFieldFromScanMeta } from "./warnings.ts";
import { buildWrapperSourcesFromConfig } from "./wrappers-meta.ts";

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
          description:
            "File or directory paths to scan. A single array may mix files and directories — each entry is resolved individually before scanning.",
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
        verboseMeta: {
          type: "boolean",
          description:
            "When true, analysisCoverage expands its counts into the actual lists — `parseErrorFiles` (paths that failed to parse), `opaqueCustomComponentNames` (PascalCase tags not in nativeWrappers), and `rulesByExtension` (which rules ran against which file types). Off by default to keep responses terse; enable when triaging coverage gaps.",
        },
        metaMode: metaModeSchema,
        includeRuleDetails: includeRuleDetailsSchema,
      },
      required: ["paths"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async handler(params, session) {
    const paths = strArrayParam(params, "paths");
    if (!paths || paths.length === 0) {
      return errorResult({
        code: "missing-required-param",
        message: "paths must be a non-empty array of file or directory paths.",
        details: { param: "paths" },
      });
    }

    const cwd = strParam(params, "cwd") ?? process.cwd();
    // Hard-error envelope when every caller-supplied path is missing on
    // disk. Soft-signal (`warnings: ["scanned_zero_files"]`) stays the
    // right shape for "the paths exist but contain no parseable files."
    // Without this split, a typo in `paths` reads the same as a clean
    // codebase — the silent-success failure shape CLAUDE.md §1 warns
    // against.
    const existence = await Promise.all(paths.map((p) => pathExists(p, cwd)));
    const missing = paths.filter((_, i) => !existence[i]);
    if (missing.length === paths.length) {
      return errorResult({
        code: "scan-paths-not-found",
        message: `None of the requested paths exist on disk: ${paths.join(", ")}`,
        details: { paths, missing, cwd },
        remediation:
          "Pass `paths` entries that exist on disk (files or directories). Relative paths resolve against `cwd` when supplied, otherwise against the MCP server's spawn directory.",
      });
    }
    const projectConfig = await session.loadProjectConfig(cwd);
    const standards = resolveStandards(strParam(params, "standard"), session);
    const files = await parseFiles(paths, session, cwd);
    if (files.length === 0) {
      return textResult({
        plan: { totalFindings: 0, summary: "No parseable files found." },
        files: [],
        meta: { filesScanned: 0, scannedPaths: paths },
        // `scan` takes paths directly and has no root-resolution step,
        // so rootSource is null — `root_source_defaulted` cannot fire
        // here by construction (it's a scan_project-only signal).
        ...warningsField({
          filesScanned: 0,
          rootSource: null,
          configSource: projectConfig.sourcePath,
          analysisCoverage: undefined,
          filesByExtension: undefined,
        }),
      });
    }

    const { formatted } = await runScanAndFormat(
      files,
      session,
      standards,
      strParam(params, "minSeverity"),
      session.effectiveRules(projectConfig),
      buildWrapperSourcesFromConfig(projectConfig, session),
      cwd,
      params["verboseMeta"] === true,
    );

    const nextStep = buildNextStep(formatted);
    const nextStepStructuredField =
      nextStep.structured === undefined ? {} : { nextStepStructured: nextStep.structured };

    const fullMeta: Record<string, unknown> = {
      ...formatted.meta,
      scannedPaths: paths,
      configSource: projectConfig.sourcePath,
      configSearchedFrom: cwd,
      ...(projectConfig.sourcePath === null
        ? {
            configNote: `No ra11y.config found at ${cwd} — using built-in defaults (no nativeWrappers, no per-rule overrides). Drop a ra11y.config.ts at the project root to register design-system wrappers and customize severities.`,
          }
        : {}),
      nextStep: nextStep.prose,
      ...nextStepStructuredField,
    };
    return textResult({
      ...formatted,
      ...ruleCatalogField(params, BUILTIN_RULES, formatted.files),
      ...warningsFieldFromScanMeta({
        meta: formatted.meta,
        rootSource: null,
        configSource: projectConfig.sourcePath,
      }),
      meta: applyMetaCacheMode({ toolName: "scan", params, fullMeta, session }),
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
        verboseMeta: {
          type: "boolean",
          description:
            "When true, the response includes an `analysisCoverage` block with parse-error and opaque-component details, plus `rulesByExtension` so you can verify which rules ran on this file's type. Off by default.",
        },
        metaMode: metaModeSchema,
      },
      required: ["path"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async handler(params, session) {
    const filePath = strParam(params, "path");
    if (!filePath || filePath.length === 0) {
      return errorResult({
        code: "missing-required-param",
        message: "path must be a non-empty string.",
        details: { param: "path" },
      });
    }

    // Pre-check existence so a missing file produces the same tool-level
    // error envelope as an unsupported extension, instead of ENOENT
    // escaping `parseFile` and degrading to a JSON-RPC protocol error
    // that the caller can't `isError`-branch on like the other tools.
    const scanFileCwd = strParam(params, "cwd");
    if (!(await pathExists(filePath, scanFileCwd))) {
      return errorResult({
        code: "file-unsupported",
        message: `Unsupported or unreadable file: ${filePath}`,
        details: { filePath },
        remediation: "Pass a .tsx/.jsx/.ts/.js, .html/.htm, or .css file that exists on disk.",
      });
    }

    const parsed = await session.parseFile(filePath, scanFileCwd);
    if (!parsed) {
      return errorResult({
        code: "file-unsupported",
        message: `Unsupported or unreadable file: ${filePath}`,
        details: { filePath },
        remediation: "Pass a .tsx/.jsx/.ts/.js, .html/.htm, or .css file that exists on disk.",
      });
    }

    // Resolve the directory to search for ra11y.config.* and to feed
    // runScanAndFormat. Mirrors scan_project's precedence: explicit
    // cwd wins; otherwise we walk up from the file's own directory so
    // the loader can still find a project config when the agent
    // didn't pass cwd.
    const absFilePath = isAbsolute(filePath)
      ? filePath
      : resolve(scanFileCwd ?? process.cwd(), filePath);
    const configSearchBase =
      scanFileCwd ?? (absFilePath.slice(0, absFilePath.lastIndexOf("/")) || process.cwd());
    const projectConfig = await session.loadProjectConfig(configSearchBase);
    const standards = resolveStandards(strParam(params, "standard"), session);

    // Reuse runScanAndFormat so the `meta` envelope matches scan_project
    // verbatim (rulesEvaluated, filesByExtension, activeNativeWrappers,
    // analysisCoverage, suppressions, standards, durationMs). Without
    // this, scan_file's fix-verify loop couldn't confirm config parity
    // with the scan_project call that kicked off the work — the
    // canonical Track Q shape-drift bug.
    const { formatted, reviewCandidates: rawCandidates } = await runScanAndFormat(
      [parsed],
      session,
      standards,
      strParam(params, "minSeverity"),
      session.effectiveRules(projectConfig),
      buildWrapperSourcesFromConfig(projectConfig, session),
      configSearchBase,
      params["verboseMeta"] === true,
    );

    // scan_file's historical top-level shape is `{ findings, reviewCandidates }`
    // rather than scan_project's `{ plan, files[], meta }`. Preserve
    // that — agents iterating the fix-verify loop key off the flat
    // `findings` array. `plan` and `meta` still ride along so the
    // envelope is honest about counts and scan-confidence telemetry.
    const flatFindings = formatted.files[0]?.findings ?? [];
    const nextStep = buildNextStep(formatted, { singleFilePath: parsed.filePath });
    // P1-K: structured twin of the prose nextStep. Conditional-spread
    // per CLAUDE.md §1 "Ambiguous field shapes are dishonest": omit
    // `nextStepStructured` when the prose falls back to generic
    // advice, rather than ship a sentinel value.
    const nextStepStructuredField =
      nextStep.structured === undefined ? {} : { nextStepStructured: nextStep.structured };
    // Cross-standard dedup mirrors the violation-level collapse the
    // rule runner already performs (one Violation with
    // `criteria: string[]` across every enabled standard). Finders emit
    // one candidate per criterion — without this collapse the same
    // line appears 4-6x in the response. scan_file scans a single file,
    // so rawCandidates is already scoped to that file — no per-path
    // filter needed.
    const dedupedCandidates = dedupeReviewCandidatesForSingleFile(rawCandidates);

    const fullMeta: Record<string, unknown> = {
      ...formatted.meta,
      filesScanned: 1,
      scannedFile: parsed.filePath,
      configSource: projectConfig.sourcePath,
      configSearchedFrom: configSearchBase,
      ...(projectConfig.sourcePath === null
        ? {
            configNote: `No ra11y.config found walking up from ${configSearchBase} — using built-in defaults (no nativeWrappers, no per-rule overrides). Drop a ra11y.config.ts at the project root to register design-system wrappers and customize severities.`,
          }
        : {}),
      nextStep: nextStep.prose,
      ...nextStepStructuredField,
    };
    return textResult({
      findings: flatFindings,
      reviewCandidates: dedupedCandidates,
      plan: formatted.plan,
      ...(formatted.referenceGuide === undefined
        ? {}
        : { referenceGuide: formatted.referenceGuide }),
      ...warningsFieldFromScanMeta({
        meta: formatted.meta,
        // scan_file has no `scannedRoot` / `rootSource` concept — the
        // file IS the scope. Passing null here suppresses the
        // `root_source_defaulted` warning, which is a scan_project-only
        // signal.
        rootSource: null,
        configSource: projectConfig.sourcePath,
      }),
      meta: applyMetaCacheMode({ toolName: "scan_file", params, fullMeta, session }),
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
      return errorResult({
        code: "missing-required-param",
        message: "ruleId is required.",
        details: { param: "ruleId" },
      });
    }
    const rule = findRule(ruleId);
    if (!rule) {
      return errorResult({
        code: "rule-not-found",
        message: `Rule '${ruleId}' not found. Use list_rules to see available rules.`,
        details: { requested: ruleId },
        remediation: "Call `list_rules` to discover valid rule IDs.",
      });
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
      if (!BUILTIN_STANDARDS.some((s) => s.id === standardFilter)) {
        const known = BUILTIN_STANDARDS.map((s) => s.id).join(", ");
        return errorResult({
          code: "standard-not-found",
          message: `Unknown standard '${standardFilter}'. Loaded: ${known}.`,
          details: { requested: standardFilter, loaded: BUILTIN_STANDARDS.map((s) => s.id) },
          remediation:
            "Pass `standard` with one of the loaded IDs, or omit to list rules from every loaded standard.",
        });
      }
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

// ─── Tool: sessionConfigure (alias: configure) ──────────────────────────────

const sessionConfigureTool: McpTool = {
  def: {
    name: "sessionConfigure",
    description:
      'Set EPHEMERAL session-scoped defaults — standard, level, excludes, per-rule severity, native-wrapper components — so subsequent tool calls on this MCP connection don\'t repeat these parameters. State lives in the session only; nothing is written to disk, and a fresh connection starts clean.\n\nFor durable, committed configuration, drop a `ra11y.config.ts` at the project root:\n\n  export default {\n    nativeWrappers: ["Button", "ActionButton"],\n    rules: { "media/alt-text-missing": "warning" },\n    exclude: ["packages/legacy/**"],\n  };\n\nThe scan response surfaces `meta.configSource` (path of the loaded file, or null) and `meta.configSearchedFrom` (directory the loader walked up from). If `configSource` is null, make sure you pass `cwd` so the loader walks up from your project root, not the MCP server\'s spawn directory.\n\nLegacy name: `configure`. Accepted for backward compatibility for one release; responses emit `warnings: ["deprecated_tool_name_configure"]` when invoked via the old name. Migrate callers to `sessionConfigure`.',
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
        nativeWrappers: {
          oneOf: [
            {
              type: "array",
              items: { type: "string" },
            },
            {
              type: "object",
              additionalProperties: { type: "string" },
            },
          ],
          description:
            'PascalCase components you\'ve verified wrap a native interactive element (<button>, <a>, etc.). Two accepted shapes:\n\n  • Flat names array — `["Button", "ActionButton", "IconButton"]`. Info-level keyboard/handler-missing notes on these components are suppressed; wrapper-opt-in rules (`media/alt-text-missing`, `navigation/link-descriptive-text`, `forms/labels-required`) do NOT pick them up because the native element target is unknown.\n  • Object map — `{ Button: "button", ActionButton: "button", RouterLink: "a", Avatar: "img" }`. In addition to suppression, wrapper-opt-in rules treat these components as the mapped native element and fire/pass accordingly. Surfaces on the response as `activeNativeWrapperElements`.\n\nAdditive across calls: per-key merge on the object form (later entries refine prior ones for the same wrapper); union on the array form.',
        },
        allowWrite: {
          type: "boolean",
          description:
            "Opt-in gate for tools that mutate user source (`apply_fix`). Defaults to false: no ra11y MCP tool will write to disk until the host flips this to true. Flip it back to false to re-gate after a batch of fixes. Read-only tools ignore this flag.",
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
      active: {
        standard: config.standard,
        level: config.level,
        ruleCount,
        allowWrite: config.allowWrite,
      },
    });
  },
};

// ─── Export ─────────────────────────────────────────────────────────────────

export const MCP_TOOLS: readonly McpTool[] = [
  scanTool,
  scanProjectTool,
  scanFileTool,
  scanDiffTool,
  scanProcessTool,
  detectNativeWrappersTool,
  wrapperIntrospectTool,
  explainRuleTool,
  explainStandardTool,
  suggestFixTool,
  applyFixTool,
  coverageTool,
  checklistTool,
  conformanceStatementTool,
  reviewCandidatesTool,
  auditTool,
  baselineTool,
  bootstrapTool,
  listRulesTool,
  listSuppressionsTool,
  suppressTool,
  attestTool,
  listAttestationsTool,
  proposeConfigTool,
  proposeBaselineTool,
  sessionConfigureTool,
];

/**
 * Deprecated alias for `sessionConfigure`. Dispatch-only — not listed in
 * `tools/list`. The handler delegates to the canonical tool and layers
 * a `warnings: ["deprecated_tool_name_configure"]` onto the structured
 * content so agents can migrate on their own schedule. Remove one
 * release after a major version bump.
 */
export const SESSION_CONFIGURE_ALIAS: { readonly name: string; readonly tool: McpTool } = {
  name: "configure",
  tool: sessionConfigureTool,
};
