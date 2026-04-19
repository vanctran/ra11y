/**
 * Converts inline pragma declarations into {@link AttestationRecord}s
 * so they flow into the evidence ledger alongside durable attestations
 * from `.ra11y/attestations.jsonl`.
 *
 * Only declarations that carry a non-empty `reason` become
 * attestations — a bare `ra11y-disable` silences violations but
 * doesn't assert anything. That's also why
 * `ra11y:suppression-no-reason` surfaces bare pragmas as review
 * candidates: the author punted the assertion.
 *
 * Token resolution (tokens appear in the pragma's rule list):
 *
 *   - `"*"` wildcard — skipped. The author suppressed everything on
 *     this line but didn't target a specific criterion. An attestation
 *     needs a concrete criterion to speak to.
 *   - Criterion ID (contains `":"`) — expanded through the
 *     criteria registry's equivalence closure and filtered to enabled
 *     standards. One attestation per resulting criterion ID so the
 *     pragma covers equivalents symmetrically with violations (which
 *     already fan out via StandardFilter).
 *   - Rule ID (no `":"`) — resolved against the rule registry and
 *     expanded through each `satisfies` criterion's equivalence
 *     closure. Unknown rule IDs are silently dropped (the scanner
 *     already warns elsewhere when a pragma names a rule that doesn't
 *     exist).
 *
 * Location: every attestation produced here carries
 * `scope: "line"` and the pragma's file + line. That's the honest
 * shape — pragma-derived attestations are pinned to source, in
 * contrast to durable project-level entries in
 * `.ra11y/attestations.jsonl`.
 */

import type { SuppressionDeclaration } from "../config/inline-disables.ts";
import type { AttestationRecord } from "../types/evidence.ts";
import type { Rule } from "../types/rule.ts";
import type { CriteriaRegistry } from "./registry/criteria.ts";

/** Everything a single file's pragma declarations need to resolve. */
export interface FileDeclarations {
  readonly filePath: string;
  readonly declarations: readonly SuppressionDeclaration[];
}

export interface ResolvePragmaAttestationsInputs {
  readonly files: readonly FileDeclarations[];
  readonly rules: readonly Rule[];
  readonly criteria: CriteriaRegistry;
  readonly enabled: ReadonlySet<string>;
  /**
   * ISO-8601 timestamp to stamp on every produced record. Callers pass
   * a single value per scan so all pragma-derived attestations share
   * the same `attestedAt`, matching the one-batch semantics.
   */
  readonly attestedAt: string;
  /**
   * Attestation author. Pragma-derived attestations inherit this so
   * consumers can distinguish "the author of the repo" from the
   * durable-store `by` field set by the `attest` MCP tool. Default
   * `"source-pragma"` keeps the provenance honest without forcing
   * callers to synthesize a user identity.
   */
  readonly by?: string;
}

const DEFAULT_BY = "source-pragma";

/**
 * Pure resolver. Given every file's declarations plus the enabled
 * rules and criteria, returns the attestation records that roll into
 * the evidence ledger. Same inputs → same output, byte-for-byte.
 */
export function resolvePragmaAttestations(
  inputs: ResolvePragmaAttestationsInputs,
): readonly AttestationRecord[] {
  const by = inputs.by ?? DEFAULT_BY;
  const rulesById = new Map(inputs.rules.map((r) => [r.id, r]));
  const out: AttestationRecord[] = [];
  for (const file of inputs.files) {
    for (const decl of file.declarations) {
      appendAttestationsForDeclaration({
        decl,
        filePath: file.filePath,
        rulesById,
        criteria: inputs.criteria,
        enabled: inputs.enabled,
        attestedAt: inputs.attestedAt,
        by,
        out,
      });
    }
  }
  return out;
}

interface AppendContext {
  readonly decl: SuppressionDeclaration;
  readonly filePath: string;
  readonly rulesById: ReadonlyMap<string, Rule>;
  readonly criteria: CriteriaRegistry;
  readonly enabled: ReadonlySet<string>;
  readonly attestedAt: string;
  readonly by: string;
  readonly out: AttestationRecord[];
}

function appendAttestationsForDeclaration(ctx: AppendContext): void {
  const reason = ctx.decl.reason;
  if (reason === undefined || reason.length === 0) return;
  const seen = new Set<string>();
  for (const token of ctx.decl.ruleIds) {
    if (token === "*") continue;
    const resolution = resolveToken(token, ctx.rulesById, ctx.criteria);
    for (const criterionId of resolution.criterionIds) {
      if (!isEnabled(criterionId, ctx.enabled)) continue;
      const dedupeKey = `${criterionId}\0${resolution.ruleId ?? ""}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      ctx.out.push({
        criterionId,
        ...(resolution.ruleId !== undefined && { ruleIds: [resolution.ruleId] }),
        by: ctx.by,
        reason,
        attestedAt: ctx.attestedAt,
        scope: "line",
        location: { filePath: ctx.filePath, line: ctx.decl.line, column: 1 },
      });
    }
  }
}

interface TokenResolution {
  /** Present when the token was a rule ID; attestations carry this through. */
  readonly ruleId: string | undefined;
  /** Criterion IDs the token expands to (via equivalence closure). */
  readonly criterionIds: readonly string[];
}

function resolveToken(
  token: string,
  rulesById: ReadonlyMap<string, Rule>,
  criteria: CriteriaRegistry,
): TokenResolution {
  if (token.includes(":")) {
    return { ruleId: undefined, criterionIds: criteria.equivalenceClosure(token) };
  }
  const rule = rulesById.get(token);
  if (!rule) return { ruleId: undefined, criterionIds: [] };
  const criterionIds: string[] = [];
  for (const critId of rule.satisfies) {
    for (const expanded of criteria.equivalenceClosure(critId)) {
      criterionIds.push(expanded);
    }
  }
  return { ruleId: token, criterionIds };
}

function isEnabled(criterionId: string, enabled: ReadonlySet<string>): boolean {
  const colon = criterionId.indexOf(":");
  if (colon < 0) return false;
  return enabled.has(criterionId.slice(0, colon));
}
