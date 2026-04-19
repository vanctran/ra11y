/**
 * The `coverage` MCP tool. Extracted from tools.ts so the audit
 * meta-tool can import it without creating a cycle — tools.ts also
 * pulls in auditTool, which in turn needs coverageTool. Logic is
 * unchanged from the original inline definition.
 */

import { runScan } from "../engine/scanner.ts";
import { buildCoverageReport } from "../reports/coverage.ts";
import { BUILTIN_CANDIDATE_FINDERS } from "../review/index.ts";
import { BUILTIN_RULES } from "../rules/index.ts";
import { BUILTIN_STANDARDS } from "../standards/index.ts";
import { detectApplicability, splitManualCriteria } from "./manual-applicability.ts";
import { applyMetaCacheMode, metaModeSchema, readMetaMode } from "./meta-cache.ts";
import type { McpSession } from "./session.ts";
import {
  applyRuleSettings,
  errorResult,
  firstUnknownStandard,
  loadDurableAttestations,
  type McpTool,
  parseFiles,
  resolveLevel,
  resolveStandards,
  strArrayParam,
  strParam,
  textResult,
} from "./tools-helpers.ts";
import { warningsField } from "./warnings.ts";

export const coverageTool: McpTool = {
  def: {
    name: "coverage",
    description:
      "Check overall compliance coverage — passing/failing/manual counts per standard. Use after fixing violations to see if you're done. Call it without `paths` to cover the whole project (honors the same cwd + .gitignore + ra11y.config.ts as scan_project); pass `paths` only to narrow the question to a specific subtree.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional. File or directory paths to scan. Omit for a project-wide coverage report rooted at `cwd`.",
        },
        standard: { type: "string", description: "Standard ID." },
        level: { type: "string", enum: ["A", "AA", "AAA"], description: "Conformance level." },
        cwd: {
          type: "string",
          description:
            "Base directory. Used as the scan root when `paths` is omitted, and for resolving relative `paths` when given.",
        },
        showUntargeted: {
          type: "boolean",
          description:
            "Include the full `untargetedCriteriaList` (bare WCAG titles for criteria no finder grounded in code). Default false; `untargetedCriteria` (the count) is always returned. Mirrors the `checklist` tool so both surfaces behave consistently.",
        },
        metaMode: metaModeSchema,
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async handler(params, session) {
    const cwd = strParam(params, "cwd") ?? process.cwd();
    const paths = strArrayParam(params, "paths") ?? [cwd];

    const standards = resolveStandards(strParam(params, "standard"), session);
    const unknown = firstUnknownStandard(standards);
    if (unknown !== null) {
      const known = BUILTIN_STANDARDS.map((s) => s.id).join(", ");
      return errorResult({
        code: "standard-not-found",
        message: `Unknown standard '${unknown}'. Loaded: ${known}.`,
        details: { requested: unknown, loaded: BUILTIN_STANDARDS.map((s) => s.id) },
        remediation:
          "Pass `standard` with one of the loaded IDs, or omit to use the session default.",
      });
    }
    const level = resolveLevel(strParam(params, "level"), session);
    const files = await parseFiles(paths, session, cwd);
    const attestations = await loadDurableAttestations(cwd);

    const { result, report } = runScan({
      standards: BUILTIN_STANDARDS,
      rules: applyRuleSettings(BUILTIN_RULES, session.config.rules),
      enabled: standards,
      files,
      finders: BUILTIN_CANDIDATE_FINDERS,
      level,
      ...(attestations.length > 0 && { attestations }),
    });

    const candidateCriteria = new Set((report.candidates ?? []).map((c) => c.criterionId));
    const applicability = detectApplicability(files);
    const coverage = buildCoverageReport(result, BUILTIN_STANDARDS, level);
    const showUntargeted = params["showUntargeted"] === true;
    const entries = coverage.map((c) => {
      // Split by applicability first so the counts align with scan_project
      // and checklist — media-only criteria move to likelyIrrelevant
      // when there's no <video>/<audio>, and never inflate the
      // review-required number.
      const { applicable, likelyIrrelevant } = splitManualCriteria(c.manualCriteria, applicability);
      const withCandidates = applicable.filter((id) => candidateCriteria.has(id));
      const untargeted = applicable.filter((id) => !candidateCriteria.has(id));
      return {
        standardId: c.standardId,
        // Named so the denominator is unmistakable: it's the share of
        // the `criteriaAutomatable` subset that passed, not the share of
        // the full standard. Previous name ("automatedPassRate") was
        // repeatedly misread as overall conformance.
        automatedCriteriaPassRate: c.automatedPassRate,
        criteriaTotal: c.total,
        criteriaAutomatable: c.automatable,
        criteriaAutomatablePassing: c.passing,
        criteriaManualReviewRequired: applicable.length,
        // Split the manual-review pile so agents can see at the coverage
        // level (without a second checklist call) how many manual
        // criteria have concrete candidates worth reviewing vs pure
        // WCAG prompts the finders couldn't ground in code.
        manualWithCandidates: withTitles(withCandidates),
        // Count is always informative ("how big is the untargeted tail");
        // the list is gated behind showUntargeted so the default response
        // doesn't ship 16 entries of bare WCAG titles that mirror the
        // checklist tool's showUntargeted default.
        //
        // Canonical count field is `untargetedCriteria`
        // (matches scan_project's `plan` and
        // checklist's `summary`). The list uses the distinct name
        // `untargetedCriteriaList` so the number and array fields don't
        // collide when both are present.
        untargetedCriteria: untargeted.length,
        ...(showUntargeted ? { untargetedCriteriaList: withTitles(untargeted) } : {}),
        likelyIrrelevantCriteria: withTitles(likelyIrrelevant),
        // Renamed from "automatedGaps" — agents consistently misread
        // that as "criteria automation can't cover" when it actually
        // listed automated criteria that are currently failing.
        failingAutomatedCriteria: withTitles(c.failingCriteria),
        summary:
          `${c.passing}/${c.automatable} automatable criteria passing (${c.automatedPassRate}%). ` +
          `${applicable.length} of ${c.total} criteria in ${c.standardId} need manual review ` +
          `(${withCandidates.length} with concrete candidates, ${untargeted.length} untargeted` +
          `${likelyIrrelevant.length > 0 ? `; ${likelyIrrelevant.length} media-only criteria are irrelevant to this scan` : ""}). ` +
          `Run the 'checklist' tool for evaluation prompts.`,
      };
    });

    // Doctrine (CLAUDE.md §1 "Zero-output success is ambiguous failure"):
    // a coverage response with `criteriaAutomatable: 0` etc. is
    // indistinguishable from "tool never ran" unless we surface the
    // honest "scanned_zero_files" code on a real-but-empty scan root.
    // `coverage` has no root-resolution step (takes `paths` directly,
    // defaulting to `[cwd]`) and doesn't load project config in this
    // handler; mirror the `scan` tool's inputs for the other codes.
    const warnings = warningsField({
      filesScanned: files.length,
      rootSource: null,
      configSource: undefined,
      analysisCoverage: undefined,
      filesByExtension: undefined,
    });
    // `meta` is opt-in per `metaMode` — legacy callers (no metaMode)
    // never saw a `meta` block on this tool, and additive surface
    // creep is avoided by emitting under `metaMode: "delta"` only so
    // the session meta-cache has something to collapse on repeat
    // calls. The telemetry we DO ship (filesScanned, rulesEvaluated,
    // standards, level, cwd) is scan-confidence data an agent uses to
    // cross-check parity with the scan-family tools (CLAUDE.md §1
    // "Verbose meta is signal, not clutter").
    const metaField = buildCoverageMetaField({
      params,
      session,
      filesScanned: files.length,
      rulesEvaluated: applyRuleSettings(BUILTIN_RULES, session.config.rules).length,
      enabledStandards: standards,
      level,
      cwd,
    });
    // Historical shape: single object when one standard is enabled,
    // array-of-entries when multiple. Warnings ride at the top level of
    // the response per doctrine. For the single-standard path (by far
    // the common case) we spread warnings alongside the entry fields;
    // the multi-standard path keeps its array shape unchanged, so a
    // future consumer expecting `Array.isArray(response)` doesn't
    // regress. Warnings on a zero-file multi-standard scan would also
    // need the per-response envelope, but adding it conditionally here
    // would split the wire shape on a signal invisible to the schema —
    // we leave that path unchanged until a concrete consumer needs it.
    if (entries.length === 1) {
      const entry = entries[0];
      // ADR 0010 cross-pointing. `coverage` answers "how close are we
      // to conformance?" — its `nextStep` routes the caller onward
      // to the matching workflow surface:
      //   - manualWithCandidates non-empty → `checklist` (grounded
      //     candidates with file:line are the honest next question);
      //   - manualWithCandidates empty but failingAutomated present →
      //     `scan_project` (fix violations before reviewing manual);
      //   - both empty → omit (clean report, no follow-up to name).
      // Conditional-spread discipline (CLAUDE.md §1): `nextStep` +
      // `nextStepStructured` ship as one unit or not at all.
      const nextStep = entry
        ? buildCoverageNextStep({
            manualWithCandidatesLen: entry.manualWithCandidates.length,
            failingAutomatedLen: entry.failingAutomatedCriteria.length,
            cwd,
            standard: strParam(params, "standard"),
            level: strParam(params, "level"),
          })
        : {};
      return textResult({ ...entry, ...nextStep, ...metaField, ...warnings });
    }
    return textResult(entries);
  },
};

