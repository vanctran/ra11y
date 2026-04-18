/**
 * The suggest_fix MCP tool. Lives in its own file so src/mcp/tools.ts
 * stays under the 500-line file budget after the P2-R `file`/`filePath`
 * alias logic + P0-D unique-anchor wiring landed.
 */

import { runScan } from "../engine/scanner.ts";
import { BUILTIN_RULES } from "../rules/index.ts";
import { BUILTIN_STANDARDS } from "../standards/index.ts";
import { readFilePathParam } from "./tool-apply-fix-internals.ts";
import { buildSuggestFixPayload } from "./tool-suggest-fix-internals.ts";
import {
  applyRuleSettings,
  buildSourceContext,
  errorResult,
  findRule,
  type McpTool,
  numParam,
  resolveStandards,
  strParam,
  textResult,
} from "./tools-helpers.ts";
import { warningsField } from "./warnings.ts";

export const suggestFixTool: McpTool = {
  def: {
    name: "suggest_fix",
    description:
      "Get resolution paths for a violation. Returns either `kind: 'edit'` with a direct oldText/newText pair that Edit can apply, or `kind: 'guidance'` with a ranked `primary` fix and `alternatives` — each a short labeled path you can act on. Prefer the primary; fall through alternatives when context rules it out. The `sourceContext` and `snippet` are included so you can compose the edit yourself when no mechanical fix is available.",
    inputSchema: {
      type: "object",
      properties: {
        ruleId: { type: "string", description: "Rule ID of the violation." },
        file: { type: "string", description: "File path containing the violation." },
        filePath: { type: "string", description: "Deprecated alias of `file`." },
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
      required: ["ruleId", "line"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async handler(params, session) {
    const ruleId = strParam(params, "ruleId");
    const filePathResult = readFilePathParam(params);
    if (filePathResult.error) return filePathResult.error;
    const filePath = filePathResult.value;
    const line = numParam(params, "line");

    if (!(ruleId && filePath) || line === undefined) {
      return errorResult({
        code: "missing-required-param",
        message: "ruleId, file, and line are required.",
        details: {
          missing: [
            ...(ruleId ? [] : ["ruleId"]),
            ...(filePath ? [] : ["file"]),
            ...(line === undefined ? ["line"] : []),
          ],
        },
      });
    }

    if (!findRule(ruleId)) {
      return errorResult({
        code: "rule-not-found",
        message: `Rule '${ruleId}' not found.`,
        details: { requested: ruleId },
        remediation: "Call `list_rules` to discover valid rule IDs.",
      });
    }

    // Parse the file to find the specific violation and its suggestion.
    const parsed = await session.parseFile(filePath, strParam(params, "cwd"));
    if (!parsed) {
      return errorResult({
        code: "file-unsupported",
        message: `Unsupported or unreadable file: ${filePath}`,
        details: { file: filePath },
        remediation: "Pass a .tsx/.jsx/.ts/.js, .html/.htm, or .css file that exists on disk.",
      });
    }

    const standards = resolveStandards(undefined, session);
    const { result } = runScan({
      standards: BUILTIN_STANDARDS,
      rules: applyRuleSettings(BUILTIN_RULES, session.config.rules),
      enabled: standards,
      files: [parsed],
      level: session.config.level,
    });

    const match = result.violations.find((v) => v.ruleId === ruleId && v.location.line === line);
    const sourceContext =
      strParam(params, "sourceContext") ?? buildSourceContext(parsed.source, line);
    const combinedWarnings = composeSuggestFixWarnings({
      filesScanned: result.filesScanned,
      usedDeprecatedAlias: filePathResult.usedDeprecatedAlias,
    });
    const payload = buildSuggestFixPayload({
      ruleId,
      line,
      match,
      sourceContext,
      source: parsed.source,
      filePath,
      ...(combinedWarnings.length > 0 ? { warnings: combinedWarnings } : {}),
    });
    return textResult(payload as Record<string, unknown>);
  },
};

/**
 * Unified response-level `warnings` for `suggest_fix`. Combines
 * caller-input warnings (deprecated `filePath` alias) with scan-
 * confidence codes from the shared helper so both ride a single field
 * per the AI-first doctrine (CLAUDE.md §1 "Zero-output success is
 * ambiguous failure"). `suggest_fix` parses one file and hard-errors
 * when it can't, so `scanned_zero_files` won't fire in practice today —
 * but plumbing the helper through keeps the doctrine contract
 * consistent across tools and means future codes appear automatically
 * without another retrofit. Pass `rootSource: null` (no root-resolution
 * step) and `configSource: undefined` (the handler doesn't resolve
 * project config) so those codes stay silent.
 */
function composeSuggestFixWarnings(inputs: {
  readonly filesScanned: number;
  readonly usedDeprecatedAlias: boolean;
}): readonly string[] {
  const scanWarnings =
    warningsField({
      filesScanned: inputs.filesScanned,
      rootSource: null,
      configSource: undefined,
      analysisCoverage: undefined,
      filesByExtension: undefined,
    }).warnings ?? [];
  return [...(inputs.usedDeprecatedAlias ? ["deprecated_param_filepath"] : []), ...scanWarnings];
}
