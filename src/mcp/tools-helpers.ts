/**
 * Shared helpers for MCP tool handlers — param extraction, result
 * construction, scanner adapters, and finding formatting.
 *
 * Kept separate from tools.ts so the tool-definition file stays focused
 * on tool schemas and handler logic.
 */

import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { parseInlineDisablesDetailed } from "../config/inline-disables.ts";
import { walkJsxElements } from "../engine/ast-helpers.ts";
import type { ParsedFile } from "../engine/scanner.ts";
import { runScan } from "../engine/scanner.ts";
import { discoverExplicitPaths, discoverFiles } from "../input/discover.ts";
import { BUILTIN_CANDIDATE_FINDERS } from "../review/index.ts";
import { BUILTIN_RULES } from "../rules/index.ts";
import { BUILTIN_STANDARDS } from "../standards/index.ts";
import type { Rule } from "../types/rule.ts";
import type { Standard } from "../types/standard.ts";
import type { Violation } from "../types/violation.ts";
import { buildAnalysisCoverage } from "./analysis-coverage.ts";
import { detectApplicability, isLikelyIrrelevant } from "./manual-applicability.ts";
import type { McpSession } from "./session.ts";

export { buildAnalysisCoverage } from "./analysis-coverage.ts";

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
 * Opt-in parse pass that bypasses `.gitignore` and the default ignored
 * build dirs (`dist`, `build`, `out`, …). Used for `scan_project`'s
 * `additionalPaths` so post-compile artifacts (Tailwind/SCSS output,
 * statically-exported HTML) can be scanned on request.
 */
