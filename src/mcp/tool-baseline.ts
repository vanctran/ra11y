/**
 * The `baseline` MCP tool. Exposes the three baseline engine operations
 * — `create`, `check`, `update` — to an MCP session so an agent can
 * adopt ra11y on a messy codebase without a terminal round-trip.
 *
 * Mode semantics (mirror the CLI's `--baseline` sub-modes):
 *   - `create`: run a scan, write `.ra11y-baseline.json` with every current
 *     violation. Pass/fail state is encoded as `hadViolations` — the file
 *     is written regardless, matching the CLI's "grandfather the mess" flow.
 *   - `check`:  run a scan, diff against the file, return the new violations
 *     as the primary payload (findings grouped by file, same shape as
 *     `scan`/`scan_project`) plus grandfathered + resolved counts. The
 *     pass/fail semantics the CLI encodes in exit code 3 become
 *     `isPassing: boolean` in structured output — MCP has no exit codes.
 *   - `update`: run a scan, rewrite the file with the current violation set,
 *     report how many entries were removed (resolved) and how many were
 *     added vs the previous file.
 *
 * Session config (standard, level, rule overrides, nativeWrappers) and
 * project config (ra11y.config.ts) propagate exactly like `scan_project`
 * so a `configure` call earlier in the session carries through.
 */

import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import {
  BASELINE_FILENAME,
  type BaselineDiff,
  type BaselineFile,
  buildBaselineFile,
  diffAgainstBaseline,
  loadBaseline,
  writeBaseline,
} from "../engine/baseline.ts";
import { runScan } from "../engine/scanner.ts";
import { BUILTIN_CANDIDATE_FINDERS } from "../review/index.ts";
import { BUILTIN_RULES } from "../rules/index.ts";
import { BUILTIN_STANDARDS } from "../standards/index.ts";
import type { ScanResult } from "../types/violation.ts";
import type { McpSession } from "./session.ts";
import {
  applyRuleSettings,
  errorResult,
  formatFinding,
  groupViolationsByFile,
  type McpTool,
  type McpToolResult,
  parseFiles,
  resolveStandards,
  strParam,
  textResult,
} from "./tools-helpers.ts";

export const baselineTool: McpTool = {
  def: {
    name: "baseline",
    description:
      'Create, check, or update a `.ra11y-baseline.json` from within the MCP session. A baseline grandfathers every current violation so new regressions fail the scan without forcing a bulk fix-up first. Use this for the "adopt ra11y on a messy codebase" flow.\n\nModes:\n  - `create`: scan the project and write every current violation to the baseline file. Run once on adoption.\n  - `check`: scan and diff against the baseline — returns only the NEW violations (ones not in the file) as `newViolations`, plus grandfathered/resolved counts and an `isPassing` flag. Use in CI or the fix-verify loop after editing.\n  - `update`: scan and rewrite the baseline with the current set — drops resolved entries, reports `removedCount` and `addedCount`. Use after a deliberate cleanup pass.\n\nSession + project config propagate: `cwd` chooses the scan root (and controls ra11y.config.ts discovery); `standard`/`level` default to the session config; the MCP session\'s `nativeWrappers` and per-rule overrides are honored exactly like `scan_project`.\n\nThe file lives at `.ra11y-baseline.json` in the scan root by default. Override with `baselinePath` (absolute, or relative to `cwd`).',
    inputSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["create", "check", "update"],
          description:
            "Which baseline operation to run. `create` writes the file fresh. `check` compares the current scan against the file and returns only new violations. `update` rewrites the file with the current scan, pruning resolved entries.",
        },
        cwd: {
          type: "string",
          description:
            "Scan root. Used to discover ra11y.config.ts and `.gitignore`, and as the default location of the baseline file. Pass your project root.",
        },
        baselinePath: {
          type: "string",
          description:
            "Path to the baseline JSON file. Absolute, or relative to `cwd`. Defaults to `.ra11y-baseline.json` in `cwd`.",
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
      },
      required: ["mode"],
    },
    // `create` and `update` write to disk; only `check` is read-only. The
    // tool-level annotation has to reflect the superset, so no readOnlyHint.
    annotations: { idempotentHint: true },
  },
  async handler(params, session) {
    const mode = strParam(params, "mode");
    if (mode !== "create" && mode !== "check" && mode !== "update") {
      return errorResult("mode is required and must be one of: create, check, update.");
    }
    const cwd = strParam(params, "cwd") ?? process.cwd();
    const baselineRel = strParam(params, "baselinePath");
    const baselinePath = resolveBaselinePath(baselineRel, cwd);

    const projectConfig = await session.loadProjectConfig(cwd);
    const standards = resolveStandards(strParam(params, "standard"), session);
    const level = resolveLevelParam(strParam(params, "level"), session);
    const files = await parseFiles([cwd], session, cwd);

    const activeRules = applyRuleSettings(BUILTIN_RULES, session.effectiveRules(projectConfig));
    const { result } = runScan({
      standards: BUILTIN_STANDARDS,
      rules: activeRules,
      enabled: standards,
      files,
      finders: BUILTIN_CANDIDATE_FINDERS,
      level,
    });

    if (mode === "create") return handleCreate(result, baselinePath, cwd);
    if (mode === "update") return handleUpdate(result, baselinePath, cwd);
    return handleCheck(result, baselinePath, cwd);
  },
};

