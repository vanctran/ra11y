/**
 * The `scan_diff` MCP tool. Runs a scan and returns ONLY the violations
 * that aren't already in a baseline snapshot — a focused primitive for
 * "what regressed since this snapshot?" pitched distinctly from the
 * `baseline` tool's adoption-flow framing.
 *
 * `baseline` (mode: "check") — "am I regressing against my adopted
 *   baseline? give me pass/fail + the delta."
 * `scan_diff` — "what changed since this snapshot? give me just the new
 *   findings, ordered for triage, with the full scan telemetry so I can
 *   judge scan confidence."
 *
 * Implementation shares engine helpers with `tool-baseline.ts`:
 * `loadBaseline`, `fingerprintOf`, `BASELINE_FILENAME` — no
 * reimplementation of fingerprint or diff. The fingerprint is computed
 * on the post-format finding so wrapper-noise suppression and severity
 * filtering in `runScanAndFormat` apply uniformly — a baseline entry
 * that the session suppresses stays suppressed, a new finding that
 * passes the filter is what the agent sees.
 */

import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import {
  BASELINE_FILENAME,
  type BaselineFile,
  fingerprintOf,
  loadBaseline,
} from "../engine/baseline.ts";
import { filesChangedSince, gitRoot, stagedFiles } from "../utils/git.ts";
import { logger } from "../utils/logger.ts";
import {
  errorResult,
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

export const scanDiffTool: McpTool = {
  def: {
    name: "scan_diff",
    description:
      'Scan the project and return ONLY the violations that are not already present in a baseline snapshot — the regression-focused cousin of `baseline` (mode: "check"). Use when you want a general "what changed since this snapshot?" primitive rather than the adopt-on-messy-codebase workflow.\n\nFull scan telemetry (`activeNativeWrappers`, `rulesEvaluated`, `analysisCoverage`, per-extension file counts) rides along so you can judge whether the scan had teeth before acting on the delta.\n\nThe baseline file defaults to `.ra11y-baseline.json` in `cwd`. Override with `baselinePath` (absolute, or cwd-relative). Missing / malformed / version-mismatched files come back as a structured error — generate one with `baseline` (mode: "create") first.\n\nNarrow the scan scope with `changedOnly: true` (staged files only) or `since: "main"` (files changed vs a ref, plus uncommitted WIP) — identical semantics to `scan_project`. `additionalPaths` bypasses `.gitignore` / default build-dir skips to include post-compile CSS/HTML.',
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description:
            "Scan root. Used for ra11y.config.ts discovery, `.gitignore`, and the default location of the baseline file.",
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
        minSeverity: {
          type: "string",
          enum: ["error", "warning", "info"],
          description:
            "Minimum severity to include. Default 'info' is recommended — info findings are cases static analysis can't resolve but you can. Raise to 'warning' for unattended CI gates.",
        },
        changedOnly: {
          type: "boolean",
          description:
            "Scan only files currently staged in git (pre-commit use case). Falls back to a full scan if cwd isn't a git repo.",
        },
        since: {
          type: "string",
          description:
            "Git ref (e.g. 'main', 'HEAD~1'). Scans only files that differ between the ref and HEAD, plus uncommitted WIP.",
        },
        additionalPaths: {
          type: "array",
          items: { type: "string" },
          description:
            "Paths scanned in addition to the auto-discovered tree, with `.gitignore` and default build-dir skips bypassed. Relative paths resolve from `cwd`.",
        },
        verboseMeta: {
          type: "boolean",
          description:
            "When true, analysisCoverage expands its counts into underlying lists (parseErrorFiles, opaqueCustomComponentNames, rulesByExtension).",
        },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async handler(params, session) {
    const explicitCwd = strParam(params, "cwd");
    const spawnCwd = process.cwd();
    const cwd = explicitCwd ?? gitRoot(spawnCwd) ?? spawnCwd;
    const baselineRel = strParam(params, "baselinePath");
    const baselinePath = resolveBaselinePath(baselineRel, cwd);

    // Load-or-error first so a missing/malformed baseline fails fast
    // without spending the scan budget. Error envelopes match the
    // baseline tool's check-mode wording so agents can reuse the same
    // recovery logic (see tool-baseline.ts).
    if (!existsSync(baselinePath)) {
      return errorResult({
        code: "baseline-not-found",
        message: `Baseline file not found at ${baselinePath}. Run the \`baseline\` tool with mode: "create" first.`,
        details: { baselinePath },
        remediation: 'Call `baseline` with mode: "create" to write the file, then retry.',
      });
    }
    let baseline: BaselineFile;
    try {
      const loaded = await loadBaseline(baselinePath);
      if (loaded === null) {
        return errorResult({
          code: "baseline-not-found",
          message: `Baseline file not found at ${baselinePath}.`,
          details: { baselinePath },
        });
      }
      baseline = loaded;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResult({
        code: "baseline-load-failed",
        message: `Failed to load baseline at ${baselinePath}: ${message}`,
        details: { baselinePath, cause: message },
        remediation:
          'Regenerate the baseline with `baseline` mode: "create" if the file is malformed or version-mismatched.',
      });
    }

    const projectConfig = await session.loadProjectConfig(cwd);
    const standards = resolveStandards(strParam(params, "standard"), session);
    const roots = resolveScanRoots(params, cwd);
    const t0 = performance.now();
    const baseFiles = await parseFiles(roots, session, cwd);
    const additionalPaths = strArrayParam(params, "additionalPaths") ?? [];
    const additionalFiles =
      additionalPaths.length > 0 ? await parseExplicitPaths(additionalPaths, session, cwd) : [];
    const files = mergeFilesByPath(baseFiles, additionalFiles);
    if (files.length === 0) {
      return textResult(
        buildEmptyFilesResponse({ baseline, baselinePath, cwd, mode: describeMode(params) }),
      );
    }
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
      cwd,
      params["verboseMeta"] === true,
    );
    logger.debug(`scan_diff: ${files.length} files in ${ms(t0)}ms`);

    const baselineHashes = new Set(baseline.violations.map((v) => v.hash));
    const { newFiles, newCount } = filterToNewFindings(formatted.files, baselineHashes);

    return textResult({
      mode: "diff",
      baselinePath,
      baselineCount: baseline.violations.length,
      baselineGeneratedAt: baseline.generatedAt,
      newCount,
      newViolations: newFiles,
      meta: {
        ...formatted.meta,
        scannedRoot: cwd,
        scanMode: describeMode(params),
        configSource: projectConfig.sourcePath,
        baselineVersion: baseline.version,
      },
      nextStep: buildNextStep(newCount, newFiles),
    });
  },
};

function resolveBaselinePath(rel: string | undefined, cwd: string): string {
  if (rel === undefined) return join(cwd, BASELINE_FILENAME);
  return isAbsolute(rel) ? rel : resolve(cwd, rel);
}

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
 * Walks the formatted `files` output from `runScanAndFormat` and keeps
 * only findings whose fingerprint isn't already in the baseline. The
 * fingerprint uses the same `(ruleId, normalized filePath, message)`
 * recipe as `engine/baseline.ts`, via the shared `fingerprintOf`
 * helper — this is the whole reason the helper exists. Returns the
 * filtered files (path + findings) plus the total new-finding count.
 */
function filterToNewFindings(
  files: ScanFormatted["files"],
  baselineHashes: ReadonlySet<string>,
): {
  readonly newFiles: { readonly path: string; readonly findings: readonly unknown[] }[];
  readonly newCount: number;
} {
  const newFiles: { readonly path: string; readonly findings: readonly unknown[] }[] = [];
  let newCount = 0;
  for (const file of files) {
    const kept: unknown[] = [];
    for (const raw of file.findings) {
      const hash = hashOfFormattedFinding(file.path, raw);
      if (hash === null) continue;
      if (baselineHashes.has(hash)) continue;
      kept.push(raw);
    }
    if (kept.length > 0) {
      newFiles.push({ path: file.path, findings: kept });
      newCount += kept.length;
    }
  }
  return { newFiles, newCount };
}

function hashOfFormattedFinding(filePath: string, raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const ruleId = f["ruleId"];
  const message = f["message"];
  if (typeof ruleId !== "string" || typeof message !== "string") return null;
  return fingerprintOf(ruleId, filePath, message);
}

interface FirstFinding {
  readonly path: string;
  readonly line: number;
  readonly ruleId: string;
}

function firstNewFinding(
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

function buildNextStep(
  newCount: number,
  newFiles: readonly { readonly path: string; readonly findings: readonly unknown[] }[],
): string {
  if (newCount === 0) {
    return 'No new violations versus the baseline. If you expected regressions here, double-check the baseline is current — run `baseline` with mode: "update" after confirmed cleanup. Pair with axe-core runtime checks before claiming a11y conformance.';
  }
  const first = firstNewFinding(newFiles);
  const noun = newCount === 1 ? "violation" : "violations";
  if (first === null) {
    return `${newCount} new ${noun} not in the baseline.`;
  }
  return `${newCount} new ${noun} not in the baseline. Start with ${first.path}:${first.line} (rule \`${first.ruleId}\`) — call \`suggest_fix\` for a concrete patch.`;
}

function buildEmptyFilesResponse(args: {
  baseline: BaselineFile;
  baselinePath: string;
  cwd: string;
  mode: string;
}): Record<string, unknown> {
  const { baseline, baselinePath, cwd, mode } = args;
  return {
    mode: "diff",
    baselinePath,
    baselineCount: baseline.violations.length,
    baselineGeneratedAt: baseline.generatedAt,
    newCount: 0,
    newViolations: [],
    meta: {
      filesScanned: 0,
      scannedRoot: cwd,
      scanMode: mode,
      baselineVersion: baseline.version,
    },
    nextStep:
      "No parseable files were scanned — diff is vacuously empty. Verify `cwd` points at the project root and `changedOnly` / `since` aren't over-narrowing.",
  };
}
