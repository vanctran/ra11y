/**
 * Shared helpers for MCP tool handlers — param extraction, result
 * construction, scanner adapters, and finding formatting.
 *
 * Kept separate from tools.ts so the tool-definition file stays focused
 * on tool schemas and handler logic.
 */

import { isAbsolute, resolve } from "node:path";
import type { ParsedFile } from "../engine/scanner.ts";
import { runScan } from "../engine/scanner.ts";
import { discoverFiles } from "../input/discover.ts";
import { BUILTIN_CANDIDATE_FINDERS } from "../review/index.ts";
import { BUILTIN_RULES } from "../rules/index.ts";
import { BUILTIN_STANDARDS } from "../standards/index.ts";
import type { Rule } from "../types/rule.ts";
import type { Standard } from "../types/standard.ts";
import type { Violation } from "../types/violation.ts";
import type { McpSession } from "./session.ts";

// ─── Tool metadata types ────────────────────────────────────────────────────

export interface McpToolDef {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations?: Record<string, boolean>;
}

export interface McpToolResult {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  readonly isError?: boolean;
}

export type ToolHandler = (
  params: Record<string, unknown>,
  session: McpSession,
) => Promise<McpToolResult> | McpToolResult;

export interface McpTool {
  readonly def: McpToolDef;
  readonly handler: ToolHandler;
}

// ─── Param helpers (bracket access for index-signature safety) ──────────────

export function strParam(params: Record<string, unknown>, key: string): string | undefined {
  const v = params[key];
  return typeof v === "string" ? v : undefined;
}

export function numParam(params: Record<string, unknown>, key: string): number | undefined {
  const v = params[key];
  return typeof v === "number" ? v : undefined;
}

export function strArrayParam(params: Record<string, unknown>, key: string): string[] | undefined {
  const v = params[key];
  return Array.isArray(v) ? (v as string[]) : undefined;
}

// ─── Result builders ────────────────────────────────────────────────────────

export function textResult(data: unknown): McpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

export function errorResult(message: string): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

// ─── Session adapters ───────────────────────────────────────────────────────

export function resolveStandards(
  standardId: string | undefined,
  session: McpSession,
): readonly string[] {
  const id = standardId ?? session.config.standard;
  return id
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function resolveLevel(level: string | undefined, session: McpSession): "A" | "AA" | "AAA" {
  const v = level ?? session.config.level;
  if (v === "A" || v === "AAA") return v;
  return "AA";
}

/**
 * Resolves input paths, discovers files, and parses them. Relative paths
 * resolve against `cwd` if provided — the server's own cwd is fixed at
 * spawn time, which breaks when agents work in git worktrees.
 */
export async function parseFiles(
  paths: readonly string[],
  session: McpSession,
  cwd?: string,
): Promise<readonly ParsedFile[]> {
  const base = cwd ?? process.cwd();
  const absPaths = paths.map((p) => (isAbsolute(p) ? p : resolve(base, p)));
  const discovered = await discoverFiles(absPaths, { excludes: session.config.exclude });
  const parsed: ParsedFile[] = [];
  for (const filePath of discovered) {
    const result = await session.parseFile(filePath, cwd);
    if (result) parsed.push(result);
  }
  return parsed;
}

/**
 * Extracts `{ [ruleId]: "error"|"warning"|"info"|"off" }` from the configure
 * tool's params. Keeps the configure handler pure over its Record input
 * while narrowing to the RuleSetting union.
 */
function readRuleSettings(
  params: Record<string, unknown>,
): Readonly<Record<string, "error" | "warning" | "info" | "off">> | undefined {
  const raw = (params as { rules?: unknown }).rules;
  if (typeof raw !== "object" || raw === null) return undefined;
  const out: Record<string, "error" | "warning" | "info" | "off"> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === "error" || value === "warning" || value === "info" || value === "off") {
      out[key] = value;
    }
  }
  return out;
}

