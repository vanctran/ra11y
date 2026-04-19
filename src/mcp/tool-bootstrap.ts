/**
 * The `bootstrap` MCP meta-tool. One round-trip composes four onboarding
 * primitives — `detect_native_wrappers`, `propose_config`,
 * `scan_project`, and (opt-in) `baseline create` — plus a copy-pasteable
 * GitHub Actions snippet wiring `baseline check` into CI.
 *
 * Read-only by default: `writeBaseline` defaults to false so no file
 * lands on disk unless the agent opts in. Sub-handlers dispatch via
 * `Promise.allSettled` so one rejection doesn't sink the others
 * (mirrors the audit meta-tool, commit 048dfcc). `scan_project` is the
 * mandatory spine — its rejection hard-errors since the other payloads
 * compose onto it; detect + propose_config legs degrade gracefully and
 * surface a `bootstrap_<leg>_failed` warning code.
 *
 * Shape contract (AI-first doctrine, `docs/kb/architecture/ai-first-consumer.md`):
 *   - `baseline: null` (never `{}`) in dry-run — present-when-meaningful.
 *   - `ciSnippet` always populated (even on clean scans) so agents
 *     preserve CI wiring regardless of current violations.
 *   - `warnings` propagates scan-leg codes verbatim plus
 *     `bootstrap_<leg>_failed` entries; omitted when empty.
 */

import { existsSync } from "node:fs";
import { BASELINE_FILENAME } from "../engine/baseline.ts";
import { gitRoot } from "../utils/git.ts";
import { baselineTool } from "./tool-baseline.ts";
import { detectNativeWrappersTool } from "./tool-detect-wrappers.ts";
import { proposeConfigTool } from "./tool-propose-config.ts";
import { scanProjectTool } from "./tool-scan-project.ts";
import {
  errorResult,
  type McpTool,
  type McpToolResult,
  strParam,
  textResult,
} from "./tools-helpers.ts";

/** Sub-legs the bootstrap composes; surfaces as `bootstrap_<leg>_failed` codes. */
type SubLeg = "detect" | "propose_config" | "baseline";

