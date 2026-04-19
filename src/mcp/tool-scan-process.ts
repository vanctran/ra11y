/**
 * The `scan_process` MCP tool.
 *
 * Orchestrates a per-page scan over a named process declared in
 * `ra11y.config.ts` `processes`. Each page parses + scans independently;
 * the tool aggregates the per-page results into the response along with
 * a minimal `processLevelCandidates` frame that future process-level
 * finders (WCAG 3.2.3 Consistent navigation, 3.2.4 Consistent
 * identification, 2.4.5 Multiple ways) will populate.
 *
 * In this phase `processLevelCandidates` is ALWAYS `[]` — emitted
 * explicitly so the shape is honest about what it does and does not
 * signal today. Callers branch on the field's presence, not truthiness;
 * an empty array means "this phase doesn't produce process-level
 * signals yet," distinct from a future populated array meaning "these
 * locations need cross-page review."
 *
 * See ADR 0016 (Process-level scope) for the primitive's rationale and
 * the deterministic-over-heuristic page-set declaration that backs it.
 *
 * Shape contract (AI-first doctrine, `docs/kb/architecture/ai-first-consumer.md`):
 *
 *   - `processName` required. `cwd` optional — same resolution as
 *     `scan_project` (explicit > host root > git root > spawn cwd).
 *   - `processName` not in config.processes → `warnings:
 *     ["process_not_found"]`, empty results, no scan work.
 *   - No `processes` at all (unset or `[]`) → `warnings:
 *     ["no_processes_configured"]`. Distinct from `process_not_found`
 *     because the agent remediation is different: one asks the user to
 *     declare the config primitive, the other to pass the right name.
 *   - Missing pages (declared but absent on disk) → `warnings:
 *     ["process_has_missing_pages"]` plus `meta.missingPages` enumerating
 *     them. The scan still runs across the real pages so the agent
 *     sees partial evidence rather than a refuse-to-run envelope.
 *   - `meta.resolvedProcess` round-trips the matched process verbatim
 *     so the agent can confirm which declaration drove the scan.
 */

import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { runScan } from "../engine/scanner.ts";
import { BUILTIN_CANDIDATE_FINDERS } from "../review/index.ts";
import { BUILTIN_RULES } from "../rules/index.ts";
import { BUILTIN_STANDARDS } from "../standards/index.ts";
import type { Process } from "../types/config.ts";
import type { ReviewCandidate } from "../types/review.ts";
import type { ScanResult } from "../types/violation.ts";
import { gitRoot } from "../utils/git.ts";
import {
  applyRuleSettings,
  errorResult,
  loadDurableAttestations,
  type McpTool,
  strParam,
  textResult,
} from "./tools-helpers.ts";

/** One per-page summary in the response's `pagesScanned` list. */
export interface PageScanSummary {
  readonly path: string;
  readonly findings: number;
}

/** Structured response body for `scan_process`. */
export interface ScanProcessResponse {
  readonly processName: string;
  readonly pagesScanned: readonly PageScanSummary[];
  readonly perPageResults: readonly ScanResult[];
  readonly processLevelCandidates: readonly ReviewCandidate[];
  readonly meta: {
    readonly cwd: string;
    readonly totalFindings: number;
    readonly standards: readonly string[];
    readonly level: "A" | "AA" | "AAA";
    readonly resolvedProcess: Process | null;
    readonly missingPages?: readonly string[];
  };
  readonly warnings?: readonly string[];
  readonly nextStep?: string;
  readonly nextStepStructured?: {
    readonly tool: string;
    readonly args: Record<string, unknown>;
  };
}

