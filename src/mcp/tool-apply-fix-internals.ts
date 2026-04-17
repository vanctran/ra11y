/**
 * Internals for the `apply_fix` MCP tool — kept separate from
 * `tool-apply-fix.ts` so each file stays under the reviewable-size cap
 * and the main tool file reads as "what this tool does" without
 * drowning in path-validation and delta-diffing helpers.
 *
 * Public from this module: the preflight validator (`preflightValidate`),
 * the post-edit scanner (`runSingleFileScan`), the violation/candidate
 * delta (`computeDelta`), the parse-error envelope builder, the slice
 * formatter, and the `nextStep` string builder.
 *
 * The preflight collapses six guard branches (allowWrite → filePath →
 * cwd-escape → edit shape → extension → search-hit count) into one
 * discriminated union so the handler can early-return via a single
 * `if ("error" in preflight)` check. Each envelope wording is exact
 * because the integration tests grep for it.
 */

import { isAbsolute, relative, resolve } from "node:path";
import { fingerprintOf } from "../engine/baseline.ts";
import type { ParsedFile } from "../engine/scanner.ts";
import { runScan } from "../engine/scanner.ts";
import { parseCss, parseHtml, parseTsx } from "../input/parsers/index.ts";
import { BUILTIN_CANDIDATE_FINDERS } from "../review/index.ts";
import { BUILTIN_STANDARDS } from "../standards/index.ts";
import type { Ast, ParseError } from "../types/ast.ts";
import type { ReviewCandidate } from "../types/review.ts";
import type { Rule } from "../types/rule.ts";
import type { Violation } from "../types/violation.ts";
import type { McpSession } from "./session.ts";
import { errorResult, formatFinding, type McpToolResult, strParam } from "./tools-helpers.ts";

export interface ResolvedEdit {
  readonly oldText: string;
  readonly newText: string;
}

export type Ext = "tsx" | "html" | "css";

export interface SingleFileScan {
  readonly violations: readonly Violation[];
  readonly candidates: readonly ReviewCandidate[];
}

export interface FixDelta {
  readonly resolvedViolations: readonly Violation[];
  readonly newViolations: readonly Violation[];
  readonly resolvedCandidates: readonly ReviewCandidate[];
  readonly newCandidates: readonly ReviewCandidate[];
}

export interface PreflightOk {
  readonly resolved: string;
  readonly cwd: string;
  readonly edit: ResolvedEdit;
  readonly ext: Ext;
  readonly original: ParsedFile;
  readonly dryRun: boolean;
  /**
   * True when the caller supplied the deprecated `filePath` alias
   * instead of the canonical `file` parameter. The handler uses this
   * to add `"deprecated_param_filepath"` to the response's `warnings`
   * array so migrating agents have a concrete signal; silently
   * accepting the alias would reproduce the ambiguous-shape failure
   * mode CLAUDE.md §1 warns against.
   */
  readonly usedDeprecatedAlias: boolean;
}

export type PreflightResult = PreflightOk | { readonly error: McpToolResult };

export interface FilePathParamResult {
  readonly value: string | undefined;
  readonly usedDeprecatedAlias: boolean;
  readonly error: McpToolResult | undefined;
}

/**
 * Reads the canonical `file` parameter, falling back to the deprecated
 * `filePath` alias. Both names cannot be supplied simultaneously —
 * doing so raises a structured error so the caller picks one shape
 * instead of relying on silent precedence.
 */
export function readFilePathParam(params: Record<string, unknown>): FilePathParamResult {
  const canonical = strParam(params, "file");
  const alias = strParam(params, "filePath");
  const canonicalPresent = canonical !== undefined && canonical.length > 0;
  const aliasPresent = alias !== undefined && alias.length > 0;
  if (canonicalPresent && aliasPresent) {
    return {
      value: undefined,
      usedDeprecatedAlias: false,
      error: errorResult({
        code: "conflicting-file-params",
        message:
          "Pass either `file` (canonical) or `filePath` (deprecated alias) — not both. `filePath` is accepted for one release only; prefer `file`.",
        details: { file: canonical, filePath: alias },
        remediation: "Drop `filePath` and send only `file`.",
      }),
    };
  }
  if (canonicalPresent) {
    return { value: canonical, usedDeprecatedAlias: false, error: undefined };
  }
  if (aliasPresent) {
    return { value: alias, usedDeprecatedAlias: true, error: undefined };
  }
  return { value: undefined, usedDeprecatedAlias: false, error: undefined };
}