function resolveBaselinePath(rel: string | undefined, cwd: string): string {
  if (rel === undefined) return join(cwd, BASELINE_FILENAME);
  return isAbsolute(rel) ? rel : resolve(cwd, rel);
}

function resolveLevelParam(level: string | undefined, session: McpSession): "A" | "AA" | "AAA" {
  const v = level ?? session.config.level;
  if (v === "A" || v === "AAA") return v;
  return "AA";
}

async function handleCreate(
  result: ScanResult,
  baselinePath: string,
  cwd: string,
): Promise<McpToolResult> {
  const previousCount = existsSync(baselinePath)
    ? (await loadOrNull(baselinePath))?.violations.length
    : undefined;
  const baseline = buildBaselineFile(result);
  await writeBaseline(baselinePath, baseline);
  return textResult({
    mode: "create",
    baselinePath,
    entriesWritten: baseline.violations.length,
    ...(previousCount === undefined ? {} : { previousEntries: previousCount, overwrote: true }),
    hadViolations: baseline.violations.length > 0,
    meta: {
      filesScanned: result.filesScanned,
      standards: [...result.enabledStandards].sort(),
      cwd,
      generatedAt: baseline.generatedAt,
    },
    nextStep: buildCreateNextStep(baseline.violations.length, baselinePath),
  });
}

async function handleUpdate(
  result: ScanResult,
  baselinePath: string,
  cwd: string,
): Promise<McpToolResult> {
  const previous = await loadOrNull(baselinePath);
  const next = buildBaselineFile(result);
  await writeBaseline(baselinePath, next);

  if (previous === null) {
    // Treat update-on-missing as a create with a distinct mode so the
    // agent can see what happened — matches the CLI's forgiving behavior
    // (update always writes) while surfacing the asymmetry honestly.
    return textResult({
      mode: "update",
      baselinePath,
      entriesWritten: next.violations.length,
      addedCount: next.violations.length,
      removedCount: 0,
      createdFile: true,
      hadViolations: next.violations.length > 0,
      meta: {
        filesScanned: result.filesScanned,
        standards: [...result.enabledStandards].sort(),
        cwd,
        generatedAt: next.generatedAt,
      },
      nextStep: buildUpdateNextStep(next.violations.length, 0, 0, true),
    });
  }

  const diff = diffAgainstBaseline(result, previous);
  const removedCount = diff.resolved.length;
  const addedCount = diff.newViolations.length;
  return textResult({
    mode: "update",
    baselinePath,
    entriesWritten: next.violations.length,
    previousEntries: previous.violations.length,
    addedCount,
    removedCount,
    hadViolations: next.violations.length > 0,
    meta: {
      filesScanned: result.filesScanned,
      standards: [...result.enabledStandards].sort(),
      cwd,
      generatedAt: next.generatedAt,
      previousGeneratedAt: previous.generatedAt,
    },
    nextStep: buildUpdateNextStep(next.violations.length, addedCount, removedCount, false),
  });
}

