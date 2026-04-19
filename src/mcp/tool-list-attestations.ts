/**
 * The `list_attestations` MCP tool.
 *
 * Enumerates every durable attestation in `<cwd>/.ra11y/attestations.jsonl`,
 * freshness-annotated against the current git state. Lightweight: reads
 * the ledger and runs a single git probe — does NOT re-scan the tree —
 * so it's fast enough to power an attestation audit or pre-publish
 * readiness check without the cost of a full scan.
 *
 * Pairs with `attest` (durable write) and `attestations prune` (CLI
 * cleanup for deleted files). The durable ledger is the source of
 * truth; this tool is the enumerate-only view over it.
 *
 * Shape contract (AI-first doctrine, `docs/kb/architecture/ai-first-consumer.md`):
 *
 *   - `attestations: AttestationOut[]` is always present. An empty
 *     array is an affirmative fact ("no durable attestations on
 *     record") not an ambiguous empty — surface, don't omit.
 *   - Each entry mirrors the stored `AttestationRecord` shape plus a
 *     conditional `stale: true`. Fields never present as empty
 *     sentinels: `ruleIds`, `location`, and `stale` are all
 *     conditional-spread.
 *   - `stale: true` is emitted only when the git probe affirmatively
 *     answered "this record is stale": stamp commit differs from HEAD
 *     AND the scope intersects the changed-file set. Omitted when the
 *     probe returned `false` (cleanly fresh) OR `null` (probe couldn't
 *     answer this record) OR the probe itself was unavailable (not a
 *     git repo).
 *   - `meta.staleProbeUnavailable: true` is emitted only when `cwd` is
 *     not inside a git repo — the honest signal that staleness is
 *     indeterminate for every record in this response. Omitted
 *     otherwise. When the probe is unavailable the response also omits
 *     `staleCount` entirely — reporting `0` would be a lie (we don't
 *     know how many are stale; we couldn't check).
 *   - `nextStep` routes the agent: to `attestations prune` when all
 *     stale records are stale-due-to-deleted-files (handled by the
 *     CLI); otherwise to `attest` / re-attest when stale records need
 *     re-verification. Omitted when there's nothing actionable.
 */

import { readAttestations, resolveAttestationStorePath } from "../config/attestation-store.ts";
import {
  type AttestationStalenessProbe,
  createGitStalenessProbe,
} from "../reports/attestation-surface.ts";
import type { AttestationRecord } from "../types/evidence.ts";
import { gitRoot } from "../utils/git.ts";
import { applyMetaCacheMode, metaModeSchema } from "./meta-cache.ts";
import { type McpTool, strParam, textResult } from "./tools-helpers.ts";

/**
 * One attestation row, shaped for agent consumption.
 *
 * Conditional-spread discipline: `ruleIds`, `location`, and `stale`
 * are only present when meaningful. Downstream consumers branch on
 * key presence (`"stale" in entry`) rather than truthiness, so a
 * missing key and a falsy value are always distinguishable.
 */
export interface AttestationOut {
  readonly criterionId: string;
  readonly ruleIds?: readonly string[];
  readonly verdict: "pass" | "fail" | "n/a" | "pending";
  readonly scope: "project" | "file" | "line";
  readonly location?: { readonly filePath: string; readonly line: number; readonly column: number };
  readonly reason: string;
  readonly by: string;
  readonly attestedAt: string;
  readonly stale?: true;
}

