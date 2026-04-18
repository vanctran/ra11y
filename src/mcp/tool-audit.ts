/**
 * The `audit` MCP meta-tool. Runs scan_project, coverage, and checklist
 * in one round-trip and returns all three payloads under
 * `{ scan, coverage, checklist }`. Keeps the existing three tools
 * intact — this one saves the round-trips for agents that want a
 * one-shot audit workflow (e.g. the /audit prompt template).
 *
 * Implementation is deliberately a fan-out over the three existing
 * handlers, run in parallel. Each handler already honors session
 * config, ra11y.config.ts, and cwd resolution; sharing the entry
 * points means this tool can't silently drift from what the
 * individual tools emit.
 */

import { checklistTool } from "./tool-checklist.ts";
import { coverageTool } from "./tool-coverage.ts";
import { scanProjectTool } from "./tool-scan-project.ts";
import { errorResult, type McpTool, type McpToolResult, textResult } from "./tools-helpers.ts";

type ParamRecord = Record<string, unknown>;

export const auditTool: McpTool = {
  def: {
    name: "audit",
    description:
      "One-shot project audit: runs `scan_project`, `coverage`, and `checklist` in a single round-trip and returns all three under `{ scan, coverage, checklist }`. Use this when you want a complete compliance picture without three tool calls (e.g. before drafting a VPAT or running a formal audit). For narrower workflows — fix-verify loops, single-file triage — prefer calling `scan_file` or `scan_project` directly.\n\nAccepts the union of parameters the three underlying tools take; each sub-tool receives the subset it understands. `cwd`, `standard`, and `level` apply to all three; `changedOnly`, `since`, `autoDetectWrappers`, `additionalPaths`, and `verboseMeta` only shape the scan leg. `showUntargeted` only shapes the checklist leg.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description:
            "Root directory for the audit. Defaults to the current working directory. Pass your repo root so the loader can discover `ra11y.config.ts` and the project's `.gitignore`.",
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
            "Minimum severity to include in the scan leg. Default 'info' is recommended — info findings are cases static analysis can't resolve but you can (by reading source). Only raise to 'warning' for unattended CI gates.",
        },
        changedOnly: {
          type: "boolean",
          description: "Scan leg only: restrict to files currently staged in git.",
        },
        since: {
          type: "string",
          description:
            "Scan leg only: git ref; scans files that differ between the ref and HEAD, plus uncommitted WIP.",
        },
        verboseMeta: {
          type: "boolean",
          description:
            "Scan leg only: expand analysisCoverage counts into lists (parseErrorFiles, opaqueCustomComponentNames, rulesByExtension). Off by default.",
        },
        autoDetectWrappers: {
          type: "boolean",
          description:
            "Scan leg only: run the detect_native_wrappers heuristic inline and register PascalCase-with-onClick components as nativeWrappers for this scan. Scan-scoped only.",
        },
        additionalPaths: {
          type: "array",
          items: { type: "string" },
          description:
            'Scan leg only: paths to scan in addition to the auto-discovered tree, bypassing `.gitignore` and default build-dir skips. Typically used for post-compile CSS/HTML (`["dist/assets"]`).',
        },
        showUntargeted: {
          type: "boolean",
          description:
            "Checklist leg only: include the full list of manual criteria without concrete candidates. Default false; the summary still reports the count.",
        },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async handler(params, session) {
    const scanParams = pickScanParams(params);
    const coverageParams = pickCoverageParams(params);
    const checklistParams = pickChecklistParams(params);
    // allSettled so a single sub-handler throwing doesn't sink the
    // other two — agents get a structured error envelope they can
    // branch on instead of a JSON-RPC protocol error escaping the tool.
    const [scanSettled, coverageSettled, checklistSettled] = await Promise.allSettled([
      Promise.resolve().then(() => scanProjectTool.handler(scanParams, session)),
      Promise.resolve().then(() => coverageTool.handler(coverageParams, session)),
      Promise.resolve().then(() => checklistTool.handler(checklistParams, session)),
    ]);
    const rejections: Record<string, string> = {};
    if (scanSettled.status === "rejected")
      rejections["scan"] = describeRejection(scanSettled.reason);
    if (coverageSettled.status === "rejected")
      rejections["coverage"] = describeRejection(coverageSettled.reason);
    if (checklistSettled.status === "rejected")
      rejections["checklist"] = describeRejection(checklistSettled.reason);
    if (Object.keys(rejections).length > 0) {
      return errorResult({
        code: "audit-sub-tool-threw",
        message: "audit sub-tool rejected",
        details: { rejections },
      });
    }
    // All three settled to fulfilled here — the status-narrowing above
    // plus the early-return leaves the fulfilled branch as the only
    // reachable shape.
    const scanRes = (scanSettled as PromiseFulfilledResult<McpToolResult>).value;
    const coverageRes = (coverageSettled as PromiseFulfilledResult<McpToolResult>).value;
    const checklistRes = (checklistSettled as PromiseFulfilledResult<McpToolResult>).value;
    const scan = unwrapPayload(scanRes);
    const coverage = unwrapPayload(coverageRes);
    const checklist = unwrapPayload(checklistRes);
    if (scan === null || coverage === null || checklist === null) {
      return errorResult({
        code: "audit-sub-tool-unparseable",
        message: "audit sub-tool returned an unparseable payload",
        details: {
          scanOk: scan !== null,
          coverageOk: coverage !== null,
          checklistOk: checklist !== null,
        },
      });
    }
    return textResult({
      scan,
      coverage,
      checklist,
      nextStep: suggestAuditNextStep(scan, checklist),
    });
  },
};