export async function parseExplicitPaths(
  paths: readonly string[],
  session: McpSession,
  cwd?: string,
): Promise<readonly ParsedFile[]> {
  const base = cwd ?? process.cwd();
  const absPaths = paths.map((p) => (isAbsolute(p) ? p : resolve(base, p)));
  const discovered = await discoverExplicitPaths(absPaths, { excludes: session.config.exclude });
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
const LEVEL_ORDER: Readonly<Record<string, number>> = { A: 1, AA: 2, AAA: 3, base: 1 };

function isCountableManual(
  c: { readonly automatable: string; readonly level: string; readonly id: string },
  maxRank: number,
  seen: ReadonlySet<string>,
): boolean {
  if (c.automatable !== "manual") return false;
  if ((LEVEL_ORDER[c.level] ?? 3) > maxRank) return false;
  return !seen.has(c.id);
}

function collectManualCriteria(
  enabledStandardIds: readonly string[],
  maxLevel: "A" | "AA" | "AAA" = "AAA",
  files: readonly ParsedFile[] = [],
): ReadonlySet<string> {
  const enabled = new Set(enabledStandardIds);
  const maxRank = LEVEL_ORDER[maxLevel] ?? 3;
  const applicability = detectApplicability(files);
  const seen = new Set<string>();
  for (const std of BUILTIN_STANDARDS) {
    if (!enabled.has(std.id)) continue;
    for (const c of std.criteria) {
      if (!isCountableManual(c, maxRank, seen)) continue;
      if (isLikelyIrrelevant(c.id, applicability)) continue;
      seen.add(c.id);
    }
  }
  return seen;
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

/**
 * Shape of the scan output used by both `scan` and `plan`.
 *
 * Intentionally does NOT carry a top-level "pass" boolean — every prior
 * variant ("pass", "automatedPass") read as "the app is accessible",
 * which is a claim static analysis can't make. `plan.summary` and the
 * counts in `plan` convey the state without a load-bearing boolean.
 */
export interface ScanFormatted {
  readonly plan: Record<string, unknown>;
  readonly files: readonly { readonly path: string; readonly findings: unknown[] }[];
  readonly meta: Record<string, unknown>;
}

/**
 * Runs the scanner against the pre-parsed files and formats the result
 * into the agent-facing shape (plan, files, meta). Factored out so both
 * `scan` and `scan_project` share identical semantics.
 */
export interface NativeWrapperSources {
  /** From ra11y.config.ts. */
  readonly fromFile: readonly string[];
  /** Added via configure() calls this session. */
  readonly fromSession: readonly string[];
  /**
   * Auto-detected for THIS scan only (e.g. scan_project's
   * `autoDetectWrappers: true`). Tracked separately so the
   * session-override audit (`sessionNativeWrappers` + `sessionOverridesNote`)
   * doesn't mis-attribute them to a stale configure() call. Scan-scoped
   * by contract — never touches session.config.
   */
  readonly fromAutoDetect?: readonly string[];
}

export async function runScanAndFormat(
  files: readonly ParsedFile[],
  session: McpSession,
  enabled: readonly string[],
  minSeverity: string | undefined,
  ruleSettings?: Readonly<Record<string, string>>,
  wrapperSources?: NativeWrapperSources,
  // Optional project root used to widen wrapper-usage detection into
  // excluded paths (stories, dev-tools, tests). Without it, wrappers
  // referenced only from those paths are wrongly reported unused.
  cwd?: string,
  // When true, analysisCoverage includes the actual file paths and
  // component names behind the counts, plus per-extension rule lists so
  // the agent can verify which rules ran on which languages. Gated
  // because these arrays can be large on noisy projects.
  verboseMeta = false,
): Promise<{
  readonly formatted: ScanFormatted;
  readonly durationMs: number;
  readonly filesScanned: number;
}> {
  const effective = ruleSettings ?? session.config.rules;
  const activeRules = applyRuleSettings(BUILTIN_RULES, effective);
  const { result, report } = runScan({
    standards: BUILTIN_STANDARDS,
    rules: activeRules,
    enabled,
    files,
    finders: BUILTIN_CANDIDATE_FINDERS,
    level: session.config.level,
  });

  const { wrappers, sessionOnly } = resolveWrapperSources(wrapperSources, session);
  const { violations: withoutWrapperNoise } = dropWrapperNoise(result.violations, wrappers);
  const unusedWrappers = await resolveUnusedWrappers(wrappers, files, cwd);
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

  const manualIds = collectManualCriteria(enabled, session.config.level, files);
  const manualCount = manualIds.size;
  // Actionable = manual criteria that a finder grounded in a concrete
  // file:line. Without this, scan.plan.manualReviewRequired (all
  // applicable manual criteria) and checklist.actionable (the subset
  // with hits) disagreed by an order of magnitude and forced agents to
  // make a second tool call just to size the real workload.
  const actionableManualIds = new Set<string>();
  for (const c of report.candidates ?? []) {
    if (manualIds.has(c.criterionId)) actionableManualIds.add(c.criterionId);
  }
  const actionableManual = actionableManualIds.size;
  const suppressions = suppressionAudit(files);
  const formatted: ScanFormatted = {
    plan: {
      totalFindings: filtered.length,
      violations: violations.length,
      notes: notes.length,
      ...(fixSuggestions > 0 ? { fixSuggestionAvailable: fixSuggestions } : {}),
      // Rule-level violations with no machine-generated fix suggestion —
      // distinct from plan.manualReviewRequired, which counts WCAG
      // criteria that static analysis can't evaluate at all. Omitted when
      // zero so a clean scan doesn't pair it visually with
      // manualReviewRequired and read as the same number.
      ...(violations.length - fixSuggestions > 0
        ? { violationsWithoutSuggestion: violations.length - fixSuggestions }
        : {}),
      // Manual-review count is visible inline so a clean scan doesn't read
      // as "compliant" — the full picture is "automated clean AND N manual
      // criteria still need human review."
      manualReviewRequired: manualCount,
      // Matches checklist.actionable. The gap between the two (manual -
      // actionable = untargeted WCAG prompts) is the real "size this"
      // signal for agents deciding whether to open the checklist tool.
      actionableManualItems: actionableManual,
      // Structured out-of-scope checks so an agent scanning the response
      // for load-bearing signal can't miss what static analysis didn't
      // cover. Only relevant when the scan is otherwise clean — a noisy
      // scan already has obvious follow-up work.
      ...(violations.length === 0 && notes.length === 0
        ? {
            limitations: [
              "Runtime-only checks (focus traps, live regions, ARIA state updates, post-render color contrast) were not performed — pair with axe-core in Playwright/Vitest for the runtime half.",
              "Static analysis can prove failure but not conformance: a clean scan is necessary, not sufficient. Do not claim WCAG conformance on this result alone.",
            ],
          }
        : {}),
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
      // Semantics ("components treated as native-element wrappers — rules
      // that fire on bare <div onClick> skip these") are documented in the
      // MCP server instructions once per session. The per-response note
      // was 60 words of repeated context tax and has been dropped.
      ...(wrappers.length > 0 ? { activeNativeWrappers: [...wrappers] } : {}),
      // Split visibility: agents editing ra11y.config.ts need to see when
      // a session configure() call is layering extras on top of the file.
      // Without this, an ad-hoc "add Button for this session" persists
      // silently even after the file is edited to remove it.
      ...(sessionOnly.length > 0
        ? {
            sessionNativeWrappers: sessionOnly,
            sessionOverridesNote: `${sessionOnly.length} wrapper${sessionOnly.length === 1 ? "" : "s"} added by this session's configure() call, not in ra11y.config.ts. If you've since removed these from the file, the session additions still apply for this connection — restart the MCP server or call configure() again to sync.`,
          }
        : {}),
      // Surface wrappers registered in config that didn't match any component
      // this run. Helps catch config rot — a renamed/deleted component whose
      // allowlist entry lingers and silently does nothing.
      ...(unusedWrappers.length > 0
        ? {
            unusedNativeWrappers: unusedWrappers,
            unusedNativeWrappersNote: `Components listed in nativeWrappers that weren't found in any scanned or scan-adjacent source file under cwd. Not an error — the component may live in a path the scan never reaches (outside the project root, or under a custom exclude). If the component was renamed or deleted, update or remove the entry in ra11y.config.ts; otherwise ignore.`,
          }
        : {}),
      // Honest meta about what static analysis couldn't reach, so the
      // agent can calibrate confidence in "automated clean." Each entry
      // is a structural gap, not a heuristic guess — the fields are
      // empty/omitted when there's nothing to report.
      ...buildAnalysisCoverage(files, wrappers, activeRules, verboseMeta),
      // Audit trail for every in-source `ra11y-disable` pragma the scan
      // encountered, with the captured reason text when supplied. Keeps
      // suppressions visible and accountable — an agent reviewing a
      // clean scan can see where silence was bought. Omitted when no
      // pragmas exist in any scanned file.
      ...suppressionsMetaBlock(suppressions),
    },
  };

  return { formatted, durationMs: result.durationMs, filesScanned: result.filesScanned };
}

/**
 * Resolves the final wrapper set from the three channels (file, session,
 * auto-detect) and derives the session-only audit list used for the
 * `sessionNativeWrappers` meta warning. Auto-detected wrappers are
 * deliberately excluded from `sessionOnly` — they come from this scan,
 * not a stale configure() call, and flow into their own
 * `autoDetectedWrappers` meta block.
 */
function resolveWrapperSources(
  wrapperSources: NativeWrapperSources | undefined,
  session: McpSession,
): { readonly wrappers: readonly string[]; readonly sessionOnly: readonly string[] } {
  const sources: NativeWrapperSources = wrapperSources ?? {
    fromFile: [],
    fromSession: session.config.nativeWrappers,
  };
  const autoDetect = sources.fromAutoDetect ?? [];
  const wrappers = [...new Set([...sources.fromFile, ...sources.fromSession, ...autoDetect])];
  const sessionOnly = sources.fromSession.filter((w) => !sources.fromFile.includes(w));
  return { wrappers, sessionOnly };
}

function suppressionsMetaBlock(entries: readonly SuppressionAuditEntry[]): Record<string, unknown> {
  if (entries.length === 0) return {};
  return {
    suppressions: entries,
    suppressionsNote:
      "Each in-source `ra11y-disable` pragma found across scanned files. Reasons captured from the optional `: reason` or `-- reason` suffix on the pragma itself — e.g. `// ra11y-disable-next-line contrast/minimum: light text on brand gradient`. Entries without a reason indicate an un-justified suppression the agent should consider replacing or documenting.",
  };
}

interface SuppressionAuditEntry {
  readonly path: string;
  readonly line: number;
  readonly kind: "disable" | "disable-next-line" | "enable";
  readonly ruleIds: readonly string[];
  readonly reason?: string;
}

/**
 * Walks each parsed file's source for `ra11y-disable` pragmas and
 * flattens them into a per-file audit list. The reason-capture path
 * of the pragma parser is used so MCP consumers see both the
 * declaration and the justification (when supplied). Entries without
 * a reason surface as "suppression without a stated reason" — the
 * exact thing an agent reviewing a clean scan should flag for
 * follow-up.
 */
function suppressionAudit(files: readonly ParsedFile[]): readonly SuppressionAuditEntry[] {
  const out: SuppressionAuditEntry[] = [];
  for (const file of files) {
    const { declarations } = parseInlineDisablesDetailed(file.source);
    for (const d of declarations) {
      out.push({
        path: file.filePath,
        line: d.line,
        kind: d.kind,
        ruleIds: d.ruleIds,
        ...(d.reason === undefined ? {} : { reason: d.reason }),
      });
    }
  }
  return out;
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
): { readonly violations: readonly Violation[] } {
  if (nativeWrappers.length === 0) {
    return { violations };
  }
  const allow = new Set(nativeWrappers);
  const filtered = violations.filter((v) => {
    if (v.ruleId !== "keyboard/handler-missing") return true;
    if (v.severity !== "info") return true;
    const match = /^<([A-Z][A-Za-z0-9]*)>/.exec(v.message);
    const name = match?.[1];
    return !(name && allow.has(name));
  });
  return { violations: filtered };
}

/**
 * Returns the wrappers that appear nowhere — neither in the scanned
 * files (AST-level check) nor, when a project root is given, in paths
 * the scanner excluded by default (text-level check). Split out from
 * runScanAndFormat to keep that function's cognitive complexity under
 * the biome limit.
 */
async function resolveUnusedWrappers(
  wrappers: readonly string[],
  files: readonly ParsedFile[],
  cwd: string | undefined,
): Promise<readonly string[]> {
  if (wrappers.length === 0) return [];
  const used = new Set(collectUsedWrappers(files, wrappers));
  const stillCandidate = wrappers.filter((w) => !used.has(w));
  if (cwd && stillCandidate.length > 0) {
    const scanned = new Set(files.map((f) => f.filePath));
    const widened = await findWrappersInExcludedSources(cwd, stillCandidate, scanned);
    for (const name of widened) used.add(name);
  }
  return wrappers.filter((w) => !used.has(w));
}

/**
 * Text-based best-effort search for wrapper usages in files the scan
 * excluded (stories, dev-tools, tests). Matches `<Wrapper ` or `<Wrapper>`
 * or `<Wrapper/>` as a whole-token. Cheap: reads each file once, regex
 * short-circuits on first hit per wrapper.
 *
 * This is a transparency fix, not a correctness-critical signal — a
 * false negative only means we warn about a config entry that isn't
 * actually stale, which is exactly the Leela feedback we're addressing.
 */
async function findWrappersInExcludedSources(
  cwd: string,
  candidates: readonly string[],
  alreadyScanned: ReadonlySet<string>,
): Promise<ReadonlySet<string>> {
  const found = new Set<string>();
  const remaining = new Set(candidates);
  // Re-discover with every default exclusion turned off so we see
  // stories/dev-tools/tests. .gitignore still applies — we don't want
  // to read node_modules or build output.
  const all = await discoverFiles([cwd], { includeTests: true });
  for (const path of all) {
    if (remaining.size === 0) break;
    if (alreadyScanned.has(path)) continue;
    if (!/\.(tsx|jsx|ts|js)$/i.test(path)) continue;
    let source: string;
    try {
      source = await readFile(path, "utf8");
    } catch {
      continue;
    }
    for (const name of remaining) {
      // `<Name` followed by whitespace, `/`, or `>` — avoids matching
      // substrings like `<NameMore>` or `ActionButtonGroup`.
      const pattern = new RegExp(`<${name}(?=[\\s/>])`);
      if (pattern.test(source)) {
        found.add(name);
        remaining.delete(name);
      }
    }
  }
  return found;
}

/**
 * Walks every parsed TSX module for JSX element tag names matching a
 * configured wrapper. A wrapper is "used" the moment it appears as a JSX
 * element anywhere in the scanned source — independent of whether any
 * rule fired against it. Without this, wrappers used with correct props
 * (so keyboard/handler-missing never emits a suppressed info) were
 * wrongly reported unused, pushing users to delete valid config entries.
 */
function collectUsedWrappers(
  files: readonly ParsedFile[],
  nativeWrappers: readonly string[],
): ReadonlySet<string> {
  const allow = new Set(nativeWrappers);
  const used = new Set<string>();
  for (const file of files) {
    if (file.ast.language === "html" || file.ast.language === "css") continue;
    for (const el of walkJsxElements(file.ast.root)) {
      if (allow.has(el.tagName)) used.add(el.tagName);
    }
  }
  return used;
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
