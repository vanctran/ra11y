/**
 * Shared helpers for MCP tool handlers — param extraction, result
 * construction, scanner adapters, and finding formatting.
 *
 * Kept separate from tools.ts so the tool-definition file stays focused
 * on tool schemas and handler logic.
 */

import { isAbsolute, resolve } from "node:path";
import { readAttestations } from "../config/attestation-store.ts";
import { CriteriaRegistry } from "../engine/registry/criteria.ts";
import { RulesRegistry } from "../engine/registry/rules.ts";
import { type ParsedFile, runScan } from "../engine/scanner.ts";
import { discoverExplicitPaths, discoverFiles } from "../input/discover.ts";
import {
  type AgentFinding,
  buildAgentFinding,
  countFixes,
} from "../output/agent-response/index.ts";
import { BUILTIN_RULES } from "../rules/index.ts";
import { BUILTIN_STANDARDS } from "../standards/index.ts";
import type { Rule } from "../types/rule.ts";
import type { Standard } from "../types/standard.ts";
import type { Violation } from "../types/violation.ts";
import { detectApplicability, isLikelyIrrelevant } from "./manual-applicability.ts";
import { buildReferenceGuide } from "./reference-guide.ts";
import { buildRuleCoverageDerivative } from "./rule-coverage-derivative.ts";
import { buildScanMeta, buildScanPlan } from "./scan-assembly.ts";
import type { McpSession } from "./session.ts";
import { suppressionAudit } from "./suppression-audit.ts";
import { nameMatchesAnyWrapper } from "./wrapper-matcher.ts";
import {
  buildRunScanOptions,
  type NativeWrapperSources,
  resolveUnusedWrappers,
  resolveWrapperSources,
} from "./wrappers-meta.ts";

export { buildAnalysisCoverage } from "./analysis-coverage.ts";
export type { NativeWrapperSources } from "./wrappers-meta.ts";

// ─── Tool metadata types ────────────────────────────────────────────────────

export interface McpToolDef {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations?: Record<string, boolean>;
}

export interface McpToolResult {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  readonly structuredContent?: Record<string, unknown>;
  readonly isError?: boolean;
}

/**
 * Stable, ra11y-scoped codes for structured error envelopes. Agents
 * branch on `code` — never on the English `message`. Kebab-case; short;
 * present-tense ("rule-not-found", not "rule was not found"). Add a new
 * value only when an existing code is a genuine semantic mismatch; if
 * you just want a different `message`, leave the code alone and change
 * the message.
 */
export type StructuredErrorCode =
  // shape / shape-level validation of tool params
  | "missing-required-param"
  | "invalid-param"
  // registry lookups
  | "rule-not-found"
  | "standard-not-found"
  | "criterion-not-found"
  // attest: a ruleId was provided that doesn't satisfy the given
  // criterionId. Distinct from rule-not-found — the rule may exist,
  // but it wouldn't contribute to this criterion's coverage so the
  // attestation is nonsensical. See ADR 0013.
  | "rule-not-under-criterion"
  | "mode-invalid"
  // scan/resource IO
  | "file-not-found"
  | "file-unsupported"
  | "file-read-failed"
  | "file-write-failed"
  | "path-escapes-cwd"
  // scan targets that don't exist on disk — distinct from zero-parseable-files,
  // which is a *successful* scan over an empty-but-real directory (handled via
  // the `warnings: ["scanned_zero_files"]` soft-signal path).
  | "cwd-not-found"
  | "scan-paths-not-found"
  // baseline lifecycle
  | "baseline-not-found"
  | "baseline-load-failed"
  // scan scope / git-aware narrowing
  | "no-staged-files"
  // scan_diff hunksOnly: git-shell preconditions for the hunk-
  // intersection comparison. Distinct from `no-staged-files` because
  // they describe different failures — not in a git repo at all, vs.
  // ref doesn't resolve — and the agent branches on them differently.
  | "not-a-git-repo"
  | "unknown-ref"
  // apply_fix safety gates
  | "allow-write-disabled"
  | "edit-shape-invalid"
  | "edit-no-match"
  | "edit-multiple-matches"
  | "edit-introduces-parse-errors"
  // suggest_fix / apply_fix parameter aliasing — raised when both the
  // canonical `file` and the deprecated `filePath` alias are supplied
  // so the caller picks one shape instead of relying on silent
  // precedence (CLAUDE.md §1 "Ambiguous field shapes are dishonest").
  | "conflicting-file-params"
  // meta-tool internal
  | "audit-sub-tool-unparseable"
  // audit meta-tool: one of the sub-handlers rejected instead of
  // returning an McpToolResult. Distinct from -unparseable so agents
  // can tell "handler threw" from "handler answered with garbage."
  | "audit-sub-tool-threw";

