/**
 * Per-criterion attestation surface for the `checklist` tool.
 *
 * Given the loaded {@link AttestationRecord}s plus a git probe (the
 * stamp commit the attestations were recorded against and the set of
 * files changed between that stamp and HEAD), produce a per-criterion
 * summary the checklist item can spread verbatim:
 *
 *   - `verdict` — the attestation's explicit verdict, or `"pending"`
 *     when the record stored no verdict (unasserted claim).
 *   - `stale` — present as `true` when the stamp commit differs from
 *     HEAD AND at least one file in the attestation's scope has
 *     changed since the stamp. Omitted otherwise (honest shape per
 *     CLAUDE.md §1 "Ambiguous field shapes are dishonest").
 *   - `evidence` — the attestation's reason text, surfaced verbatim
 *     so the agent sees the original provenance without a second lookup.
 *   - `by` — the attester. Always included when present on the record.
 *
 * Doctrine (see docs/kb/architecture/ai-first-consumer.md): this is
 * SURFACE, not suppression. We never filter a criterion out because it
 * carries an attestation — the agent sees stale + verdicted both, and
 * decides whether to trust or re-verify. That's the whole point of
 * pairing the attestation ledger with a "surface, don't suppress"
 * checklist: stale attestations resurface automatically on code change
 * without the agent having to re-enumerate what's been claimed.
 *
 * Scope semantics:
 *   - `scope === "project"` (or missing) → stale whenever ANY file
 *     changed between the stamp and HEAD.
 *   - `scope === "file"` or `"line"` → stale only when the attestation's
 *     pinned file is in the changed-files set.
 *
 * When the git probe is unavailable (not a repo, git missing, stamp
 * couldn't be resolved), staleness is indeterminate — we surface the
 * attestation without the `stale` field rather than guess, matching the
 * present-when-meaningful rule.
 */

import type { AttestationRecord } from "../types/evidence.ts";
import { changedFilesBetween, headSha, stampCommitForTimestamp } from "../utils/git.ts";

export interface AttestationSurface {
  readonly verdict: "pass" | "fail" | "n/a" | "pending";
  readonly stale?: true;
  readonly evidence: string;
  readonly by?: string;
}

export interface AttestationStalenessProbe {
  /**
   * Returns `true` when the attestation is stale: stamp commit ≠ HEAD
   * AND at least one file in the attestation's scope has changed since
   * the stamp. `false` when the probe answered cleanly and nothing
   * relevant changed (or stamp === HEAD). `null` when the probe
   * couldn't answer — caller omits `stale` from the surface.
   *
   * Takes the record directly because the stamp commit depends on
   * `record.attestedAt` — different records over the same criterion
   * may have different stamps. The probe caches by `attestedAt` so
   * repeated criteria with the same stamp pay one git call.
   */
  readonly isStale: (record: AttestationRecord) => boolean | null;
}

/**
 * Picks the most relevant attestation record for a criterion from the
 * durable ledger. When multiple records speak to the same criterion we
 * prefer the most recent by `attestedAt` — that's the claim the agent
 * most likely cares about. Ties break on `by` (ascending) then
 * `reason` for determinism so snapshot tests stay stable.
 */
export function pickMostRecentAttestation(
  records: readonly AttestationRecord[],
): AttestationRecord | undefined {
  if (records.length === 0) return undefined;
  let best = records[0];
  for (let i = 1; i < records.length; i += 1) {
    const current = records[i];
    if (current === undefined || best === undefined) continue;
    if (compareAttestations(current, best) > 0) best = current;
  }
  return best;
}

function compareAttestations(a: AttestationRecord, b: AttestationRecord): number {
  if (a.attestedAt !== b.attestedAt) return a.attestedAt < b.attestedAt ? -1 : 1;
  if (a.by !== b.by) return a.by < b.by ? -1 : 1;
  if (a.reason !== b.reason) return a.reason < b.reason ? -1 : 1;
  return 0;
}