export const bootstrapTool: McpTool = {
  def: {
    name: "bootstrap",
    description:
      "One-shot onboarding: run `detect_native_wrappers` + `propose_config` + `scan_project` and (optionally) write a `.ra11y-baseline.json`, all in a single round-trip. Returns the wrapper candidates, the proposed ra11y.config.ts body, a subset of the scan payload, the baseline status, and a copy-pasteable CI snippet that wires `baseline check` into GitHub Actions.\n\nRead-only by default: `writeBaseline` is false unless the caller opts in. When `writeBaseline: true`, the tool writes `.ra11y-baseline.json` into `cwd` via the `baseline` tool's `create` mode — same on-disk shape as calling `baseline` directly. Use this once when adopting ra11y on a new codebase; prefer the individual tools for iterative work.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description:
            "Project root. Defaults to the git root of the MCP server's spawn directory, then process.cwd(). Pass your repo root so the scan sees both `ra11y.config.ts` (if present) and the project's `.gitignore`.",
        },
        additionalPaths: {
          type: "array",
          items: { type: "string" },
          description:
            'Paths to scan in addition to the auto-discovered tree, bypassing `.gitignore` and the default build-dir skips. Forwarded verbatim to `scan_project`. Typically used for post-compile CSS/HTML (`["dist/assets"]`) so color-contrast and focus-visible rules have real styles to evaluate.',
        },
        writeBaseline: {
          type: "boolean",
          description:
            "When true, write `.ra11y-baseline.json` at the scan root containing every current violation — grandfathered so future regressions fail `baseline check` in CI. Defaults to false (dry-run): the scan payload is still returned, but no file is written. The `baseline` field on the response is null in dry-run mode.",
        },
      },
    },
    annotations: { idempotentHint: true },
  },
  async handler(params, session) {
    const explicitCwd = strParam(params, "cwd");
    if (explicitCwd !== undefined && !existsSync(explicitCwd)) {
      return errorResult({
        code: "cwd-not-found",
        message: `Requested cwd does not exist on disk: ${explicitCwd}`,
        details: { cwd: explicitCwd },
        remediation:
          "Pass `cwd` as a path to an existing directory. Relative paths resolve against the MCP server's spawn directory.",
      });
    }
    const spawnCwd = process.cwd();
    const root = explicitCwd ?? gitRoot(spawnCwd) ?? spawnCwd;
    const writeBaseline = params["writeBaseline"] === true;
    const additionalPaths = Array.isArray(params["additionalPaths"])
      ? (params["additionalPaths"] as string[])
      : [];

    // scan_project is mandatory; detect + propose_config best-effort.
    const scanParams: Record<string, unknown> = { cwd: root };
    if (additionalPaths.length > 0) scanParams["additionalPaths"] = additionalPaths;
    const [detectSettled, proposeSettled, scanSettled] = await Promise.allSettled([
      Promise.resolve().then(() => detectNativeWrappersTool.handler({ cwd: root }, session)),
      Promise.resolve().then(() => proposeConfigTool.handler({ cwd: root }, session)),
      Promise.resolve().then(() => scanProjectTool.handler(scanParams, session)),
    ]);

    if (scanSettled.status === "rejected") {
      return errorResult({
        code: "audit-sub-tool-threw",
        message: `bootstrap scan_project leg rejected: ${describeRejection(scanSettled.reason)}`,
        details: { failedLeg: "scan_project" },
      });
    }
    const scanRes = scanSettled.value;
    const scan = unwrapPayload(scanRes);
    if (scan === null) {
      return errorResult({
        code: "audit-sub-tool-unparseable",
        message: "bootstrap scan_project leg returned an unparseable payload",
        details: { failedLeg: "scan_project" },
      });
    }

    const failedLegs: SubLeg[] = [];
    const wrappersPayload = extractWrappersSubset(detectSettled, failedLegs);
    const proposedConfig = extractProposedConfig(proposeSettled, failedLegs);

    // Baseline runs sequentially when opted in. Dry-run returns null —
    // present-when-meaningful shape.
    const baseline = writeBaseline ? await runBaseline(root, session, failedLegs) : null;

    const scanSubset = extractScanSubset(scan);
    const scanWarnings = readStringArray(scan, "warnings");
    const warnings: string[] = [
      ...scanWarnings,
      ...failedLegs.map((leg) => `bootstrap_${leg}_failed`),
    ];

    const ciSnippet = buildCiSnippet();
    const nextStep = buildNextStep({
      scan: scanSubset,
      baseline,
      writeBaseline,
      failedLegs,
    });

    return textResult({
      wrappers: wrappersPayload,
      ...(proposedConfig === null ? {} : { proposedConfig }),
      scan: scanSubset,
      baseline,
      ciSnippet,
      nextStep,
      nextStepStructured: buildNextStepStructured({
        scanSubset,
        baseline,
        writeBaseline,
      }),
      meta: {
        scannedRoot: root,
        writeBaseline,
        ...(additionalPaths.length > 0 ? { additionalPaths } : {}),
      },
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  },
};

interface WrappersSubset {
  readonly candidates: readonly unknown[];
  readonly suggestedConfigSnippet?: string;
}

function settledRecord(
  settled: PromiseSettledResult<McpToolResult>,
): Record<string, unknown> | null {
  if (settled.status === "rejected") return null;
  const payload = unwrapPayload(settled.value);
  if (payload === null || typeof payload !== "object") return null;
  return payload as Record<string, unknown>;
}

function extractWrappersSubset(
  settled: PromiseSettledResult<McpToolResult>,
  failedLegs: SubLeg[],
): WrappersSubset {
  const record = settledRecord(settled);
  if (record === null) {
    failedLegs.push("detect");
    return { candidates: [] };
  }
  const candidates = Array.isArray(record["candidates"])
    ? (record["candidates"] as readonly unknown[])
    : [];
  const snippet = record["suggestedConfigSnippet"];
  return {
    candidates,
    ...(typeof snippet === "string" && snippet.length > 0
      ? { suggestedConfigSnippet: snippet }
      : {}),
  };
}

function extractProposedConfig(
  settled: PromiseSettledResult<McpToolResult>,
  failedLegs: SubLeg[],
): string | null {
  const record = settledRecord(settled);
  const cfg = record?.["suggestedConfig"];
  if (typeof cfg !== "string" || cfg.length === 0) {
    failedLegs.push("propose_config");
    return null;
  }
  return cfg;
}

interface ScanSubset {
  readonly filesScanned: number;
  readonly totalFindings: number;
  readonly scanMode?: string;
  readonly actionableManualItems?: number;
}

function extractScanSubset(scan: unknown): ScanSubset {
  if (scan === null || typeof scan !== "object") {
    return { filesScanned: 0, totalFindings: 0 };
  }
  const record = scan as Record<string, unknown>;
  const meta = record["meta"];
  const plan = record["plan"];
  const filesScanned = readNumberFromRecord(meta, "filesScanned") ?? 0;
  const totalFindings = readNumberFromRecord(plan, "totalFindings") ?? 0;
  const scanMode = readStringFromRecord(meta, "scanMode");
  const actionable = readNumberFromRecord(plan, "actionableManualItems");
  return {
    filesScanned,
    totalFindings,
    ...(scanMode === null ? {} : { scanMode }),
    ...(actionable === null || actionable === undefined
      ? {}
      : { actionableManualItems: actionable }),
  };
}

interface BaselineSummary {
  readonly written: boolean;
  readonly path: string;
  readonly entriesWritten?: number;
}

async function runBaseline(
  cwd: string,
  session: import("./session.ts").McpSession,
  failedLegs: SubLeg[],
): Promise<BaselineSummary | null> {
  const fail = (): null => {
    failedLegs.push("baseline");
    return null;
  };
  try {
    const res = await baselineTool.handler({ mode: "create", cwd }, session);
    const payload = unwrapPayload(res);
    if (payload === null || typeof payload !== "object") return fail();
    const record = payload as Record<string, unknown>;
    if (record["error"] !== undefined) return fail();
    const baselinePath =
      readStringFromRecord(record, "baselinePath") ?? `${cwd}/${BASELINE_FILENAME}`;
    const entries = readNumberFromRecord(record, "entriesWritten");
    return {
      written: true,
      path: baselinePath,
      ...(typeof entries === "number" ? { entriesWritten: entries } : {}),
    };
  } catch {
    return fail();
  }
}

function describeRejection(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

function unwrapPayload(res: McpToolResult): unknown {
  if (res.isError) {
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

function readStringArray(value: unknown, key: string): readonly string[] {
  if (!value || typeof value !== "object") return [];
  const raw = (value as Record<string, unknown>)[key];
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

function readNumberFromRecord(value: unknown, key: string): number | null | undefined {
  if (!value || typeof value !== "object") return null;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "number" ? raw : null;
}

function readStringFromRecord(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" ? raw : null;
}

/** GitHub Actions snippet wiring `baseline check` into CI. Dry; pasteable. */
function buildCiSnippet(): string {
  return [
    "# .github/workflows/a11y.yml",
    "name: a11y",
    "on: [push, pull_request]",
    "jobs:",
    "  ra11y:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version: lts/*",
    "      - run: npx @ra11y/core --baseline check",
    "",
  ].join("\n");
}

interface NextStepArgs {
  readonly scan: ScanSubset;
  readonly baseline: BaselineSummary | null;
  readonly writeBaseline: boolean;
  readonly failedLegs: readonly SubLeg[];
}

function buildNextStep(args: NextStepArgs): string {
  const { scan, baseline, writeBaseline, failedLegs } = args;
  const parts: string[] = [];
  if (scan.filesScanned === 0) {
    parts.push(
      "Scan ran but parsed zero files — check `warnings` for why (nonexistent cwd, no matching extensions, or everything ignored).",
    );
  } else if (scan.totalFindings === 0) {
    parts.push(
      "Scan clean. Paste `proposedConfig` into ra11y.config.ts if a config is not already committed, then add the `ciSnippet` to your CI workflow.",
    );
  } else {
    parts.push(
      `${scan.totalFindings} finding${scan.totalFindings === 1 ? "" : "s"} from scan_project. Paste \`proposedConfig\` into ra11y.config.ts, then work through the findings — call \`scan_project\` again to iterate.`,
    );
  }
  if (writeBaseline && baseline !== null) {
    parts.push(
      `Baseline written to ${baseline.path}. Commit the file and add the \`ciSnippet\` to catch regressions.`,
    );
  } else if (!writeBaseline && scan.totalFindings > 0) {
    parts.push(
      "To grandfather the current violations and fail CI only on regressions, rerun `bootstrap` with `writeBaseline: true`.",
    );
  }
  if (failedLegs.length > 0) {
    parts.push(
      `Degraded legs: ${failedLegs.join(", ")} — re-run the individual tool to recover the missing payload.`,
    );
  }
  return parts.join(" ");
}

interface NextStepStructured {
  readonly tool: string;
  readonly args: Record<string, unknown>;
}

function buildNextStepStructured(args: {
  readonly scanSubset: ScanSubset;
  readonly baseline: BaselineSummary | null;
  readonly writeBaseline: boolean;
}): NextStepStructured {
  if (!args.writeBaseline && args.scanSubset.totalFindings > 0) {
    return { tool: "bootstrap", args: { writeBaseline: true } };
  }
  if (args.baseline?.written) {
    return { tool: "baseline", args: { mode: "check" } };
  }
  return { tool: "scan_project", args: {} };
}