export const scanProcessTool: McpTool = {
  def: {
    name: "scan_process",
    description:
      'Scan every page of a named process (user journey) declared in `ra11y.config.ts` `processes`, in declared order. Produces per-page scan results plus a minimal process-level frame that future process-level finders (WCAG 3.2.3 Consistent navigation, 3.2.4 Consistent identification, 2.4.5 Multiple ways) will populate. Today `processLevelCandidates` is always empty — the field is present so callers can rely on the shape; deep process-level analysis lands in follow-up work. See ADR 0016 (Process-level scope) for the deterministic page-set primitive this tool consumes.\n\nUnknown `processName` surfaces `warnings: ["process_not_found"]` with empty results. When `processes` is unset or empty in the project config, `warnings: ["no_processes_configured"]` fires instead (different remediation — declare the primitive vs pass the right name). Declared pages missing on disk surface `warnings: ["process_has_missing_pages"]` plus `meta.missingPages`, and the scan still runs across the pages that do exist so the agent sees partial evidence.',
    inputSchema: {
      type: "object",
      properties: {
        processName: {
          type: "string",
          description:
            "Name of the process to scan — must match a `name` entry inside the project's `processes` config primitive. See ADR 0016.",
        },
        cwd: {
          type: "string",
          description:
            "Project root used to locate `ra11y.config.ts`. Defaults to the host-declared root, then the git root of the MCP server's spawn directory, then `process.cwd()` — same precedence as `scan_project`.",
        },
      },
      required: ["processName"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async handler(params, session) {
    const processName = strParam(params, "processName");
    if (processName === undefined || processName.length === 0) {
      return errorResult({
        code: "missing-required-param",
        message: "processName must be a non-empty string.",
        details: { param: "processName" },
      });
    }

    const explicitCwd = strParam(params, "cwd");
    const spawnCwd = process.cwd();
    const hostRoot = explicitCwd === undefined ? session.firstRootPath() : null;
    const cwd = explicitCwd ?? hostRoot ?? gitRoot(spawnCwd) ?? spawnCwd;

    const projectConfig = await session.loadProjectConfig(cwd);
    const standards = [...projectConfig.standards].sort();
    const level = projectConfig.level;

    // No `processes` at all — distinct remediation from "wrong name,"
    // so a distinct warning code. Empty results, no scan work.
    if (projectConfig.processes.length === 0) {
      return textResult(
        buildEmptyResponse({
          processName,
          cwd,
          standards,
          level,
          warning: "no_processes_configured",
          nextStep:
            "No `processes` declared in the project config. Add a `processes: [{ name, pages }]` entry to `ra11y.config.ts` — see ADR 0016 for the primitive and WCAG 3.2.3 / 3.2.4 / 2.4.5 coverage it unlocks.",
        }),
      );
    }

    const matched = projectConfig.processes.find((p) => p.name === processName);
    if (matched === undefined) {
      const declared = projectConfig.processes.map((p) => p.name);
      return textResult(
        buildEmptyResponse({
          processName,
          cwd,
          standards,
          level,
          warning: "process_not_found",
          nextStep: `Process \`${processName}\` is not declared. Known processes: ${declared.map((n) => `\`${n}\``).join(", ")}. Pass one of those as \`processName\`, or add a new entry to \`processes\` in \`ra11y.config.ts\`.`,
        }),
      );
    }

    // Pages resolve relative to the config file's directory when a
    // config file was loaded (ADR 0016). When no config file was
    // found the processes list is empty by construction, so we never
    // reach this branch without `sourcePath`.
    const baseDir = projectConfig.sourcePath ? dirname(projectConfig.sourcePath) : cwd;
    const { present, missing } = splitPagesByExistence(matched.pages, baseDir);

    const { pagesScanned, perPageResults } = await scanPages({
      present,
      missing,
      baseDir,
      session,
      projectConfig,
      standards,
      level,
      cwd,
    });

    const totalFindings = pagesScanned.reduce((n, p) => n + p.findings, 0);
    const warnings: string[] = [];
    if (missing.length > 0) warnings.push("process_has_missing_pages");

    const response: ScanProcessResponse = {
      processName,
      pagesScanned,
      perPageResults,
      // Always present, always empty in this phase. The shape is the
      // point — future process-level finders will populate it.
      processLevelCandidates: [],
      meta: {
        cwd,
        totalFindings,
        standards,
        level,
        resolvedProcess: matched,
        ...(missing.length > 0 ? { missingPages: missing } : {}),
      },
      ...(warnings.length > 0 ? { warnings } : {}),
      ...buildNextStep({
        totalFindings,
        pagesScannedCount: pagesScanned.length,
        missingCount: missing.length,
        processName,
      }),
    };

    return textResult(response);
  },
};

/**
 * Split declared pages into those that exist on disk and those that
 * don't. Relative paths resolve against the config file's directory.
 * Preserves declared order for the present set (authoritative per
 * ADR 0016) and the declared order inside `missing` too so the agent
 * sees the same ordering in diagnostics.
 */
function splitPagesByExistence(
  pages: readonly string[],
  baseDir: string,
): { readonly present: readonly string[]; readonly missing: string[] } {
  const present: string[] = [];
  const missing: string[] = [];
  for (const page of pages) {
    const abs = isAbsolute(page) ? page : resolve(baseDir, page);
    if (existsSync(abs)) {
      present.push(page);
    } else {
      missing.push(page);
    }
  }
  return { present, missing };
}

/**
 * Assembles the empty-result response shape used for the
 * `no_processes_configured` and `process_not_found` branches. Both
 * surface the same structural skeleton — empty arrays, zero totals,
 * `resolvedProcess: null` — with a distinct warning code and next-step
 * prose explaining the remediation.
 */
function buildEmptyResponse(args: {
  readonly processName: string;
  readonly cwd: string;
  readonly standards: readonly string[];
  readonly level: "A" | "AA" | "AAA";
  readonly warning: "no_processes_configured" | "process_not_found";
  readonly nextStep: string;
}): ScanProcessResponse {
  return {
    processName: args.processName,
    pagesScanned: [],
    perPageResults: [],
    processLevelCandidates: [],
    meta: {
      cwd: args.cwd,
      totalFindings: 0,
      standards: args.standards,
      level: args.level,
      resolvedProcess: null,
    },
    warnings: [args.warning],
    nextStep: args.nextStep,
  };
}

/**
 * Parse + scan every present page in declared order. Pages that fail
 * to parse (unsupported extension or read error) get appended to
 * `missing` so the agent gets one honest "didn't contribute evidence"
 * signal rather than a 0-findings page silently hiding in the
 * response. Extracted from the handler so its cognitive-complexity
 * score stays under the lint cap.
 */
async function scanPages(args: {
  readonly present: readonly string[];
  readonly missing: string[];
  readonly baseDir: string;
  readonly session: import("./session.ts").McpSession;
  readonly projectConfig: import("../types/config.ts").LoadedConfig;
  readonly standards: readonly string[];
  readonly level: "A" | "AA" | "AAA";
  readonly cwd: string;
}): Promise<{
  readonly pagesScanned: readonly PageScanSummary[];
  readonly perPageResults: readonly ScanResult[];
}> {
  const { present, missing, baseDir, session, projectConfig, standards, level, cwd } = args;
  const attestations = await loadDurableAttestations(cwd);
  const effectiveRuleSettings = session.effectiveRules(projectConfig);
  const activeRules = applyRuleSettings(BUILTIN_RULES, effectiveRuleSettings);

  const pagesScanned: PageScanSummary[] = [];
  const perPageResults: ScanResult[] = [];

  for (const pagePath of present) {
    const abs = isAbsolute(pagePath) ? pagePath : resolve(baseDir, pagePath);
    const parsed = await session.parseFile(abs);
    if (parsed === null) {
      missing.push(pagePath);
      continue;
    }
    const { result } = runScan({
      standards: BUILTIN_STANDARDS,
      rules: activeRules,
      enabled: standards,
      files: [parsed],
      finders: BUILTIN_CANDIDATE_FINDERS,
      level,
      ...(attestations.length > 0 && { attestations }),
    });
    perPageResults.push(result);
    pagesScanned.push({ path: pagePath, findings: result.violations.length });
  }

  return { pagesScanned, perPageResults };
}

/**
 * Per-scan next-step hint. Conditional-spread: the structured form
 * omits when no concrete follow-up call can be named (e.g. total
 * findings are zero and nothing was missing), so the response carries
 * neither `nextStep` nor `nextStepStructured` rather than a generic
 * sentinel.
 */
function buildNextStep(args: {
  readonly totalFindings: number;
  readonly pagesScannedCount: number;
  readonly missingCount: number;
  readonly processName: string;
}): {
  readonly nextStep?: string;
  readonly nextStepStructured?: { tool: string; args: Record<string, unknown> };
} {
  if (args.missingCount > 0) {
    return {
      nextStep: `${args.missingCount} declared page(s) missing from disk — see \`meta.missingPages\`. Either restore the files or update \`processes\` in \`ra11y.config.ts\` so the page set matches the repo.`,
    };
  }
  if (args.totalFindings > 0) {
    return {
      nextStep: `Process \`${args.processName}\` produced ${args.totalFindings} per-page finding(s) across ${args.pagesScannedCount} page(s). Inspect \`perPageResults[i].violations\` for details, or call \`scan_file\` on the affected path for the full agent-facing finding shape.`,
    };
  }
  if (args.pagesScannedCount > 0) {
    return {
      nextStep: `Process \`${args.processName}\` is clean across ${args.pagesScannedCount} page(s) at the automated level. Process-level criteria (WCAG 3.2.3, 3.2.4, 2.4.5) still need cross-page review — follow-up work will populate \`processLevelCandidates\`.`,
    };
  }
  return {};
}