/**
 * Groups durable attestations by criterion ID. Records whose
 * `criterionId` doesn't match any enabled criterion still land in the
 * map — the caller is responsible for filtering by criterion
 * membership (it already knows which IDs it will iterate).
 */
export function indexAttestationsByCriterion(
  records: readonly AttestationRecord[],
): ReadonlyMap<string, readonly AttestationRecord[]> {
  const out = new Map<string, AttestationRecord[]>();
  for (const r of records) {
    let list = out.get(r.criterionId);
    if (list === undefined) {
      list = [];
      out.set(r.criterionId, list);
    }
    list.push(r);
  }
  return out;
}

/**
 * Builds the per-criterion attestation surface, if any record applies.
 *
 * Returns `undefined` when the criterion has no attestations — callers
 * conditionally spread the result so the `attestation` field stays
 * absent-when-meaningful (no empty-object placeholder).
 */
export function buildAttestationSurface(
  records: readonly AttestationRecord[],
  probe: AttestationStalenessProbe | undefined,
): AttestationSurface | undefined {
  const record = pickMostRecentAttestation(records);
  if (record === undefined) return undefined;
  const verdict = record.verdict ?? "pending";
  const staleResult = probe === undefined ? null : probe.isStale(record);
  const base: {
    verdict: "pass" | "fail" | "n/a" | "pending";
    evidence: string;
    by?: string;
  } = {
    verdict,
    evidence: record.reason,
    ...(record.by !== undefined && record.by.length > 0 ? { by: record.by } : {}),
  };
  return staleResult === true ? { ...base, stale: true as const } : base;
}

function scopedFilePath(record: AttestationRecord): string | null {
  if (record.scope === "file" || record.scope === "line") {
    return record.location?.filePath ?? null;
  }
  return null;
}

/**
 * Builds a staleness probe backed by git, rooted at `cwd`. The probe
 * resolves one stamp commit per distinct `attestedAt` on demand, then
 * enumerates the file set changed from that stamp to HEAD. Results are
 * cached so repeated criteria using the same stamp pay one git call.
 *
 * Returns `undefined` when `cwd` is not inside a git repo — the
 * checklist caller treats that as "probe unavailable" and omits `stale`
 * from every attestation surface, which is the honest shape (staleness
 * is indeterminate outside a repo; we don't guess).
 *
 * The probe's `isStale(scopedFilePath)` contract:
 *   - `null` → probe couldn't answer for this record (stamp couldn't
 *     resolve, git call failed). Caller omits `stale`.
 *   - `false` → stamp === HEAD, or no relevant file changed.
 *   - `true` → stamp differs from HEAD AND the scope intersects the
 *     changed-files set.
 */
export function createGitStalenessProbe(cwd: string): AttestationStalenessProbe | undefined {
  const head = headSha(cwd);
  if (head === null) return undefined;
  interface StampResolution {
    readonly stamp: string | null;
    readonly changed: ReadonlySet<string> | null;
  }
  const stampCache = new Map<string, StampResolution>();
  const resolveStamp = (attestedAt: string): StampResolution => {
    const cached = stampCache.get(attestedAt);
    if (cached !== undefined) return cached;
    const stamp = stampCommitForTimestamp(attestedAt, cwd);
    if (stamp === null) {
      const value: StampResolution = { stamp: null, changed: null };
      stampCache.set(attestedAt, value);
      return value;
    }
    const changed = changedFilesBetween(stamp, cwd);
    const value: StampResolution = { stamp, changed };
    stampCache.set(attestedAt, value);
    return value;
  };
  return {
    isStale: (record: AttestationRecord): boolean | null => {
      const { stamp, changed } = resolveStamp(record.attestedAt);
      if (stamp === null) return null;
      if (stamp === head) return false;
      if (changed === null) return null;
      const scoped = scopedFilePath(record);
      if (scoped === null) return changed.size > 0;
      return changed.has(scoped);
    },
  };
}