/**
 * Assembles the optional `meta` field for `coverage`. Emitted only
 * when `metaMode: "delta"` is requested so legacy callers see no shape
 * change (the tool had no `meta` block historically). Under delta mode
 * we collect scan-confidence telemetry (filesScanned, rulesEvaluated,
 * enabled standards, level, cwd) and hand it to the shared meta-cache
 * helper — repeat calls with the same signature collapse to a delta
 * keyed by `sessionRef`. Scoped to the single-standard return shape
 * (where the response envelope is an object); the multi-standard array
 * shape stays unchanged until a concrete consumer needs opt-in there.
 */
function buildCoverageMetaField(args: {
  readonly params: Record<string, unknown>;
  readonly session: McpSession;
  readonly filesScanned: number;
  readonly rulesEvaluated: number;
  readonly enabledStandards: readonly string[];
  readonly level: "A" | "AA" | "AAA";
  readonly cwd: string;
}): { readonly meta?: Record<string, unknown> } {
  if (readMetaMode(args.params) === "full") return {};
  const fullMeta: Record<string, unknown> = {
    cwd: args.cwd,
    filesScanned: args.filesScanned,
    rulesEvaluated: args.rulesEvaluated,
    standards: [...args.enabledStandards],
    level: args.level,
  };
  return {
    meta: applyMetaCacheMode({
      toolName: "coverage",
      params: args.params,
      fullMeta,
      session: args.session,
    }),
  };
}