function describeRejection(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

/**
 * Extracts the single text-content block from a sub-tool result and
 * parses it back into structured data. Every built-in MCP tool answers
 * with exactly one text block produced by `textResult`, so this is the
 * inverse of that wrapper.
 */
function unwrapPayload(res: McpToolResult): unknown {
  if (res.isError) {
    // Prefer the structuredContent (code + message + details) when the
    // sub-tool emits one; fall back to parsing the text payload so
    // legacy string errorResult() calls still surface a readable shape.
    if (res.structuredContent !== undefined) {
      return { error: res.structuredContent };
    }
    const raw = res.content[0]?.text ?? "";
    try {
      return { error: JSON.parse(raw) };
    } catch {
      return { error: raw };
    }
  }
  const first = res.content[0];
  if (!first || first.type !== "text") return null;
  try {
    return JSON.parse(first.text);
  } catch {
    return null;
  }
}

const SCAN_KEYS = [
  "cwd",
  "standard",
  "level",
  "minSeverity",
  "changedOnly",
  "since",
  "verboseMeta",
  "autoDetectWrappers",
  "additionalPaths",
] as const;

const COVERAGE_KEYS = ["cwd", "standard", "level"] as const;

const CHECKLIST_KEYS = ["cwd", "standard", "level", "showUntargeted"] as const;

function pickScanParams(params: ParamRecord): ParamRecord {
  return pickKeys(params, SCAN_KEYS);
}

function pickCoverageParams(params: ParamRecord): ParamRecord {
  return pickKeys(params, COVERAGE_KEYS);
}

function pickChecklistParams(params: ParamRecord): ParamRecord {
  return pickKeys(params, CHECKLIST_KEYS);
}

function pickKeys(params: ParamRecord, keys: readonly string[]): ParamRecord {
  const out: ParamRecord = {};
  for (const key of keys) {
    if (params[key] !== undefined) out[key] = params[key];
  }
  return out;
}

/**
 * Points the agent at the next productive call after an audit. The
 * individual tools each emit their own nextStep hint; this meta hint
 * reconciles the two (scan's nextStep points at a rule fix; checklist
 * points at a manual-review candidate) and picks the one most likely
 * to be load-bearing.
 */
function suggestAuditNextStep(scan: unknown, checklist: unknown): string {
  const scanMeta = readObject(scan, "meta");
  const scanNextStep = readString(scanMeta, "nextStep");
  const checklistSummary = readObject(checklist, "summary");
  const actionable = readNumber(checklistSummary, "actionable");
  if (scanNextStep && scanNextStep.length > 0) {
    if (actionable !== null && actionable > 0) {
      return `${scanNextStep} The checklist leg surfaced ${actionable} actionable manual-review item${actionable === 1 ? "" : "s"} — review those after the scan fixes land.`;
    }
    return scanNextStep;
  }
  if (actionable !== null && actionable > 0) {
    return `Automated leg clean. Checklist has ${actionable} actionable manual-review item${actionable === 1 ? "" : "s"} — work through checklist.items.`;
  }
  return "Audit clean across all three legs. Pair with axe-core in Playwright/Vitest for runtime checks (focus traps, live regions, ARIA state, post-render contrast) before claiming conformance.";
}

function readObject(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return record[key] ?? null;
}

function readString(value: unknown, key: string): string | null {
  const raw = readObject(value, key);
  return typeof raw === "string" ? raw : null;
}

function readNumber(value: unknown, key: string): number | null {
  const raw = readObject(value, key);
  return typeof raw === "number" ? raw : null;
}