/** Builds the opts object for McpSession.configure from the configure tool's params. */
export interface ConfigureOpts {
  standard?: string;
  level?: "A" | "AA" | "AAA";
  exclude?: readonly string[];
  rules?: Readonly<Record<string, "error" | "warning" | "info" | "off">>;
  nativeWrappers?: readonly string[];
}

export function buildConfigureOpts(params: Record<string, unknown>): ConfigureOpts {
  const opts: ConfigureOpts = {};
  const standard = strParam(params, "standard");
  const level = strParam(params, "level") as "A" | "AA" | "AAA" | undefined;
  const exclude = strArrayParam(params, "exclude");
  const rules = readRuleSettings(params);
  const nativeWrappers = strArrayParam(params, "nativeWrappers");
  if (standard !== undefined) opts.standard = standard;
  if (level !== undefined) opts.level = level;
  if (exclude !== undefined) opts.exclude = exclude;
  if (rules !== undefined) opts.rules = rules;
  if (nativeWrappers !== undefined) opts.nativeWrappers = nativeWrappers;
  return opts;
}

/** Millisecond elapsed since a performance.now() timestamp, formatted. */
export function ms(since: number): string {
  return (performance.now() - since).toFixed(0);
}

/**
 * Counts criteria across the enabled standards that can't be evaluated by
 * static analysis. Shown in scan output so agents don't stop at green —
 * "0 automated findings AND N manual criteria" is the full picture.
 */
function countManualCriteria(enabledStandardIds: readonly string[]): number {
  const enabled = new Set(enabledStandardIds);
  const seen = new Set<string>();
  let count = 0;
  for (const std of BUILTIN_STANDARDS) {
    if (!enabled.has(std.id)) continue;
    for (const c of std.criteria) {
      if (c.automatable !== "manual") continue;
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      count += 1;
    }
  }
  return count;
}

/** Tally parseable files by extension — surfaces coverage gaps at a glance. */
function countByExtension(files: readonly ParsedFile[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const f of files) {
    const dot = f.filePath.lastIndexOf(".");
    const ext = dot === -1 ? "(no-ext)" : f.filePath.slice(dot);
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

// ─── Shared scan+format ─────────────────────────────────────────────────────

/** Shape of the scan output used by both `scan` and `scan_project`. */
export interface ScanFormatted {
  readonly pass: boolean;
  readonly plan: Record<string, unknown>;
  readonly files: readonly { readonly path: string; readonly findings: unknown[] }[];
  readonly meta: Record<string, unknown>;
}

/**
 * Runs the scanner against the pre-parsed files and formats the result
 * into the agent-facing shape (plan, files, meta). Factored out so both
 * `scan` and `scan_project` share identical semantics.
 */
export function runScanAndFormat(
  files: readonly ParsedFile[],
  session: McpSession,
  enabled: readonly string[],
  minSeverity: string | undefined,
  ruleSettings?: Readonly<Record<string, string>>,
  nativeWrappers?: readonly string[],
): {
  readonly formatted: ScanFormatted;
  readonly durationMs: number;
  readonly filesScanned: number;
} {
  const effective = ruleSettings ?? session.config.rules;
  const activeRules = applyRuleSettings(BUILTIN_RULES, effective);
  const { result } = runScan({
    standards: BUILTIN_STANDARDS,
    rules: activeRules,
    enabled,
    files,
    finders: BUILTIN_CANDIDATE_FINDERS,
  });

  const wrappers = nativeWrappers ?? session.config.nativeWrappers;
  const { violations: withoutWrapperNoise, usedWrappers } = dropWrapperNoise(
    result.violations,
    wrappers,
  );
  const unusedWrappers = wrappers.filter((w) => !usedWrappers.has(w));
  const filtered = filterBySeverity(withoutWrapperNoise, minSeverity);
  const grouped = groupViolationsByFile(filtered);
  const fileEntries = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, violations]) => ({
      path,
      findings: violations.map(formatFinding),
    }));

  const violations = filtered.filter((v) => v.severity !== "info");
  const notes = filtered.filter((v) => v.severity === "info");
  const fixSuggestions = violations.filter(
    (v) => typeof v.suggestion === "string" && v.suggestion.length > 0,
  ).length;

  const manualCount = countManualCriteria(enabled);
  const formatted: ScanFormatted = {
    pass: violations.length === 0,
    plan: {
      totalFindings: filtered.length,
      violations: violations.length,
      notes: notes.length,
      fixSuggestionAvailable: fixSuggestions,
      reviewNeeded: violations.length - fixSuggestions,
      // Manual-review count is visible inline so a clean scan doesn't read
      // as "compliant" — the full picture is "automated clean AND N manual
      // criteria still need human review."
      manualReviewRequired: manualCount,
      summary: buildPlanSummary(violations.length, notes.length, fixSuggestions, manualCount),
    },
    files: fileEntries,
    meta: {
      filesScanned: result.filesScanned,
      // Per-extension counts build confidence that the scan actually saw
      // the file types agents expect (e.g., "0 .css scanned" is a red flag
      // if the repo has CSS). Cheap to compute, sorted for determinism.
      filesByExtension: countByExtension(files),
      // Count of rules that actually ran after "off" filtering. Without
      // this, a "pass: true" with no findings is indistinguishable from
      // "no applicable rules matched" — agents need to know whether the
      // scan had teeth.
      rulesEvaluated: activeRules.length,
      durationMs: Math.round(result.durationMs),
      standards: [...result.enabledStandards].sort(),
      ...(wrappers.length > 0 ? { activeNativeWrappers: [...wrappers] } : {}),
      // Surface wrappers registered in config that didn't match any component
      // this run. Helps catch config rot — a renamed/deleted component whose
      // allowlist entry lingers and silently does nothing.
      ...(unusedWrappers.length > 0 ? { unusedNativeWrappers: unusedWrappers } : {}),
    },
  };

  return { formatted, durationMs: result.durationMs, filesScanned: result.filesScanned };
}