export async function preflightValidate(
  params: Record<string, unknown>,
  session: McpSession,
): Promise<PreflightResult> {
  if (!session.config.allowWrite) {
    return {
      error: errorResult({
        code: "allow-write-disabled",
        message:
          "apply_fix is disabled: session `allowWrite` flag is false. Call `configure` with `{ allowWrite: true }` to enable write access for this session, then retry. The flag is per-session and off by default so no ra11y tool mutates source without explicit host opt-in.",
        remediation: "Call `configure` with `{ allowWrite: true }`, then retry apply_fix.",
      }),
    };
  }
  const filePathParamResult = readFilePathParam(params);
  if (filePathParamResult.error) {
    return { error: filePathParamResult.error };
  }
  const filePathParam = filePathParamResult.value;
  const usedDeprecatedAlias = filePathParamResult.usedDeprecatedAlias;
  if (!filePathParam || filePathParam.length === 0) {
    return {
      error: errorResult({
        code: "missing-required-param",
        message: "file is required and must be a non-empty string.",
        details: { param: "file" },
      }),
    };
  }
  const cwd = strParam(params, "cwd") ?? process.cwd();
  const resolved = resolveInsideCwd(filePathParam, cwd);
  if (resolved === null) {
    return {
      error: errorResult({
        code: "path-escapes-cwd",
        message: `file '${filePathParam}' escapes cwd '${cwd}'. Every writable path must resolve inside the scan root.`,
        details: { file: filePathParam, cwd },
      }),
    };
  }
  const edit = readEdit(params);
  if (edit === null) {
    return {
      error: errorResult({
        code: "edit-shape-invalid",
        message:
          'edit must be an object with string `oldText` and string `newText` — the shape suggest_fix emits on `kind: "edit"`.',
        remediation: 'Pass `primary.edit` from a `suggest_fix` result whose `kind` is "edit".',
      }),
    };
  }
  const dryRun = params["dryRun"] !== false;
  const ext = extensionOf(resolved);
  if (ext === null) {
    return {
      error: errorResult({
        code: "file-unsupported",
        message: `Unsupported file extension for ${resolved}. apply_fix handles .tsx/.ts/.jsx/.js, .html/.htm, and .css only.`,
        details: { filePath: resolved },
      }),
    };
  }
  const original = await readOriginal(session, resolved, cwd);
  if ("error" in original) return original;
  const matchCount = countOccurrences(original.parsed.source, edit.oldText);
  if (matchCount === 0) {
    return {
      error: errorResult({
        code: "edit-no-match",
        message: `Edit's oldText was not found in ${resolved}. The file may have changed since suggest_fix was called, or oldText has whitespace/quoting that doesn't match. Re-run suggest_fix and retry.`,
        details: { filePath: resolved, matchCount: 0 },
        remediation: "Re-run `suggest_fix` against the current source and retry with its new edit.",
      }),
    };
  }
  if (matchCount > 1) {
    return {
      error: errorResult({
        code: "edit-multiple-matches",
        message: `Edit's oldText matches ${matchCount} locations in ${resolved}. apply_fix requires a unique match so the edit can't silently misapply. Widen oldText with surrounding context from suggest_fix's sourceContext and retry.`,
        details: { filePath: resolved, matchCount },
        remediation:
          "Widen `oldText` with disambiguating context from `suggest_fix.sourceContext` so exactly one match remains.",
      }),
    };
  }
  return { resolved, cwd, edit, ext, original: original.parsed, dryRun, usedDeprecatedAlias };
}

async function readOriginal(
  session: McpSession,
  resolved: string,
  cwd: string,
): Promise<{ readonly parsed: ParsedFile } | { readonly error: McpToolResult }> {
  try {
    const parsed = await session.parseFile(resolved, cwd);
    if (!parsed) {
      return {
        error: errorResult({
          code: "file-unsupported",
          message: `Unsupported or unreadable file: ${resolved}`,
          details: { filePath: resolved },
        }),
      };
    }
    return { parsed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: errorResult({
        code: "file-read-failed",
        message: `Failed to read ${resolved}: ${message}`,
        details: { filePath: resolved, cause: message },
      }),
    };
  }
}