async function handleCheck(
  result: ScanResult,
  baselinePath: string,
  cwd: string,
): Promise<McpToolResult> {
  if (!existsSync(baselinePath)) {
    return errorResult(
      `Baseline file not found at ${baselinePath}. Run the \`baseline\` tool with mode: "create" first.`,
    );
  }
  let baseline: BaselineFile;
  try {
    const loaded = await loadBaseline(baselinePath);
    if (loaded === null) {
      return errorResult(`Baseline file not found at ${baselinePath}.`);
    }
    baseline = loaded;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(`Failed to load baseline at ${baselinePath}: ${message}`);
  }

  const diff = diffAgainstBaseline(result, baseline);
  const grouped = groupViolationsByFile(diff.newViolations);
  const files = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, violations]) => ({
      path,
      findings: violations.map(formatFinding),
    }));

  return textResult({
    mode: "check",
    baselinePath,
    isPassing: diff.newViolations.length === 0,
    newViolationCount: diff.newViolations.length,
    grandfatheredCount: diff.grandfathered.length,
    resolvedCount: diff.resolved.length,
    files,
    resolvedEntries: diff.resolved.map((e) => ({
      ruleId: e.ruleId,
      filePath: e.filePath,
      message: e.message,
    })),
    meta: {
      filesScanned: result.filesScanned,
      standards: [...result.enabledStandards].sort(),
      cwd,
      baselineGeneratedAt: baseline.generatedAt,
      baselineVersion: baseline.version,
    },
    nextStep: buildCheckNextStep(diff, files),
  });
}

async function loadOrNull(path: string): Promise<BaselineFile | null> {
  if (!existsSync(path)) return null;
  try {
    return await loadBaseline(path);
  } catch {
    // Malformed or version-mismatched files are surfaced explicitly in
    // check mode; create/update should proceed so the agent can recover
    // by rewriting the file.
    return null;
  }
}

function buildCreateNextStep(count: number, baselinePath: string): string {
  if (count === 0) {
    return `Wrote empty baseline to ${baselinePath} — no violations in this scan. Future regressions will fail \`baseline\` with mode: "check".`;
  }
  const noun = count === 1 ? "violation" : "violations";
  return `Grandfathered ${count} ${noun} into ${baselinePath}. Commit the file. Run \`baseline\` with mode: "check" in CI to catch new regressions; run with mode: "update" after a cleanup pass to prune resolved entries.`;
}

function buildUpdateNextStep(
  entries: number,
  added: number,
  removed: number,
  created: boolean,
): string {
  if (created) {
    return `Baseline file did not exist — created a fresh one with ${entries} ${entries === 1 ? "entry" : "entries"}. Next time, call \`baseline\` with mode: "create" for this flow.`;
  }
  const parts: string[] = [];
  if (removed > 0) parts.push(`removed ${removed} resolved`);
  if (added > 0) parts.push(`added ${added} new`);
  const delta = parts.length > 0 ? parts.join(", ") : "no net changes";
  return `Baseline rewritten — ${delta}. ${entries} ${entries === 1 ? "entry" : "entries"} total. Commit the updated file.`;
}

function buildCheckNextStep(
  diff: BaselineDiff,
  files: readonly { readonly path: string; readonly findings: readonly unknown[] }[],
): string {
  if (diff.newViolations.length > 0) {
    const noun = diff.newViolations.length === 1 ? "violation" : "violations";
    const first = firstFinding(files);
    const firstHint =
      first === null
        ? ""
        : ` Start with ${first.path}:${first.line} (rule \`${first.ruleId}\`) — call \`suggest_fix\` for a concrete patch.`;
    return `${diff.newViolations.length} new ${noun} not in the baseline.${firstHint}`;
  }
  if (diff.resolved.length > 0) {
    const noun = diff.resolved.length === 1 ? "entry is" : "entries are";
    return `Baseline check clean — no new violations. ${diff.resolved.length} baseline ${noun} resolved; call \`baseline\` with mode: "update" to prune them from the file.`;
  }
  return "Baseline check clean — no new violations, nothing resolved. Pair with axe-core runtime checks before claiming a11y conformance.";
}

interface FirstFinding {
  readonly path: string;
  readonly line: number;
  readonly ruleId: string;
}

function firstFinding(
  files: readonly { readonly path: string; readonly findings: readonly unknown[] }[],
): FirstFinding | null {
  for (const file of files) {
    for (const raw of file.findings) {
      if (!raw || typeof raw !== "object") continue;
      const f = raw as Record<string, unknown>;
      const ruleId = f["ruleId"];
      const line = f["line"];
      if (typeof ruleId === "string" && typeof line === "number") {
        return { path: file.path, line, ruleId };
      }
    }
  }
  return null;
}