/**
 * Applies per-session rule settings: drops rules set to "off" and
 * overrides severity for rules set to "error", "warning", or "info".
 * Mirrors the config-file behavior in runScanCommand.
 */
export function applyRuleSettings(
  rules: readonly Rule[],
  settings: Readonly<Record<string, string>>,
): readonly Rule[] {
  return rules
    .filter((r) => settings[r.id] !== "off")
    .map((r) => {
      const override = settings[r.id];
      if (override === "error" || override === "warning" || override === "info") {
        return { ...r, severity: override };
      }
      return r;
    });
}

// ─── Registry lookups ───────────────────────────────────────────────────────

export function findRule(ruleId: string): Rule | undefined {
  return BUILTIN_RULES.find((r) => r.id === ruleId);
}

export function findStandard(standardId: string): Standard | undefined {
  return BUILTIN_STANDARDS.find((s) => s.id === standardId);
}

/**
 * Drops info-level keyboard/handler-missing findings whose target component
 * is in the allowlist. The rule's message starts with `<ComponentName>`, so
 * we pull the name from the message rather than adding a new Violation field.
 * If the message shape ever drifts, the list stops working — fail-safe: we
 * keep the finding rather than dropping a real bug.
 *
 * Also reports which wrappers actually matched something, so callers can
 * surface stale entries that no longer correspond to any component in the
 * codebase.
 */
function dropWrapperNoise(
  violations: readonly Violation[],
  nativeWrappers: readonly string[],
): { readonly violations: readonly Violation[]; readonly usedWrappers: ReadonlySet<string> } {
  if (nativeWrappers.length === 0) {
    return { violations, usedWrappers: new Set() };
  }
  const allow = new Set(nativeWrappers);
  const used = new Set<string>();
  const filtered = violations.filter((v) => {
    if (v.ruleId !== "keyboard/handler-missing") return true;
    if (v.severity !== "info") return true;
    const match = /^<([A-Z][A-Za-z0-9]*)>/.exec(v.message);
    const name = match?.[1];
    if (name && allow.has(name)) {
      used.add(name);
      return false;
    }
    return true;
  });
  return { violations: filtered, usedWrappers: used };
}