/**
 * Runs the scanner against a single pre-parsed file. Apply_fix scans
 * both the original (from the session cache) and the in-memory
 * post-edit file through this helper so both slices come from an
 * identical rule/finder/level configuration — the delta can be
 * trusted to reflect the edit, not a config drift between passes.
 */
export function runSingleFileScan(
  file: ParsedFile,
  rules: readonly Rule[],
  enabled: readonly string[],
  level: "A" | "AA" | "AAA",
): SingleFileScan {
  const { result, report } = runScan({
    standards: BUILTIN_STANDARDS,
    rules,
    enabled,
    files: [file],
    finders: BUILTIN_CANDIDATE_FINDERS,
    level,
  });
  return {
    violations: result.violations,
    candidates: report.candidates ?? [],
  };
}

export function computeDelta(before: SingleFileScan, after: SingleFileScan): FixDelta {
  const beforeHashes = new Set(before.violations.map(fingerprintViolation));
  const afterHashes = new Set(after.violations.map(fingerprintViolation));
  const resolvedViolations = before.violations.filter(
    (v) => !afterHashes.has(fingerprintViolation(v)),
  );
  const newViolations = after.violations.filter((v) => !beforeHashes.has(fingerprintViolation(v)));
  const beforeCandHashes = new Set(before.candidates.map(fingerprintCandidate));
  const afterCandHashes = new Set(after.candidates.map(fingerprintCandidate));
  const resolvedCandidates = before.candidates.filter(
    (c) => !afterCandHashes.has(fingerprintCandidate(c)),
  );
  const newCandidates = after.candidates.filter(
    (c) => !beforeCandHashes.has(fingerprintCandidate(c)),
  );
  return { resolvedViolations, newViolations, resolvedCandidates, newCandidates };
}

function fingerprintViolation(v: Violation): string {
  return fingerprintOf(v.ruleId, v.location.filePath, v.message);
}

function fingerprintCandidate(c: ReviewCandidate): string {
  return `${c.criterionId}::${c.location.filePath}::${c.reason}`;
}

export function formatSlice(scan: SingleFileScan): Record<string, unknown> {
  return {
    violations: scan.violations.map(formatFinding),
    candidates: scan.candidates.map(formatCandidate),
  };
}

export function formatCandidate(c: ReviewCandidate): Record<string, unknown> {
  return {
    criterionId: c.criterionId,
    line: c.location.line,
    column: c.location.column,
    reason: c.reason,
    ...(c.snippet ? { snippet: c.snippet } : {}),
  };
}

export function parseErrorEnvelope(
  resolved: string,
  errors: readonly ParseError[],
  originalErrorCount: number,
): McpToolResult {
  const firstNew = errors[originalErrorCount] ?? errors[0];
  const msg = firstNew?.message ?? "(no message)";
  const line = firstNew?.position.line ?? 0;
  const column = firstNew?.position.column ?? 0;
  return errorResult({
    code: "edit-introduces-parse-errors",
    message: `Edit would introduce parse errors into ${resolved} — file not written. First new error: "${msg}" at line ${line}, column ${column}.`,
    details: {
      filePath: resolved,
      firstNewError: { message: msg, line, column },
      originalErrorCount,
      newErrorCount: errors.length,
    },
    remediation: "Revise the edit so the post-edit source parses cleanly, then retry.",
  });
}

/**
 * Resolves `filePath` against `cwd` and returns the absolute path only
 * when it stays inside the scan root. Returns null for any traversal
 * attempt: absolute paths outside cwd, or relative paths that climb out
 * via `..`. node:path.relative followed by the `../` prefix check is
 * the honest guard — the `..` check catches the symlink-free common
 * case without pretending to prove anti-symlink safety we can't prove.
 */
function resolveInsideCwd(filePath: string, cwd: string): string | null {
  const absCwd = isAbsolute(cwd) ? cwd : resolve(process.cwd(), cwd);
  const abs = isAbsolute(filePath) ? filePath : resolve(absCwd, filePath);
  const rel = relative(absCwd, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return abs;
}

function readEdit(params: Record<string, unknown>): ResolvedEdit | null {
  const raw = params["edit"];
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const oldText = obj["oldText"];
  const newText = obj["newText"];
  if (typeof oldText !== "string" || typeof newText !== "string") return null;
  if (oldText.length === 0) return null;
  return { oldText, newText };
}

function countOccurrences(source: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = source.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = source.indexOf(needle, idx + needle.length);
  }
  return count;
}

