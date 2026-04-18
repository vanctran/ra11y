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
  type BaselineEntry,
  type BaselineFile,
  loadBaseline,
} from "../engine/baseline.ts";
import {
  filesChangedSince,
  getChangedHunks,
  gitRoot,
  type HunkRange,
  isInsideHunk,
  stagedFiles,
} from "../utils/git.ts";
import { logger } from "../utils/logger.ts";
import {
  buildReferenceGuide,
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
      'Scan the project and return the subset of violations that represents "what changed" — by default, the delta against a baseline snapshot (the regression-focused cousin of `baseline` mode: "check"). Pass `hunksOnly: true` to switch to git-hunk-intersection mode: only findings whose line falls inside a `git diff --unified=0 <comparisonRef>` hunk surface, making this the right primitive for PR-review agents gating on "did this PR introduce a finding?"\n\nBaseline mode (default): the baseline file defaults to `.ra11y-baseline.json` in `cwd`. Override with `baselinePath` (absolute, or cwd-relative). Missing / malformed / version-mismatched files come back as a structured error — generate one with `baseline` (mode: "create") first. The response surfaces `resolved` (baseline entries absent from the current scan — i.e. findings you fixed) alongside `newViolations`, so a PR cleaning up a baselined issue is visible and a re-regression can be distinguished from new debt.\n\nHunks mode (`hunksOnly: true`): baseline loading is skipped; the comparison is against `comparisonRef` (default `HEAD`). Not-a-git-repo and unknown-ref conditions surface as structured error envelopes; a ref that resolves but produces no hunks surfaces as `warnings: ["no_hunks_in_comparison"]` with zero findings (honest: the comparison was a no-op, not a clean scan). The `resolved` field is omitted entirely in this mode — the concept doesn\'t apply without a baseline.\n\nFull scan telemetry (`activeNativeWrappers`, `rulesEvaluated`, `analysisCoverage`, per-extension file counts) rides along so you can judge whether the scan had teeth before acting on the delta. Narrow the scan scope with `changedOnly: true` or `since: "main"`. `additionalPaths` bypasses `.gitignore` / default build-dir skips to include post-compile CSS/HTML.',
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
        hunksOnly: {
          type: "boolean",
          description:
            'When true, skip the baseline entirely and filter findings to those whose `line` falls inside a `git diff --unified=0 <comparisonRef>` hunk. The right primitive for PR-review agents: "did this change introduce a finding?" rather than "is this finding in the snapshot?". Baseline-mode remains the default when false/omitted.',
        },
        comparisonRef: {
          type: "string",
          description:
            "Git ref to diff against in hunks mode (default `HEAD`). Use `main`, `origin/main`, `HEAD~1`, a commit SHA, etc. Ignored unless `hunksOnly: true`.",
        },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  handler(params, session) {
    const explicitCwd = strParam(params, "cwd");
    const spawnCwd = process.cwd();
    const cwd = explicitCwd ?? gitRoot(spawnCwd) ?? spawnCwd;
    const hunksOnly = params["hunksOnly"] === true;
    if (hunksOnly) return handleHunksMode(params, session, cwd);
    return handleBaselineMode(params, session, cwd);
  },
};

/**
 * Baseline mode — the original `scan_diff` behavior, preserved as the
 * default. Loads a baseline snapshot and returns findings whose
 * `findingId` isn't in that snapshot, plus the set of baseline entries
 * whose `findingId` is no longer present in the scan (resolved).
 */
async function handleBaselineMode(
  params: Record<string, unknown>,
  session: import("./session.ts").McpSession,
  cwd: string,
) {
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
  const { newFiles, newCount, scannedHashes } = filterToNewFindings(
    formatted.files,
    baselineHashes,
  );
  const resolved = resolvedFromBaseline(baseline.violations, scannedHashes);

  const referenceGuide = buildReferenceGuide(newFiles);
  return textResult({
    mode: "diff",
    baselinePath,
    baselineCount: baseline.violations.length,
    baselineGeneratedAt: baseline.generatedAt,
    newCount,
    newViolations: newFiles,
    // Surface "new" and "resolved" as two independent top-level
    // counters so an agent can distinguish new debt from regressions
    // fixed without a composite counter papering over the two
    // concepts. Both stay emitted even at zero in baseline mode —
    // "this scan fixed nothing" is a meaningful signal in the baseline
    // framing. In hunks mode the concept doesn't apply, and the field
    // is omitted entirely (see handleHunksMode).
    resolvedCount: resolved.length,
    resolved,
    ...(referenceGuide === undefined ? {} : { referenceGuide }),
    meta: {
      ...formatted.meta,
      scannedRoot: cwd,
      scanMode: describeMode(params),
      configSource: projectConfig.sourcePath,
      baselineVersion: baseline.version,
    },
    nextStep: buildNextStep(newCount, newFiles, resolved.length),
  });
}

/** Default comparison ref for hunks mode when the caller omits `comparisonRef`. */
const DEFAULT_COMPARISON_REF = "HEAD";