interface CoverageNextStepInputs {
  readonly manualWithCandidatesLen: number;
  readonly failingAutomatedLen: number;
  readonly cwd: string;
  readonly standard: string | undefined;
  readonly level: string | undefined;
}

/**
 * Builds the `coverage` tool's cross-pointing next-step pair per
 * ADR 0010.
 *
 * Three branches:
 *   - manualWithCandidates non-empty → point at `checklist` (grounded
 *     review candidates are the honest next question).
 *   - empty but failingAutomated non-empty → point at `scan_project`
 *     (the agent should fix automated violations before working the
 *     manual queue).
 *   - otherwise (clean report) → omit both fields (honest-shape per
 *     CLAUDE.md §1 — no follow-up to name).
 */
function buildCoverageNextStep({
  manualWithCandidatesLen,
  failingAutomatedLen,
  cwd,
  standard,
  level,
}: CoverageNextStepInputs): {
  readonly nextStep?: string;
  readonly nextStepStructured?: { readonly tool: string; readonly args: Record<string, unknown> };
} {
  if (manualWithCandidatesLen > 0) {
    const args: Record<string, unknown> = { cwd };
    if (standard !== undefined) args["standard"] = standard;
    if (level !== undefined) args["level"] = level;
    return {
      nextStep:
        "Call `checklist` to work through manual-review candidates with concrete file:line locations.",
      nextStepStructured: { tool: "checklist", args },
    };
  }
  if (failingAutomatedLen > 0) {
    return {
      nextStep:
        "Automated criteria are failing. Call `scan_project` to see the violations with file:line and fix suggestions.",
      nextStepStructured: { tool: "scan_project", args: { cwd } },
    };
  }
  return {};
}

/**
 * Enriches bare criterion IDs (e.g. "wcag22:2.4.11") with their titles
 * ("Focus Not Obscured (Minimum)") so agents don't have to look them up.
 * Falls back to ID-only if a criterion isn't found in any loaded standard.
 */
function withTitles(
  criterionIds: readonly string[],
): readonly { readonly id: string; readonly title: string; readonly level: string }[] {
  return criterionIds.map((id) => {
    for (const std of BUILTIN_STANDARDS) {
      const c = std.criteria.find((cr) => cr.id === id);
      if (c) return { id, title: c.title, level: c.level };
    }
    return { id, title: "", level: "" };
  });
}