function extensionOf(filePath: string): Ext | null {
  const lower = filePath.toLowerCase();
  if (
    lower.endsWith(".tsx") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".ts") ||
    lower.endsWith(".js")
  ) {
    return "tsx";
  }
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".css")) return "css";
  return null;
}

export function parseFor(ext: Ext, source: string): Ast {
  if (ext === "html") {
    const r = parseHtml(source);
    return { language: "html", root: r.root, errors: r.errors };
  }
  if (ext === "css") {
    const r = parseCss(source);
    return { language: "css", root: r.root, errors: r.errors };
  }
  const r = parseTsx(source);
  return { language: "tsx", root: r.root, errors: r.errors };
}

export function resolveLevelParam(
  level: string | undefined,
  sessionLevel: "A" | "AA" | "AAA",
): "A" | "AA" | "AAA" {
  if (level === "A" || level === "AA" || level === "AAA") return level;
  return sessionLevel;
}

export function buildNextStep(args: {
  applied: boolean;
  dryRun: boolean;
  delta: FixDelta;
  resolved: string;
}): string {
  const { applied, dryRun, delta, resolved } = args;
  const { resolvedViolations, newViolations, newCandidates } = delta;
  if (newViolations.length > 0) return regressionNextStep(newViolations, applied, resolved);
  if (newCandidates.length > 0 && resolvedViolations.length === 0) {
    return candidateOnlyNextStep(applied, newCandidates.length);
  }
  if (resolvedViolations.length === 0) return noDeltaNextStep(applied, dryRun, resolved);
  return resolvedNextStep(resolvedViolations, dryRun, resolved);
}

function regressionNextStep(
  newViolations: readonly Violation[],
  applied: boolean,
  resolved: string,
): string {
  const first = newViolations[0];
  const where = first ? `${first.location.filePath}:${first.location.line}` : resolved;
  const rule = first ? first.ruleId : "unknown";
  const suffix = applied ? "" : " (dry run)";
  const noun = newViolations.length === 1 ? "" : "s";
  return `Fix applied${suffix} but introduced ${newViolations.length} new violation${noun} in ${resolved} — review ${where} (rule \`${rule}\`) before committing.`;
}

function candidateOnlyNextStep(applied: boolean, newCount: number): string {
  const suffix = applied ? " applied" : " (dry run)";
  const noun = newCount === 1 ? "" : "s";
  return `Fix${suffix} but no automated findings resolved; ${newCount} new manual-review candidate${noun} surfaced. Call \`checklist\` to triage before committing.`;
}

function noDeltaNextStep(applied: boolean, dryRun: boolean, resolved: string): string {
  if (applied) {
    return `Edit written to ${resolved} but no violation delta against a fresh scan. Either the edit didn't match a rule-level finding, or suggest_fix's target was already resolved. Re-run \`scan_file\` to confirm.`;
  }
  if (dryRun) {
    return `Dry run of edit against ${resolved} produced no violation delta. Either the edit doesn't resolve a rule-level finding, or the target was already resolved. Flip \`dryRun: false\` only if the intent is confirmed.`;
  }
  return `No violation delta against a fresh scan of ${resolved}.`;
}

function resolvedNextStep(
  resolvedViolations: readonly Violation[],
  dryRun: boolean,
  resolved: string,
): string {
  const rulesList = resolvedViolations
    .slice(0, 3)
    .map((v) => `\`${v.ruleId}\``)
    .join(", ");
  const more = resolvedViolations.length > 3 ? `, +${resolvedViolations.length - 3} more` : "";
  const noun = resolvedViolations.length === 1 ? "" : "s";
  if (dryRun) {
    return `Dry run — ${resolvedViolations.length} violation${noun} would resolve (${rulesList}${more}). Re-call with \`dryRun: false\` to write.`;
  }
  return `Edit written to ${resolved} — ${resolvedViolations.length} violation${noun} resolved (${rulesList}${more}). Commit the change or re-run \`scan\` to double-check.`;
}
