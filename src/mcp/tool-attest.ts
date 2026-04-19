/**
 * The `attest` MCP tool. Writes a durable {@link AttestationRecord}
 * to `<projectRoot>/.ra11y/attestations.jsonl` so subsequent scans
 * see the attestation as an `attested` {@link EvidenceSource} on the
 * evidence ledger.
 *
 * Use cases:
 *   - "We ran axe-core in CI on 2026-04-18 and it confirms 2.4.7
 *     passes" → `{ criterionId: "wcag22:2.4.7", by: "ci-bot",
 *     reason: "axe-core run 2026-04-18 reported pass for
 *     focus-visible", verdict: "pass" }`.
 *   - "We don't render any `<video>`/`<audio>`, so 1.2.1 is n/a" →
 *     `{ criterionId: "wcag22:1.2.1", by: "alice",
 *     reason: "application renders no time-based media", verdict:
 *     "n/a" }`.
 *   - "Manual keyboard traversal confirmed 2.4.3 at the component
 *     level" → `{ ..., scope: "file", location: {...} }`.
 *
 * Mirrors the `suppress` tool's safety posture: `allowWrite: true`
 * is required, the criterion must resolve to a loaded standard, and
 * `reason` text is strict — a bare-pragma-style un-justified attestation
 * is rejected (the whole point of the primitive is that attestations
 * carry reasoning).
 *
 * The store is append-only; every `attest` call adds one line. The
 * file is git-friendly — `.ra11y/attestations.jsonl` should be
 * committed so the audit trail persists across developers and CI.
 */

import { isAbsolute, resolve } from "node:path";
import { appendAttestation } from "../config/attestation-store.ts";
import { BUILTIN_STANDARDS } from "../standards/index.ts";
import type { AttestationRecord } from "../types/evidence.ts";
import type { Standard } from "../types/standard.ts";
import {
  errorResult,
  type McpTool,
  type McpToolResult,
  satisfyingRulesForCriterion,
  strArrayParam,
  strParam,
  textResult,
} from "./tools-helpers.ts";

const DEFAULT_BY = "agent";