export const listAttestationsTool: McpTool = {
  def: {
    name: "list_attestations",
    description:
      "List every durable attestation in `<cwd>/.ra11y/attestations.jsonl`, freshness-annotated against the current git state. Entries stamped against files changed since then surface `stale: true`. Read-only — does not run rules, does not modify the ledger. Pair with `attest` (durable write) and the `ra11y attestations prune` CLI for the full lifecycle. Outside a git repo, staleness is indeterminate and `meta.staleProbeUnavailable: true` is surfaced instead of per-record `stale` flags.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description:
            "Project root — the `.ra11y/attestations.jsonl` ledger is read from this path. Defaults to the host-declared root, then the git root of the MCP server's spawn directory, then process.cwd().",
        },
        metaMode: metaModeSchema,
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async handler(params, session) {
    const explicitCwd = strParam(params, "cwd");
    const spawnCwd = process.cwd();
    const hostRoot = explicitCwd === undefined ? session.firstRootPath() : null;
    const cwd = explicitCwd ?? hostRoot ?? gitRoot(spawnCwd) ?? spawnCwd;

    const records = await loadRecords(cwd);
    const probe = createGitStalenessProbe(cwd);
    const probeUnavailable = probe === undefined;

    const attestations = records.map((r) => buildOut(r, probe));
    const staleCount = probeUnavailable
      ? null
      : attestations.reduce((n, a) => n + (a.stale === true ? 1 : 0), 0);

    const fullMeta: Record<string, unknown> = {
      cwd,
      storePath: resolveAttestationStorePath(cwd),
      totalCount: attestations.length,
      // Conditional spread: `staleCount` only emits when the probe
      // answered. Reporting `0` under a probe we couldn't run would be
      // the silent-success failure shape CLAUDE.md §1 warns against —
      // "no stale records" and "we couldn't check" must stay
      // distinguishable.
      ...(staleCount === null ? {} : { staleCount }),
      // Conditional spread: `staleProbeUnavailable` only emits when
      // true. An explicit `false` would be clutter; absence carries
      // the "probe ran" signal on its own.
      ...(probeUnavailable ? { staleProbeUnavailable: true as const } : {}),
    };

    const nextStep = buildNextStep(attestations, probeUnavailable);

    return textResult({
      attestations,
      meta: applyMetaCacheMode({ toolName: "list_attestations", params, fullMeta, session }),
      ...(nextStep === undefined ? {} : { nextStep }),
    });
  },
};

/**
 * Reads the durable ledger, soft-failing to an empty list on any I/O
 * error. The read path is intentionally lenient — a malformed line
 * shouldn't stop the agent from seeing the valid entries around it
 * (the coercer already skips bad rows; this catches the hard-fail
 * envelope of a corrupted file or permissions error).
 */
async function loadRecords(cwd: string): Promise<readonly AttestationRecord[]> {
  try {
    return await readAttestations(cwd);
  } catch {
    return [];
  }
}

/**
 * Projects one stored record into the agent-facing output shape.
 *
 * Field semantics:
 *   - `verdict` defaults to `"pending"` when the record omitted one
 *     (unasserted claim) — same fallback the checklist surface uses.
 *   - `scope` defaults to `"project"` when omitted on the record —
 *     matches the `AttestationRecord` contract.
 *   - `stale` is spread only when the probe returned `true` for this
 *     record. A `false` or `null` probe result omits the field
 *     entirely (present-when-meaningful).
 */
function buildOut(
  record: AttestationRecord,
  probe: AttestationStalenessProbe | undefined,
): AttestationOut {
  const staleResult = probe === undefined ? null : probe.isStale(record);
  return {
    criterionId: record.criterionId,
    ...(record.ruleIds !== undefined && { ruleIds: record.ruleIds }),
    verdict: record.verdict ?? "pending",
    scope: record.scope ?? "project",
    ...(record.location !== undefined && { location: record.location }),
    reason: record.reason,
    by: record.by,
    attestedAt: record.attestedAt,
    ...(staleResult === true && { stale: true as const }),
  };
}

/**
 * Points the agent at the next productive call:
 *
 *   - Empty ledger → explicit acknowledgement plus a pointer to
 *     `attest` so the agent knows where durable claims live.
 *   - Probe unavailable (not a git repo) → acknowledge the
 *     indeterminacy and suggest running inside the project's git
 *     checkout.
 *   - Stale records present → re-attest or prune, depending on
 *     whether the staleness reflects file deletion or code drift.
 *     We surface both paths in the prose; the agent picks.
 *   - All fresh, populated ledger → nothing to do; omit `nextStep`.
 */
function buildNextStep(
  attestations: readonly AttestationOut[],
  probeUnavailable: boolean,
): string | undefined {
  if (attestations.length === 0) {
    return "Ledger is empty. Call `attest` to record a durable conformance claim (criterion + reason + verdict) to `.ra11y/attestations.jsonl`.";
  }
  if (probeUnavailable) {
    return "Staleness could not be determined — cwd is not inside a git repo. Re-run `list_attestations` from the project's git checkout if you need freshness annotations.";
  }
  const staleCount = attestations.reduce((n, a) => (a.stale === true ? n + 1 : n), 0);
  if (staleCount === 0) return undefined;
  const plural = staleCount === 1 ? "" : "s";
  return `${staleCount} stale attestation${plural} — the stamped commit differs from HEAD and at least one scoped file has changed. For records pinned to files that no longer exist, run \`ra11y attestations prune\`. For records whose code has drifted, re-verify and re-call \`attest\` so the ledger stays honest.`;
}