// ─── Severity filtering ─────────────────────────────────────────────────────

const SEVERITY_RANK: Readonly<Record<string, number>> = { error: 3, warning: 2, info: 1 };

export function filterBySeverity(
  violations: readonly Violation[],
  minSeverity: string | undefined,
): readonly Violation[] {
  const minRank = SEVERITY_RANK[minSeverity ?? "info"] ?? 1;
  if (minRank <= 1) return violations;
  return violations.filter((v) => (SEVERITY_RANK[v.severity] ?? 1) >= minRank);
}

// ─── Source context ─────────────────────────────────────────────────────────

export function buildSourceContext(source: string, line: number): string {
  const lines = source.split("\n");
  const contextRadius = 3;
  const start = Math.max(0, line - 1 - contextRadius);
  const end = Math.min(lines.length, line + contextRadius);
  return lines.slice(start, end).join("\n");
}

// ─── Finding formatter ──────────────────────────────────────────────────────

function severityToConfidence(severity: string): "high" | "medium" | "low" {
  if (severity === "error") return "high";
  if (severity === "warning") return "medium";
  return "low";
}

export function formatFinding(v: Violation): Record<string, unknown> {
  return {
    ruleId: v.ruleId,
    severity: v.severity,
    confidence: severityToConfidence(v.severity),
    line: v.location.line,
    column: v.location.column,
    message: v.message,
    ...(v.suggestion ? { fix: v.suggestion } : {}),
    criteria: [...v.criteria],
    suppressWith: suppressPragma(v.location.filePath, v.ruleId),
  };
}

/**
 * Comment syntax depends on the file.
 *
 * For TSX/JSX we emit the JSX-safe `{/* … *\/}` form — a bare `//` line
 * comment is invalid inside a JSX element, which is where most ra11y
 * violations actually live. The `{…}` wrapper is a valid expression
 * both inside JSX and at module scope, so one form works everywhere.
 */
function suppressPragma(filePath: string, ruleId: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".css")) return `/* ra11y-disable-next-line ${ruleId} */`;
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return `<!-- ra11y-disable-next-line ${ruleId} -->`;
  }
  if (lower.endsWith(".tsx") || lower.endsWith(".jsx")) {
    return `{/* ra11y-disable-next-line ${ruleId} */}`;
  }
  return `// ra11y-disable-next-line ${ruleId}`;
}

export function groupViolationsByFile(violations: readonly Violation[]): Map<string, Violation[]> {
  const map = new Map<string, Violation[]>();
  for (const v of violations) {
    const list = map.get(v.location.filePath);
    if (list) {
      list.push(v);
    } else {
      map.set(v.location.filePath, [v]);
    }
  }
  return map;
}

export function buildPlanSummary(
  violations: number,
  notes: number,
  fixSuggestions: number,
  manualReviewRequired = 0,
): string {
  const parts = buildFindingParts(violations, notes, fixSuggestions);
  if (manualReviewRequired > 0) {
    const noun = manualReviewRequired === 1 ? "criterion" : "criteria";
    parts.push(`${manualReviewRequired} WCAG ${noun} still need human review — call \`checklist\``);
  }
  return `${parts.join(". ")}.`;
}

function buildFindingParts(violations: number, notes: number, fixSuggestions: number): string[] {
  if (violations === 0 && notes === 0) return ["No automated findings"];
  const parts: string[] = [];
  if (violations > 0) {
    const fixPart = fixSuggestions > 0 ? ` (${fixSuggestions} with fix suggestions)` : "";
    parts.push(`${violations} violation${violations === 1 ? "" : "s"}${fixPart}`);
  }
  if (notes > 0) parts.push(`${notes} note${notes === 1 ? "" : "s"} to review`);
  return parts;
}