/**
 * Hunks mode — filter findings to those whose `(filePath, line)` falls
 * inside a `git diff --unified=0 <ref>` hunk for the comparison ref.
 * No baseline is loaded. Structured errors cover not-a-git-repo and
 * unknown-ref; a ref that resolves to no hunks surfaces as a soft
 * `warnings: ["no_hunks_in_comparison"]` so zero findings aren't
 * mistaken for a clean scan.
 */
async function handleHunksMode(
  params: Record<string, unknown>,
  session: import("./session.ts").McpSession,
  cwd: string,
) {
  const comparisonRef = strParam(params, "comparisonRef") ?? DEFAULT_COMPARISON_REF;
  const hunksResult = getChangedHunks(comparisonRef, cwd);
  if (hunksResult.status === "not-a-git-repo") {
    return errorResult({
      code: "not-a-git-repo",
      message: `hunksOnly mode requires a git repository — \`${cwd}\` is not inside one.`,
      details: { cwd },
      remediation:
        "Run scan_diff with hunksOnly from inside a git checkout, or drop hunksOnly to use baseline mode.",
    });
  }
  if (hunksResult.status === "unknown-ref") {
    return errorResult({
      code: "unknown-ref",
      message: `Comparison ref \`${comparisonRef}\` does not resolve in the git repo at \`${cwd}\`.`,
      details: { cwd, comparisonRef },
      remediation:
        "Pass an existing ref via `comparisonRef` (e.g. `main`, `HEAD~1`, a commit SHA). Fetch the remote first if you're comparing against an origin branch.",
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

  const hunksByFile =
    hunksResult.status === "ok"
      ? hunksResult.hunksByFile
      : (new Map<string, readonly HunkRange[]>() as ReadonlyMap<string, readonly HunkRange[]>);
  const noHunksWarning =
    hunksResult.status === "no-hunks" ? { warnings: ["no_hunks_in_comparison"] as const } : {};

  if (files.length === 0) {
    return textResult({
      mode: "diff",
      newCount: 0,
      newViolations: [],
      ...noHunksWarning,
      meta: {
        filesScanned: 0,
        scannedRoot: cwd,
        scanMode: "hunks",
        comparisonRef,
        configSource: projectConfig.sourcePath,
      },
      nextStep:
        "No parseable files were scanned — hunk diff is vacuously empty. Verify `cwd` points at the project root.",
    });
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
  logger.debug(`scan_diff (hunks): ${files.length} files in ${ms(t0)}ms`);

  const { newFiles, newCount } = filterToHunkFindings(formatted.files, hunksByFile);
  const referenceGuide = buildReferenceGuide(newFiles);

  return textResult({
    mode: "diff",
    newCount,
    newViolations: newFiles,
    ...noHunksWarning,
    ...(referenceGuide === undefined ? {} : { referenceGuide }),
    meta: {
      ...formatted.meta,
      scannedRoot: cwd,
      scanMode: "hunks",
      comparisonRef,
      configSource: projectConfig.sourcePath,
    },
    nextStep: buildHunkNextStep(newCount, newFiles, comparisonRef, hunksResult.status),
  });
}

/**
 * Walks formatted files and keeps only findings whose `line` falls
 * inside a hunk range for that file. Mirrors `filterToNewFindings` but
 * intersects by hunk instead of by baseline hash.
 */
function filterToHunkFindings(
  files: ScanFormatted["files"],
  hunksByFile: ReadonlyMap<string, readonly HunkRange[]>,
): {
  readonly newFiles: ScanFormatted["files"];
  readonly newCount: number;
} {
  type FileEntry = ScanFormatted["files"][number];
  type Finding = FileEntry["findings"][number];
  const newFiles: FileEntry[] = [];
  let newCount = 0;
  for (const file of files) {
    const kept: Finding[] = [];
    for (const finding of file.findings) {
      if (!isInsideHunk(file.path, finding.line, hunksByFile)) continue;
      kept.push(finding);
    }
    if (kept.length > 0) {
      newFiles.push({ path: file.path, findings: kept });
      newCount += kept.length;
    }
  }
  return { newFiles, newCount };
}

function buildHunkNextStep(
  newCount: number,
  newFiles: readonly { readonly path: string; readonly findings: readonly unknown[] }[],
  comparisonRef: string,
  status: "ok" | "no-hunks",
): string {
  if (status === "no-hunks") {
    return `Comparison ref \`${comparisonRef}\` resolved but produced no hunks — nothing changed vs that ref. Check \`warnings\` for the signal; this is not a clean-scan result.`;
  }
  if (newCount === 0) {
    return `No findings inside the hunks for \`${comparisonRef}\`. The PR didn't introduce a violation the scanner can detect statically — pair with runtime axe-core checks before claiming conformance.`;
  }
  const first = firstNewFinding(newFiles);
  const noun = newCount === 1 ? "finding" : "findings";
  if (first === null) {
    return `${newCount} ${noun} inside hunks for \`${comparisonRef}\`.`;
  }
  return `${newCount} ${noun} inside hunks for \`${comparisonRef}\`. Start with ${first.path}:${first.line} (rule \`${first.ruleId}\`) — call \`suggest_fix\` for a concrete patch.`;
}

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
 * only findings whose `findingId` isn't already in the baseline. Uses
 * the scanner-stamped `findingId` directly — no reconstruction needed
 * because `buildAgentFinding` surfaces the same token the baseline file
 * keyed on when it was written. Returns the filtered files (path +
 * findings), the total new-finding count, and the set of every
 * `findingId` the scan produced — the caller intersects that set with
 * the baseline to compute which baseline entries are now resolved.
 */
function filterToNewFindings(
  files: ScanFormatted["files"],
  baselineHashes: ReadonlySet<string>,
): {
  readonly newFiles: { readonly path: string; readonly findings: readonly unknown[] }[];
  readonly newCount: number;
  readonly scannedHashes: ReadonlySet<string>;
} {
  const newFiles: { readonly path: string; readonly findings: readonly unknown[] }[] = [];
  let newCount = 0;
  const scannedHashes = new Set<string>();
  for (const file of files) {
    const kept: unknown[] = [];
    for (const raw of file.findings) {
      const hash = hashOfFormattedFinding(raw);
      if (hash === null) continue;
      scannedHashes.add(hash);
      if (baselineHashes.has(hash)) continue;
      kept.push(raw);
    }
    if (kept.length > 0) {
      newFiles.push({ path: file.path, findings: kept });
      newCount += kept.length;
    }
  }
  return { newFiles, newCount, scannedHashes };
}

/**
 * A baseline entry whose fingerprint hash no longer appears in the
 * current scan — a violation that was previously grandfathered in but
 * has since been fixed (or moved out of scope). Surfaced on `scan_diff`
 * baseline mode so a PR that fixes a baselined issue shows visible
 * progress and an agent can distinguish "new debt" from "re-regression
 * of a previously-resolved item."
 *
 * Shape mirrors the baseline entry's identifying fields (minus the
 * opaque `hash`). Line numbers aren't carried by baseline entries —
 * baselines key on the line-drift-resilient `findingId`, not a raw
 * line — so `line` is not part of this type. Matches the shape already
 * surfaced by `baseline` mode: "check" (`resolvedEntries`) so agents
 * get the same identity fields from either tool.
 */
export interface ResolvedFinding {
  readonly filePath: string;
  readonly ruleId: string;
  readonly message: string;
}

/**
 * Computes the resolved set: baseline entries whose fingerprint hash
 * does not appear in the set of `findingId`s produced by the current
 * scan. Preserves baseline-file order for stable output across runs.
 */
function resolvedFromBaseline(
  baselineEntries: readonly BaselineEntry[],
  scannedHashes: ReadonlySet<string>,
): readonly ResolvedFinding[] {
  const out: ResolvedFinding[] = [];
  for (const entry of baselineEntries) {
    if (scannedHashes.has(entry.hash)) continue;
    out.push({ filePath: entry.filePath, ruleId: entry.ruleId, message: entry.message });
  }
  return out;
}

function hashOfFormattedFinding(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const findingId = f["findingId"];
  if (typeof findingId === "string" && findingId.length > 0) return findingId;
  return null;
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
  resolvedCount: number,
): string {
  if (newCount === 0) {
    if (resolvedCount > 0) {
      const noun = resolvedCount === 1 ? "entry" : "entries";
      return `No new violations versus the baseline — and ${resolvedCount} baseline ${noun} no longer appear in the scan (resolved). Run \`baseline\` with mode: "update" to prune the resolved ${noun} from the snapshot, then recommit. Pair with axe-core runtime checks before claiming a11y conformance.`;
    }
    return 'No new violations versus the baseline. If you expected regressions here, double-check the baseline is current — run `baseline` with mode: "update" after confirmed cleanup. Pair with axe-core runtime checks before claiming a11y conformance.';
  }
  const first = firstNewFinding(newFiles);
  const noun = newCount === 1 ? "violation" : "violations";
  const resolvedHint =
    resolvedCount > 0
      ? ` ${resolvedCount} baseline ${resolvedCount === 1 ? "entry is" : "entries are"} resolved — run \`baseline\` with mode: "update" once the new ${noun} are fixed to prune them.`
      : "";
  if (first === null) {
    return `${newCount} new ${noun} not in the baseline.${resolvedHint}`;
  }
  return `${newCount} new ${noun} not in the baseline. Start with ${first.path}:${first.line} (rule \`${first.ruleId}\`) — call \`suggest_fix\` for a concrete patch.${resolvedHint}`;
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
    // Zero files scanned → no scan took place. We deliberately report
    // `resolved: []` / `resolvedCount: 0` rather than the literal
    // "every baseline entry is resolved" that an unguarded intersection
    // would produce — nothing was actually resolved because nothing was
    // scanned. Kept explicit (not conditionally spread) because the
    // fields remain meaningful in baseline mode even at zero.
    resolvedCount: 0,
    resolved: [],
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
