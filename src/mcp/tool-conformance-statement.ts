/**
 * The `conformance_statement` MCP tool. Given a conformance profile
 * (standardId + level), inspects the evidence ledger produced by a
 * fresh scan and either returns a statement with `conformant: true`
 * or refuses with the full blocker list.
 *
 * This is the tool an agent calls after it believes the codebase is
 * ready to claim conformance (e.g. after fixing violations, running
 * manual review, and attesting n/a for media criteria in a text-only
 * app). The response's `blockers` array tells the agent exactly what
 * evidence is still missing, routed by `reason` to the next tool call
 * (`attest`, `suggest_fix`, `checklist`).
 *
 * Read-only and idempotent — same ledger + profile in, same statement
 * out. Doesn't mutate the project; the audit trail lives in
 * `.ra11y/attestations.jsonl` (via `attest`).
 */

import { runScan } from "../engine/scanner.ts";
import {
  buildConformanceStatement,
  type ConformanceProfile,
  renderConformanceMarkdown,
} from "../reports/conformance.ts";
import { BUILTIN_CANDIDATE_FINDERS } from "../review/index.ts";
import { BUILTIN_RULES } from "../rules/index.ts";
import { BUILTIN_STANDARDS } from "../standards/index.ts";
import {
  applyRuleSettings,
  errorResult,
  firstUnknownStandard,
  loadDurableAttestations,
  type McpTool,
  parseFiles,
  resolveLevel,
  resolveStandards,
  satisfyingRulesForCriterion,
  strArrayParam,
  strParam,
  textResult,
} from "./tools-helpers.ts";

export const conformanceStatementTool: McpTool = {
  def: {
    name: "conformance_statement",
    description:
      'Produce a conformance claim for this project against a WCAG (or other standard) profile. Returns `conformant: true` only when every in-scope criterion is backed by a non-candidate evidence source (static pass, attested, or sampled) with a final status of pass or n/a. Otherwise returns `conformant: false` plus a `blockers` list — one entry per criterion still missing evidence, with a `reason` routing the agent to the next tool:\n\n  - `"failing"` → call `suggest_fix` on the cited findings.\n  - `"candidate-only"` → call `attest` after reviewing, or dismiss with a source pragma.\n  - `"no-evidence"` → call `attest` to record the evidence, or run `checklist` to work through manual review.\n  - `"partially-attested"` → some rules under the criterion have been attested but the union does not yet cover every satisfying rule. Call `attest` with the missing `ruleIds` to close the gap (see ADR 0013).\n\nThe response also carries a Markdown rendering (`markdown` field) suitable for dropping into a release note or audit bundle. Read-only.',
    inputSchema: {
      type: "object",
      properties: {
        standard: {
          type: "string",
          description:
            "Standard ID (e.g. `wcag22`, `wcag21`, `section508`). Defaults to session config.",
        },
        level: {
          type: "string",
          enum: ["A", "AA", "AAA", "base"],
          description:
            "Conformance level to claim. A|AA|AAA for WCAG-like standards; `base` for standards that don't stratify by level (Section 508, plugins).",
        },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Optional scan paths. Omit to scan the whole project rooted at `cwd`.",
        },
        cwd: {
          type: "string",
          description:
            "Project root — used to resolve paths and load `.ra11y/attestations.jsonl`. Defaults to the MCP server's spawn directory.",
        },
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
      return errorResult({
        code: "standard-not-found",
        message: `Unknown standard '${unknown}'. Loaded: ${BUILTIN_STANDARDS.map((s) => s.id).join(", ")}.`,
        details: { requested: unknown, loaded: BUILTIN_STANDARDS.map((s) => s.id) },
        remediation: "Pass `standard` with a loaded ID, or omit to use the session default.",
      });
    }
    if (standards.length !== 1) {
      return errorResult({
        code: "invalid-param",
        message:
          "conformance_statement targets exactly one standard at a time. Pass `standard` explicitly when the session default resolves to more than one.",
        details: { requested: standards },
      });
    }
    const standardId = standards[0];
    if (standardId === undefined) {
      return errorResult({
        code: "invalid-param",
        message: "conformance_statement requires a `standard` value.",
      });
    }

    const levelParam = strParam(params, "level");
    const profile: ConformanceProfile = {
      standardId,
      level: resolveProfileLevel(levelParam, session),
    };

    const files = await parseFiles(paths, session, cwd);
    const attestations = await loadDurableAttestations(cwd);
    const { ledger } = runScan({
      standards: BUILTIN_STANDARDS,
      rules: applyRuleSettings(BUILTIN_RULES, session.config.rules),
      enabled: [standardId],
      files,
      finders: BUILTIN_CANDIDATE_FINDERS,
      ...(profile.level !== "base" && { level: profile.level }),
      ...(attestations.length > 0 && { attestations }),
    });

    const statement = buildConformanceStatement({
      ledger,
      profile,
      standards: BUILTIN_STANDARDS,
      rulesForCriterion: satisfyingRulesForCriterion,
    });

    return textResult({
      ...statement,
      markdown: renderConformanceMarkdown(statement),
      nextStep: statement.conformant
        ? "Conformant. Drop the `markdown` block into your release notes or audit bundle; commit `.ra11y/attestations.jsonl` so the evidence trail persists."
        : "Not conformant — read `blockers[]`. Each entry's `reason` tells you which tool to call next: `failing` → suggest_fix; `candidate-only` or `no-evidence` → attest (or checklist); `partially-attested` → attest with the missing ruleIds.",
    });
  },
};

function resolveProfileLevel(
  raw: string | undefined,
  session: { readonly config: { readonly level: "A" | "AA" | "AAA" } },
): "A" | "AA" | "AAA" | "base" {
  if (raw === "base") return "base";
  return resolveLevel(raw, session as never);
}