/** Structured-error envelope — emitted via `structuredContent` + `isError: true`. */
export interface StructuredError {
  readonly code: StructuredErrorCode;
  readonly message: string;
  readonly details?: Record<string, unknown>;
  readonly remediation?: string;
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

/**
 * Builds an MCP error result. Pass a `StructuredError` to populate
 * `structuredContent` with a machine-consumable shape the agent can
 * branch on by `code` — English `message` stays in `content[0].text`
 * and the legacy `{ error }` field remains so older consumers don't
 * break. The string overload is kept for one-off messages that have
 * no richer context; prefer the structured form for anything an agent
 * might need to discriminate. `isError: true` is always set.
 */
export function errorResult(error: StructuredError | string): McpToolResult {
  if (typeof error === "string") {
    return {
      content: [{ type: "text", text: JSON.stringify({ error }) }],
      isError: true,
    };
  }
  const { code, message, details, remediation } = error;
  // structuredContent: spec-facing machine shape. Agents branch on
  // `code`, read `details` for specifics, surface `remediation` when
  // present.
  const structuredContent: Record<string, unknown> = { code, message };
  if (details !== undefined) structuredContent["details"] = details;
  if (remediation !== undefined) structuredContent["remediation"] = remediation;
  // content[0].text: legacy + human-readable payload. Keeps the
  // top-level `error` string so existing tests + consumers that
  // grepped the text path still read something sensible, while
  // exposing the same structured fields alongside it for parity.
  const textPayload: Record<string, unknown> = { error: message, code };
  if (details !== undefined) textPayload["details"] = details;
  if (remediation !== undefined) textPayload["remediation"] = remediation;
  return {
    content: [{ type: "text", text: JSON.stringify(textPayload) }],
    structuredContent,
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

/**
 * Returns the first unknown standard ID in `ids`, or null if every
 * entry resolves. Used by tools that want a structured error envelope
 * naming the bad ID rather than scanning with an empty enabled list
 * (which silently zeroes every criterion count).
 */
export function firstUnknownStandard(ids: readonly string[]): string | null {
  const known = new Set(BUILTIN_STANDARDS.map((s) => s.id));
  return ids.find((id) => !known.has(id)) ?? null;
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
 *
 * `options.includeStoryFiles` flips the Storybook-story unfilter in
 * `discoverFiles`. `scan_project` passes `true` when the project
 * config sets `preset: "storybook"`, so `*.stories.*` and
 * `stories/**` reach the scanner alongside the framework-aware
 * transparency applied downstream.
 */
export async function parseFiles(
  paths: readonly string[],
  session: McpSession,
  cwd?: string,
  options: { readonly includeStoryFiles?: boolean } = {},
): Promise<readonly ParsedFile[]> {
  const base = cwd ?? process.cwd();
  const absPaths = paths.map((p) => (isAbsolute(p) ? p : resolve(base, p)));
  const discovered = await discoverFiles(absPaths, {
    excludes: session.config.exclude,
    ...(options.includeStoryFiles === true ? { includeStoryFiles: true } : {}),
  });
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
  /**
   * Wrapper → native-element map. Mirrors
   * `LoadedConfig.nativeWrapperElements` on the file-loaded side so the
   * object form of `Config.nativeWrappers` can round-trip through MCP.
   */
  nativeWrapperElements?: Readonly<Record<string, string>>;
  allowWrite?: boolean;
}

/**
 * Reads the `nativeWrappers` param in either the flat array form
 * (`["Button", "Link"]`) or the flat object form
 * (`{ Button: "button", Link: "a" }`). Returns a split tuple so the
 * session `configure()` call receives each branch through its own
 * typed channel (names accumulate into `nativeWrappers`; the element
 * map populates `nativeWrapperElements`). The nested `NativeWrapperMap`
 * form accepted on the file-loader side is deliberately NOT parsed
 * here — nesting is compile-time ergonomics for authors editing a
 * config file, not a shape MCP callers need to emit. Agents with a
 * compound-component map flatten the dotted keys themselves, which
 * keeps the MCP schema flat and unambiguous.
 */
function readNativeWrappersParam(params: Record<string, unknown>): {
  readonly names?: readonly string[];
  readonly elements?: Readonly<Record<string, string>>;
} {
  const raw = params["nativeWrappers"];
  if (raw === undefined) return {};
  if (Array.isArray(raw)) {
    return { names: raw.filter((v): v is string => typeof v === "string") };
  }
  if (typeof raw === "object" && raw !== null) {
    const elements: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === "string") elements[key] = value;
    }
    return { names: Object.keys(elements), elements };
  }
  return {};
}

export function buildConfigureOpts(params: Record<string, unknown>): ConfigureOpts {
  const opts: ConfigureOpts = {};
  const standard = strParam(params, "standard");
  const level = strParam(params, "level") as "A" | "AA" | "AAA" | undefined;
  const exclude = strArrayParam(params, "exclude");
  const rules = readRuleSettings(params);
  const { names: nativeWrappers, elements: nativeWrapperElements } =
    readNativeWrappersParam(params);
  const allowWrite = params["allowWrite"];
  if (standard !== undefined) opts.standard = standard;
  if (level !== undefined) opts.level = level;
  if (exclude !== undefined) opts.exclude = exclude;
  if (rules !== undefined) opts.rules = rules;
  if (nativeWrappers !== undefined) opts.nativeWrappers = nativeWrappers;
  if (nativeWrapperElements !== undefined) opts.nativeWrapperElements = nativeWrapperElements;
  if (typeof allowWrite === "boolean") opts.allowWrite = allowWrite;
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
  readonly files: readonly { readonly path: string; readonly findings: AgentFinding[] }[];
  readonly meta: Record<string, unknown>;
  /**
   * Top-level prose map — findings reference by file extension rather than
   * inlining the same paragraph on every entry. Omitted when no findings
   * exist (so a clean scan ships neither the map nor the keys); populated
   * only with the extensions actually present in `files`.
   *
   * Keys are file extensions without the leading dot (`tsx`, `css`, etc.).
   * The `default` key covers extensions that don't have a language-specific
   * placement variant — today that's `.ts` / `.js` / anything else.
   */
  readonly referenceGuide?: {
    readonly suppressPlacement: Readonly<Record<string, string>>;
  };
  /**
   * Top-level split of rule IDs into "0 findings with high-confidence
   * coverage" vs "0 findings with low-confidence coverage" — derived
   * from `meta.perRuleCoverage`. Lets agents branch on "trust the clean
   * tally for this rule" vs "scan didn't see any eligible sources,
   * retry with `additionalPaths`" without walking the per-rule rows.
   *
   * Only populated when at least one rule produced 0 findings —
   * omitted entirely on already-flagged scans (CLAUDE.md §1 "Ambiguous
   * field shapes are dishonest"). See
   * `src/mcp/rule-coverage-derivative.ts`.
   */
  readonly ruleCoverage?: {
    readonly confidentlyClean: readonly string[];
    readonly lowConfidenceClean: readonly string[];
  };
}

/**
 * Reads durable attestations from `<cwd>/.ra11y/attestations.jsonl`
 * into the runScan inputs, returning [] when the file is missing or
 * malformed. Exported so every MCP tool that invokes `runScan`
 * directly (coverage, checklist, review_candidates) can call it
 * without re-implementing the soft-fail read.
 */
export async function loadDurableAttestations(
  cwd: string,
): Promise<readonly import("../types/evidence.ts").AttestationRecord[]> {
  try {
    return await readAttestations(cwd);
  } catch {
    return [];
  }
}

/**
 * Runs the scanner against the pre-parsed files and formats the result
 * into the agent-facing shape (plan, files, meta). Factored out so both
 * `scan` and `scan_project` share identical semantics.
 */

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
  // Caller-supplied criterion IDs to exclude. Findings whose entire
  // `criteria` list is contained in this set are dropped; findings
  // that also satisfy an un-skipped criterion stay (the un-skipped
  // coverage is the honest reason to keep them). Empty / undefined
  // leaves the output unchanged. Not suppression by the tool — this
  // is the caller filtering its own result. The `skippedByCaller`
  // meta field surfaces the filter input verbatim.
  skipCriteria?: readonly string[],
  // Resolved `LoadedConfig.preset`. When `"storybook"`, story files
  // scan with framework-aware transparency (Storybook primitives
  // don't inflate the opaque-component count). Undefined = default
  // behavior, story files — if present — scan as plain TSX.
  preset?: import("../types/config.ts").ConfigPreset,
  // Declared process page-sets from `LoadedConfig.processes` (ADR
  // 0016). Threaded to project-scoped finders via
  // `ProjectCandidateContext.processes` so WCAG 3.2.3 / 3.2.4 run
  // against the full page set a scan has in hand. Omitted when the
  // user declared no processes; empty/absent = no process-level
  // evidence, finders emit nothing rather than guess.
  processes?: readonly import("../types/config.ts").Process[],
): Promise<{
  readonly formatted: ScanFormatted;
  readonly durationMs: number;
  readonly filesScanned: number;
  /**
   * Raw review candidates the finders produced, pre-dedup. Exposed so
   * `scan_file` can dedupe by (filePath, line, column, reason) before
   * surfacing them on the response — scan_project doesn't need them
   * individually (it rolls them up into the `actionableManualItems`
   * count) but a per-file tool does.
   */
  readonly reviewCandidates: readonly import("../types/review.ts").ReviewCandidate[];
}> {
  const effective = ruleSettings ?? session.config.rules;
  const activeRules = applyRuleSettings(BUILTIN_RULES, effective);
  const attestations = await loadDurableAttestations(cwd ?? process.cwd());
  const {
    wrappers,
    sessionOnly,
    bySource: wrapperProvenance,
    elements: wrapperElements,
  } = resolveWrapperSources(wrapperSources, session);
  const { result, report, perRuleCoverage } = runScan(
    buildRunScanOptions({
      activeRules,
      enabled,
      files,
      level: session.config.level,
      attestations,
      processes,
      wrapperElements,
    }),
  );
  const { violations: withoutWrapperNoise } = dropWrapperNoise(result.violations, wrappers);
  const unusedWrappers = await resolveUnusedWrappers(wrappers, files, cwd);
  const severityFiltered = filterBySeverity(withoutWrapperNoise, minSeverity);
  const filtered = applyCriterionSkip(severityFiltered, skipCriteria);
  const grouped = groupViolationsByFile(filtered);
  const fileEntries = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, violations]) => ({
      path,
      findings: violations.map((v) => buildAgentFinding(v, { suppressPlacement: "omit" })),
    }));

  const violations = filtered.filter((v) => v.severity !== "info");
  const notes = filtered.filter((v) => v.severity === "info");
  // Honest split counters for the plan headline, computed from the
  // source violations via the shared `countFixes` helper — same recipe
  // the CLI agent formatter uses through `buildAgentPlan`. Both labels
  // are provable from the Violation shape alone (`fixPaths?.primary.
  // edit` present → mechanical; a non-empty `suggestion` without a
  // mechanical edit → guidance), so the split is honest per CLAUDE.md
  // §1 "Composite headline counts are dishonest." Agents budgeting
  // batch-apply vs route-to-rewrite pick the right lane at plan time
  // without a second round-trip.
  const { mechanicalEditsAvailable: mechanicalEdits, guidanceFixesAvailable: guidanceFixes } =
    countFixes(violations);
  const violationsWithoutAnyFix = violations.length - mechanicalEdits - guidanceFixes;

  const manualIds = collectManualCriteria(enabled, session.config.level, files);
  const manualCount = manualIds.size;
  // Actionable = manual criteria that a finder grounded in a concrete
  // file:line. Before the split, `plan.manualReviewRequired` summed
  // grounded candidates and bare-criterion prompts into a single
  // inflated headline (e.g. 21), forcing agents to budget against the
  // bigger number when only the actionable subset (e.g. 5) was real
  // work. Per CLAUDE.md §1 "Composite headline counts are dishonest,"
  // we ship two top-level counters so the budget lands honestly:
  //   - actionableManualItems: candidates with file:line
  //   - untargetedCriteria:    bare-criterion prompts (no grounding)
  const actionableManualIds = new Set<string>();
  for (const c of report.candidates ?? []) {
    if (manualIds.has(c.criterionId)) actionableManualIds.add(c.criterionId);
  }
  const actionableManual = actionableManualIds.size;
  const untargetedCriteria = manualCount - actionableManual;
  const suppressions = suppressionAudit(files);
  const referenceGuide = buildReferenceGuide(fileEntries);
  // Per-rule trust telemetry (Q2R2-RULE-COV). The underlying rows ride
  // in `meta.perRuleCoverage`; the top-level `ruleCoverage` derivative
  // splits the 0-findings rules into "trust the clean tally" vs "scan
  // didn't see any eligible sources" so agents branch on a two-bucket
  // headline rather than walking every row. `filtered` is the
  // post-severity, post-criterion-skip list the consumer actually sees
  // — matching the plan's `totalFindings` so a rule silenced by the
  // session's minSeverity filter reads as "0 findings for this
  // consumer" here too.
  const ruleCoverageDerivative = buildRuleCoverageDerivative(perRuleCoverage, filtered);
  const formatted: ScanFormatted = {
    plan: buildScanPlan({
      totalFindings: filtered.length,
      violations: violations.length,
      notes: notes.length,
      mechanicalEdits,
      guidanceFixes,
      violationsWithoutAnyFix,
      actionableManual,
      untargetedCriteria,
    }),
    files: fileEntries,
    meta: buildScanMeta({
      filesScanned: result.filesScanned,
      files,
      activeRules,
      durationMs: result.durationMs,
      enabledStandards: result.enabledStandards,
      wrappers,
      sessionOnly,
      unusedWrappers,
      wrapperProvenance,
      wrapperElements,
      verboseMeta,
      preset,
      suppressions,
      perRuleCoverage,
    }),
    ...(referenceGuide === undefined ? {} : { referenceGuide }),
    ...(ruleCoverageDerivative === null ? {} : { ruleCoverage: ruleCoverageDerivative }),
  };

  return {
    formatted,
    durationMs: result.durationMs,
    filesScanned: result.filesScanned,
    reviewCandidates: report.candidates ?? [],
  };
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
 * IDs of every built-in rule that satisfies the given criterion, including
 * equivalence closure across loaded standards. Used by MCP tools that need
 * to disclose or validate per-rule coverage claims (see ADR 0013) — the
 * `attest` tool fans a criterion-wide attestation across this set, and
 * validates that explicit `ruleIds` actually satisfy the criterion.
 *
 * Does not apply session rule overrides; an `"off"` rule still satisfies
 * the criterion in principle, and the coverage fan-out reflects the rule
 * surface at check-time, not this call's config.
 */