export const attestTool: McpTool = {
  def: {
    name: "attest",
    description:
      "Record a durable attestation that a WCAG (or other standard) criterion is satisfied (or not, or n/a) for this project. The record is appended to `<cwd>/.ra11y/attestations.jsonl` and picked up as an `attested` evidence source on subsequent scans, promoting the criterion's status on the evidence ledger.\n\nUse this when the evidence that a criterion is met lives outside static analysis — a runtime-tool result (axe-core, Lighthouse, WAVE, Pa11y) read and interpreted in your CI, a manual keyboard traversal, a design review, or a declaration that a criterion is n/a (e.g. media criteria in a text-only app).\n\nInline `ra11y-disable` pragmas with a `reason=` already produce attestations automatically, pinned to file:line. Use `attest` for claims that don't hang off one line — project-level, file-level, or durable CI-bot runs.\n\nWrites to disk — requires session `allowWrite: true` (same gate as `apply_fix` / `suppress`). `reason` text is REQUIRED and non-empty; an un-justified attestation is rejected with `reason-required` — the whole point of the primitive is provenance.",
    inputSchema: {
      type: "object",
      properties: {
        criterionId: {
          type: "string",
          description:
            "Canonical criterion ID (`<standardId>:<localId>`, e.g. `wcag22:2.4.7`). Must resolve to a loaded standard; unknown IDs are rejected with `criterion-not-found`.",
        },
        ruleIds: {
          type: "array",
          items: { type: "string" },
          description:
            "OPTIONAL rule IDs this attestation covers. Omit to claim the attestation covers every rule that satisfies the criterion — the response lists that fan-out explicitly so you see what you just asserted. Present with one or more rule IDs to scope the attestation to those specific checks; the criterion only flips to `pass` on the evidence ledger once the union of attested `ruleIds` across all attestations covers every satisfying rule. Rule IDs that don't actually satisfy the given criterion are rejected with `rule-not-under-criterion`.",
        },
        reason: {
          type: "string",
          description:
            "REQUIRED free-form justification. Carries the provenance of the claim (which tool run, which reviewer, what observation). Surfaces to consumers of the ledger verbatim.",
        },
        by: {
          type: "string",
          description:
            'Who is attesting. Author identifier, bot name, CI run label, or similar. Default `"agent"`. For CI-bot writes, use a stable name like `"ci-bot"` or `"axe-core+ci"` so the audit trail stays consistent.',
        },
        verdict: {
          type: "string",
          enum: ["pass", "fail", "n/a"],
          description:
            'What the attestation asserts about the criterion. Defaults to `"pass"`. `"fail"` records a confirmed violation (e.g. runtime tool found a problem the static scanner can\'t see). `"n/a"` records that the criterion doesn\'t apply to this project.',
        },
        scope: {
          type: "string",
          enum: ["project", "file", "line"],
          description:
            'Granularity of the claim. Defaults to `"project"`. When `"file"` or `"line"`, supply `location`.',
        },
        location: {
          type: "object",
          properties: {
            filePath: { type: "string" },
            line: { type: "number" },
            column: { type: "number" },
          },
          description:
            'File + line + column the attestation pins to, when `scope !== "project"`. Column defaults to 1 when omitted.',
        },
        attestedAt: {
          type: "string",
          description:
            "ISO-8601 timestamp. Defaults to the current time. Override when re-recording a historical attestation to preserve the original date.",
        },
        cwd: {
          type: "string",
          description:
            "Project root — the `.ra11y/` directory is created under this path. Defaults to the MCP server's spawn directory; pass your project root explicitly when the server's cwd differs.",
        },
      },
      required: ["criterionId", "reason"],
    },
    // Mutates the attestation store; not idempotent (each call appends
    // a new line, even if the semantic claim is identical).
    annotations: { idempotentHint: false },
  },
  async handler(params, session): Promise<McpToolResult> {
    const pre = preflight(params, session);
    if ("error" in pre) return pre.error;
    const { record, cwd, satisfyingRules } = pre;

    try {
      await appendAttestation(cwd, record);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResult({
        code: "file-write-failed",
        message: `Failed to append attestation: ${message}`,
        details: { cwd, cause: message },
      });
    }

    const coveredRules = record.ruleIds ?? satisfyingRules;
    const isCriterionWide = record.ruleIds === undefined;
    return textResult({
      applied: true,
      record,
      cwd,
      // Fan-out disclosure: always list what the attestation claims to
      // cover so the agent sees the scope of the assertion it just
      // made. For a criterion-wide attestation, this is the list the
      // agent would otherwise have to derive by hand.
      coveredRules,
      coverage: isCriterionWide
        ? {
            kind: "criterion-wide" as const,
            message:
              satisfyingRules.length === 0
                ? `Criterion-wide attestation. No built-in rules satisfy '${record.criterionId}', so this claim stands on its reason text alone.`
                : `Criterion-wide attestation. You just claimed coverage for ${satisfyingRules.length} rule${satisfyingRules.length === 1 ? "" : "s"} under '${record.criterionId}'. To scope the claim narrower, re-call attest with an explicit ruleIds[].`,
          }
        : {
            kind: "rule-scoped" as const,
            message: `Rule-scoped attestation covering ${coveredRules.length} of ${satisfyingRules.length} satisfying rules under '${record.criterionId}'. The criterion flips to pass only once attestations across callers cover every satisfying rule.`,
          },
      nextStep:
        "Attestation appended to .ra11y/attestations.jsonl. Re-run `conformance_statement` (or `scan_project` / `coverage`) — the attested source will appear on the ledger entry for " +
        record.criterionId +
        ". Commit the updated .jsonl so the audit trail persists across developers and CI.",
    });
  },
};

interface PreflightOk {
  readonly record: AttestationRecord;
  readonly cwd: string;
  readonly satisfyingRules: readonly string[];
}

type PreflightResult = PreflightOk | { readonly error: McpToolResult };

function preflight(
  params: Record<string, unknown>,
  session: { readonly config: { readonly allowWrite: boolean } },
): PreflightResult {
  if (!session.config.allowWrite) {
    return {
      error: errorResult({
        code: "allow-write-disabled",
        message:
          "attest is disabled: session `allowWrite` flag is false. Call `sessionConfigure` with `{ allowWrite: true }` to enable write access for this session, then retry.",
        remediation: "Call `sessionConfigure` with `{ allowWrite: true }`, then retry attest.",
      }),
    };
  }

  const required = readRequired(params);
  if ("error" in required) return required;
  const { criterionId, reason } = required;
  const satisfyingRules = satisfyingRulesForCriterion(criterionId);

  const ruleIds = readRuleIds(params, criterionId, satisfyingRules);
  if ("error" in ruleIds) return ruleIds;

  const verdict = readVerdict(params);
  if (verdict instanceof Error) {
    return { error: errorResult({ code: "invalid-param", message: verdict.message }) };
  }
  const scope = readScope(params);
  if (scope instanceof Error) {
    return { error: errorResult({ code: "invalid-param", message: scope.message }) };
  }
  const location = readLocation(params, scope);
  if (location instanceof Error) {
    return { error: errorResult({ code: "invalid-param", message: location.message }) };
  }

  const by = strParam(params, "by") ?? DEFAULT_BY;
  const attestedAt = strParam(params, "attestedAt") ?? new Date().toISOString();
  const cwdParam = strParam(params, "cwd");
  const cwd = cwdParam === undefined ? process.cwd() : resolveCwd(cwdParam);

  const record: AttestationRecord = {
    criterionId,
    by: by.length === 0 ? DEFAULT_BY : by,
    reason: reason.trim(),
    attestedAt,
    ...(ruleIds.value !== undefined && { ruleIds: ruleIds.value }),
    ...(scope !== undefined && { scope }),
    ...(location !== undefined && { location }),
    ...(verdict !== undefined && { verdict }),
  };
  return { record, cwd, satisfyingRules };
}

