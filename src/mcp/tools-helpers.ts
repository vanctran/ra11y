/**
 * Shared helpers for MCP tool handlers — param extraction, result
 * construction, scanner adapters, and finding formatting.
 *
 * Kept separate from tools.ts so the tool-definition file stays focused
 * on tool schemas and handler logic.
 */

import { isAbsolute, resolve } from "node:path";
import { type ParsedFile, runScan } from "../engine/scanner.ts";
import { discoverExplicitPaths, discoverFiles } from "../input/discover.ts";
import {
  type AgentFinding,
  buildAgentFinding,
  countFixes,
} from "../output/agent-response/index.ts";
import { BUILTIN_CANDIDATE_FINDERS } from "../review/index.ts";
import { BUILTIN_RULES } from "../rules/index.ts";
import { BUILTIN_STANDARDS } from "../standards/index.ts";
import type { Rule } from "../types/rule.ts";
import type { Standard } from "../types/standard.ts";
import type { Violation } from "../types/violation.ts";
import { buildAnalysisCoverage } from "./analysis-coverage.ts";
import { detectApplicability, isLikelyIrrelevant } from "./manual-applicability.ts";
import { buildPlanSummary } from "./plan-summary.ts";
import { buildReferenceGuide } from "./reference-guide.ts";
import { buildRuleCoverageDerivative } from "./rule-coverage-derivative.ts";
import type { McpSession } from "./session.ts";
import { suppressionAudit, suppressionsMetaBlock } from "./suppression-audit.ts";
import { nameMatchesAnyWrapper } from "./wrapper-matcher.ts";
import {
  type NativeWrapperSources,
  resolveUnusedWrappers,
  resolveWrapperSources,
  wrappersMetaBlock,
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
  | "audit-sub-tool-unparseable";

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
  allowWrite?: boolean;
}

export function buildConfigureOpts(params: Record<string, unknown>): ConfigureOpts {
  const opts: ConfigureOpts = {};
  const standard = strParam(params, "standard");
  const level = strParam(params, "level") as "A" | "AA" | "AAA" | undefined;
  const exclude = strArrayParam(params, "exclude");
  const rules = readRuleSettings(params);
  const nativeWrappers = strArrayParam(params, "nativeWrappers");
  const allowWrite = params["allowWrite"];
  if (standard !== undefined) opts.standard = standard;
  if (level !== undefined) opts.level = level;
  if (exclude !== undefined) opts.exclude = exclude;
  if (rules !== undefined) opts.rules = rules;
  if (nativeWrappers !== undefined) opts.nativeWrappers = nativeWrappers;
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
  const { result, report } = runScan({
    standards: BUILTIN_STANDARDS,
    rules: activeRules,
    enabled,
    files,
    finders: BUILTIN_CANDIDATE_FINDERS,
    level: session.config.level,
  });

  const {
    wrappers,
    sessionOnly,
    bySource: wrapperProvenance,
  } = resolveWrapperSources(wrapperSources, session);
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
  const ruleCoverageDerivative = buildRuleCoverageDerivative(result.perRuleCoverage, filtered);
  const formatted: ScanFormatted = {
    plan: {
      totalFindings: filtered.length,
      violations: violations.length,
      notes: notes.length,
      // Split mechanical edits from prose-only guidance so an agent can
      // size batch-apply work separately from copy-rewrite routing. Both
      // keys are omitted when zero (CLAUDE.md §1 "Ambiguous field shapes
      // are dishonest" — don't emit `: 0` as data-vs-absent).
      ...(mechanicalEdits > 0 ? { mechanicalEditsAvailable: mechanicalEdits } : {}),
      ...(guidanceFixes > 0 ? { guidanceFixesAvailable: guidanceFixes } : {}),
      // Rule-level violations with no suggestion at all — distinct from
      // the manual-review counters below, which count WCAG criteria
      // static analysis can't evaluate. Omitted when zero so a clean
      // scan doesn't pair it visually with the manual counters.
      ...(violationsWithoutAnyFix > 0
        ? { violationsWithoutSuggestion: violationsWithoutAnyFix }
        : {}),
      // Actionable manual-review items come first so the summary and the
      // plan object agree on what agents should budget against: grounded
      // candidates with file:line, NOT the inflated composite that used
      // to lead.
      actionableManualItems: actionableManual,
      // Bare-criterion prompts — applicable manual criteria the finders
      // could not ground in code. Agents can dismiss most of these in
      // one read; keeping them as their own top-level count (not a
      // sub-field of a composite) is the honest shape.
      untargetedCriteria,
      // Structured out-of-scope checks. Emitted on EVERY scan (P2-N) —
      // not just clean ones — so an agent inspecting a mixed-result
      // response can't overclaim conformance on the strength of a few
      // findings. Pairing with the MCP server-instructions text is
      // deliberate: the structured field is the authoritative source
      // for agents; the prose is for humans.
      limitations: [
        "Runtime-only checks (focus traps, live regions, ARIA state updates, post-render color contrast) were not performed — pair with axe-core in Playwright/Vitest for the runtime half.",
        "Static analysis can prove failure but not conformance: a clean scan is necessary, not sufficient. Do not claim WCAG conformance on this result alone.",
      ],
      summary: buildPlanSummary({
        violations: violations.length,
        notes: notes.length,
        mechanicalEdits,
        guidanceFixes,
        actionableManual,
        untargetedCriteria,
      }),
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
      ...wrappersMetaBlock({ sessionOnly, unusedWrappers, wrapperProvenance }),
      // Honest meta about what static analysis couldn't reach, so the
      // agent can calibrate confidence in "automated clean." Each entry
      // is a structural gap, not a heuristic guess — the fields are
      // empty/omitted when there's nothing to report.
      ...buildAnalysisCoverage(
        files,
        wrappers,
        activeRules,
        verboseMeta,
        wrapperProvenance.fromAutoDetect.confirmed.length,
      ),
      // Audit trail for every in-source `ra11y-disable` pragma the scan
      // encountered, with the captured reason text when supplied. Keeps
      // suppressions visible and accountable — an agent reviewing a
      // clean scan can see where silence was bought. Omitted when no
      // pragmas exist in any scanned file.
      ...suppressionsMetaBlock(suppressions),
      // Per-rule evaluation telemetry: for each active rule with an
      // extension gate, how many eligible files existed and how many
      // actually ran. Low-confidence rows carry a `reason` +
      // `remediation` so an agent can act on the gap (canonical case:
      // Tailwind pre-build where `contrast/minimum` runs on 0 eligible
      // CSS files and the headline 0 findings is meaningless without
      // this context). Omitted when the array is empty so clean scans
      // on non-extension-gated rule sets don't ship an empty field.
      ...(result.perRuleCoverage.length > 0 ? { perRuleCoverage: result.perRuleCoverage } : {}),
    },
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