export function satisfyingRulesForCriterion(criterionId: string): readonly string[] {
  const criteriaReg = new CriteriaRegistry();
  criteriaReg.rebuild(BUILTIN_STANDARDS);
  const rulesReg = new RulesRegistry();
  for (const rule of BUILTIN_RULES) rulesReg.register(rule);
  rulesReg.rebuild(criteriaReg);
  return [...rulesReg.rulesFor(criterionId)].sort();
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
  const filtered = violations.filter((v) => {
    if (v.ruleId !== "keyboard/handler-missing") return true;
    if (v.severity !== "info") return true;
    const match = /^<([A-Z][A-Za-z0-9]*)>/.exec(v.message);
    const name = match?.[1];
    return !(name && nameMatchesAnyWrapper(name, nativeWrappers));
  });
  return { violations: filtered };
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

/**
 * Caller-driven criterion filter. A violation is dropped when every
 * criterion in its `criteria` list appears in `skipCriteria`; otherwise
 * it stays — the un-skipped criteria are the honest reason to keep
 * showing the finding. `undefined` or empty skip list returns the
 * input unchanged. Not suppression by the tool — the caller is
 * filtering its own result.
 */
export function applyCriterionSkip(
  violations: readonly Violation[],
  skipCriteria: readonly string[] | undefined,
): readonly Violation[] {
  if (skipCriteria === undefined || skipCriteria.length === 0) return violations;
  const skip = new Set(skipCriteria);
  return violations.filter((v) => v.criteria.some((c) => !skip.has(c)));
}

// ─── Source context ─────────────────────────────────────────────────────────

export function buildSourceContext(source: string, line: number): string {
  const lines = source.split("\n");
  const contextRadius = 3;
  const start = Math.max(0, line - 1 - contextRadius);
  const end = Math.min(lines.length, line + contextRadius);
  return lines.slice(start, end).join("\n");
}

export { buildReferenceGuide };

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

export { buildPlanSummary, type PlanSummaryArgs } from "./plan-summary.ts";