function readRuleIds(
  params: Record<string, unknown>,
  criterionId: string,
  satisfyingRules: readonly string[],
): { readonly value: readonly string[] | undefined } | { readonly error: McpToolResult } {
  const raw = strArrayParam(params, "ruleIds");
  if (raw === undefined) return { value: undefined };
  if (raw.length === 0) {
    return {
      error: errorResult({
        code: "invalid-param",
        message:
          "attest.ruleIds must be omitted (for a criterion-wide claim) or contain at least one rule ID. Empty arrays are ambiguous — did you mean 'covers everything' or 'covers nothing'?",
      }),
    };
  }
  const satisfyingSet = new Set(satisfyingRules);
  const unknown = raw.filter((id) => !satisfyingSet.has(id));
  if (unknown.length > 0) {
    return {
      error: errorResult({
        code: "rule-not-under-criterion",
        message: `The following rule IDs do not satisfy '${criterionId}': ${unknown.join(", ")}. Attesting them would not contribute to this criterion's coverage — drop them or pick a different criterionId.`,
        details: {
          criterionId,
          unknownRuleIds: unknown,
          satisfyingRules,
        },
      }),
    };
  }
  const deduped = [...new Set(raw)].sort();
  return { value: deduped };
}

function readRequired(
  params: Record<string, unknown>,
): { readonly criterionId: string; readonly reason: string } | { readonly error: McpToolResult } {
  const criterionId = strParam(params, "criterionId");
  const reason = strParam(params, "reason");
  if (criterionId === undefined || criterionId.length === 0) {
    return {
      error: errorResult({
        code: "missing-required-param",
        message: "attest requires `criterionId` (non-empty string).",
      }),
    };
  }
  if (reason === undefined || reason.trim().length === 0) {
    return {
      error: errorResult({
        code: "missing-required-param",
        message:
          "attest requires `reason` (non-empty string). An un-justified attestation is the same failure mode a bare `ra11y-disable` represents — the whole point is provenance.",
      }),
    };
  }
  if (findCriterion(criterionId, BUILTIN_STANDARDS) === null) {
    return {
      error: errorResult({
        code: "criterion-not-found",
        message: `Unknown criterion '${criterionId}'. Must match a loaded standard in the form '<standardId>:<localId>' (e.g. 'wcag22:2.4.7').`,
        details: { criterionId },
      }),
    };
  }
  return { criterionId, reason };
}

function findCriterion(criterionId: string, standards: readonly Standard[]): unknown {
  for (const std of standards) {
    for (const c of std.criteria) {
      if (c.id === criterionId) return c;
    }
  }
  return null;
}

function resolveCwd(cwd: string): string {
  return isAbsolute(cwd) ? cwd : resolve(process.cwd(), cwd);
}

function readVerdict(params: Record<string, unknown>): "pass" | "fail" | "n/a" | undefined | Error {
  const v = params["verdict"];
  if (v === undefined) return undefined;
  if (v === "pass" || v === "fail" || v === "n/a") return v;
  return new Error(`attest.verdict must be one of "pass" | "fail" | "n/a".`);
}

function readScope(
  params: Record<string, unknown>,
): "project" | "file" | "line" | undefined | Error {
  const v = params["scope"];
  if (v === undefined) return undefined;
  if (v === "project" || v === "file" || v === "line") return v;
  return new Error(`attest.scope must be one of "project" | "file" | "line".`);
}

function readLocation(
  params: Record<string, unknown>,
  scope: "project" | "file" | "line" | undefined | Error,
): { filePath: string; line: number; column: number } | undefined | Error {
  const raw = params["location"];
  if (raw === undefined || raw === null) {
    if (scope === "file" || scope === "line") {
      return new Error(`attest.location is required when scope is "${scope}".`);
    }
    return undefined;
  }
  if (typeof raw !== "object") {
    return new Error("attest.location must be an object with filePath, line, and optional column.");
  }
  const loc = raw as Record<string, unknown>;
  const filePath = loc["filePath"];
  const line = loc["line"];
  const column = loc["column"];
  if (typeof filePath !== "string" || filePath.length === 0) {
    return new Error("attest.location.filePath must be a non-empty string.");
  }
  if (typeof line !== "number" || !Number.isInteger(line) || line < 1) {
    return new Error("attest.location.line must be a positive integer.");
  }
  const resolvedColumn = column === undefined ? 1 : column;
  if (
    typeof resolvedColumn !== "number" ||
    !Number.isInteger(resolvedColumn) ||
    resolvedColumn < 1
  ) {
    return new Error("attest.location.column must be a positive integer when provided.");
  }
  return { filePath, line, column: resolvedColumn };
}
