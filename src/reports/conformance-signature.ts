/**
 * Tamper-evident signing for the conformance statement. Wraps a
 * canonicalized view of the inputs the claim stands on — the pinned
 * commit, the durable attestation ledger, the in-scope criterion set,
 * and a fingerprint of the active config — into a SHA-256 digest stamped
 * into {@link ConformanceStatement.signature}.
 *
 * The scope is deliberately "what would make the claim defensible if
 * re-audited at the same commit." Runtime results are out — an
 * agent-supplied runtime verdict feeds the ledger through `attest`, so
 * its provenance is already captured in the attestation record and
 * hashes in via the ledger bytes here. Anything hashed here is durable
 * on disk or in the config at scan time; nothing depends on a particular
 * process run.
 *
 * Canonicalization:
 *   - Attestation records sort by (criterionId, attestedAt, by) before
 *     serialization so ledger re-orderings (concurrent appends,
 *     jsonl compaction) don't drift the digest.
 *   - Criterion IDs sort lexicographically.
 *   - Standard IDs sort lexicographically.
 *   - Every object is serialized with sorted keys.
 *   - The bytes hashed are UTF-8 of the canonical JSON string.
 *
 * Verification compares a current signature input against the stamped
 * {@link ConformanceSignature.inputFingerprint} and returns the first
 * drift reason it finds — commit drift, attestation set mismatch,
 * in-scope criterion set mismatch, config mismatch, or digest mismatch.
 * Callers route on the returned `reason` string.
 */

import { createHash } from "node:crypto";
import type { AttestationRecord } from "../types/evidence.ts";

/**
 * The canonical inputs a conformance claim stands on. Kept small and
 * explicit — adding a field means a signature-scope change and a new
 * drift reason, not an incidental rollup.
 */
export interface SignatureInput {
  /** HEAD commit SHA at scan time. Empty string when not in a git repo. */
  readonly commitHash: string;
  /** The durable attestation ledger as read from disk. */
  readonly attestations: readonly AttestationRecord[];
  /** Criterion IDs in scope for the emitted statement. */
  readonly inScopeCriterionIds: readonly string[];
  /** Fingerprint of the scan-time config that shaped the claim. */
  readonly configFingerprint: {
    readonly standards: readonly string[];
    readonly level?: string;
  };
}

/**
 * The stamped signature block. Embedded on a conformant statement and
 * omitted when the statement refuses to emit.
 */
export interface ConformanceSignature {
  readonly algorithm: "sha256";
  /** Lowercase hex of the SHA-256 of the canonical JSON of {@link inputFingerprint}. */
  readonly digest: string;
  /** ISO-8601 timestamp the signature was produced. */
  readonly signedAt: string;
  /** The exact inputs the digest stands on, in canonical order. */
  readonly inputFingerprint: SignatureInput;
}

/** Verification outcome — `valid: true` or a specific drift `reason`. */
export type ConformanceVerificationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: ConformanceVerificationReason };

/**
 * Drift reasons. The codes are stable strings consumers can route on;
 * each points at a specific piece of the input that moved.
 */
export type ConformanceVerificationReason =
  | "commit-drift"
  | "attestation-set-mismatch"
  | "in-scope-criterion-mismatch"
  | "config-standards-mismatch"
  | "config-level-mismatch"
  | "digest-mismatch";

/**
 * Produces a {@link ConformanceSignature} over the given input. Pure
 * except for `signedAt` (ISO timestamp via `new Date().toISOString()`);
 * callers that need deterministic signatures across test runs should
 * pin `signedAt` through {@link signConformanceBundleAt}.
 */
export function signConformanceBundle(input: SignatureInput): ConformanceSignature {
  return signConformanceBundleAt(input, new Date().toISOString());
}

/**
 * Deterministic sibling of {@link signConformanceBundle} — the caller
 * supplies `signedAt`. Used by the ledger builder to pin the signature
 * timestamp to `ledger.meta.generatedAt`, so re-emitting a statement
 * over the same inputs at the same generation timestamp yields an
 * identical signature object (not just an identical digest).
 */
export function signConformanceBundleAt(
  input: SignatureInput,
  signedAt: string,
): ConformanceSignature {
  const canonical = canonicalizeInput(input);
  const digest = sha256Hex(canonicalJsonStringify(canonical));
  return {
    algorithm: "sha256",
    digest,
    signedAt,
    inputFingerprint: canonical,
  };
}

/**
 * Compares a stamped signature against the current view of the inputs.
 * Returns `{ valid: true }` when every scoped input matches and the
 * digest recomputes. Otherwise returns the first drift reason — the
 * order below is stable so consumers can write idempotent routing
 * logic over the `reason` string.
 */
export function verifyConformanceBundle(
  signature: ConformanceSignature,
  current: SignatureInput,
): ConformanceVerificationResult {
  const canonical = canonicalizeInput(current);
  const stamped = signature.inputFingerprint;

  if (stamped.commitHash !== canonical.commitHash) {
    return { valid: false, reason: "commit-drift" };
  }
  if (!sameStringList(stamped.inScopeCriterionIds, canonical.inScopeCriterionIds)) {
    return { valid: false, reason: "in-scope-criterion-mismatch" };
  }
  if (!sameStringList(stamped.configFingerprint.standards, canonical.configFingerprint.standards)) {
    return { valid: false, reason: "config-standards-mismatch" };
  }
  if (stamped.configFingerprint.level !== canonical.configFingerprint.level) {
    return { valid: false, reason: "config-level-mismatch" };
  }
  if (!sameAttestationList(stamped.attestations, canonical.attestations)) {
    return { valid: false, reason: "attestation-set-mismatch" };
  }
  const recomputed = sha256Hex(canonicalJsonStringify(canonical));
  if (recomputed !== signature.digest) {
    return { valid: false, reason: "digest-mismatch" };
  }
  return { valid: true };
}

// ─── Canonicalization ──────────────────────────────────────────────────────

/**
 * Normalizes the input to the canonical form the digest is computed
 * over. Sorts every list, drops `undefined` optional fields, and
 * returns a fresh object so the caller's input is not mutated.
 */
function canonicalizeInput(input: SignatureInput): SignatureInput {
  return {
    commitHash: input.commitHash,
    attestations: canonicalizeAttestations(input.attestations),
    inScopeCriterionIds: [...input.inScopeCriterionIds].sort(),
    configFingerprint: {
      standards: [...input.configFingerprint.standards].sort(),
      ...(input.configFingerprint.level === undefined
        ? {}
        : { level: input.configFingerprint.level }),
    },
  };
}

/**
 * Sort attestations by `(criterionId, attestedAt, by)`. Each field
 * within a record is already a string, so the composite sort is
 * stable and byte-identical across runs. Records themselves are
 * canonicalized via {@link canonicalizeAttestationRecord}.
 */
function canonicalizeAttestations(
  records: readonly AttestationRecord[],
): readonly AttestationRecord[] {
  return [...records].map(canonicalizeAttestationRecord).sort(compareAttestations);
}

function compareAttestations(a: AttestationRecord, b: AttestationRecord): number {
  const byCriterion = a.criterionId.localeCompare(b.criterionId);
  if (byCriterion !== 0) return byCriterion;
  const byStamp = a.attestedAt.localeCompare(b.attestedAt);
  if (byStamp !== 0) return byStamp;
  return a.by.localeCompare(b.by);
}

/**
 * Drops undefined optional fields and sorts `ruleIds` if present so
 * two attestations that differ only in ruleIds order hash the same.
 */
function canonicalizeAttestationRecord(record: AttestationRecord): AttestationRecord {
  return {
    criterionId: record.criterionId,
    by: record.by,
    reason: record.reason,
    attestedAt: record.attestedAt,
    ...(record.ruleIds === undefined ? {} : { ruleIds: [...record.ruleIds].sort() }),
    ...(record.scope === undefined ? {} : { scope: record.scope }),
    ...(record.location === undefined ? {} : { location: record.location }),
    ...(record.verdict === undefined ? {} : { verdict: record.verdict }),
  };
}

/**
 * JSON stringify with sorted keys at every object level. Arrays retain
 * their input order (canonicalization sorted them upstream). No spaces
 * or newlines — byte-identical output for byte-identical input.
 */
function canonicalJsonStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJsonStringify).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const key of keys) {
      const v = obj[key];
      if (v === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${canonicalJsonStringify(v)}`);
    }
    return `{${parts.join(",")}}`;
  }
  // `undefined`, functions, symbols — none of these should appear in
  // the signature input, but fall through to a null-token so a stray
  // value can't silently produce an unstable digest.
  return "null";
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

// ─── Comparators ───────────────────────────────────────────────────────────

function sameStringList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function sameAttestationList(
  a: readonly AttestationRecord[],
  b: readonly AttestationRecord[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const ai = a[i];
    const bi = b[i];
    if (ai === undefined || bi === undefined) return false;
    if (!sameAttestationRecord(ai, bi)) return false;
  }
  return true;
}

function sameAttestationRecord(a: AttestationRecord, b: AttestationRecord): boolean {
  if (a.criterionId !== b.criterionId) return false;
  if (a.by !== b.by) return false;
  if (a.reason !== b.reason) return false;
  if (a.attestedAt !== b.attestedAt) return false;
  if (a.scope !== b.scope) return false;
  if (a.verdict !== b.verdict) return false;
  if (!sameOptionalStringList(a.ruleIds, b.ruleIds)) return false;
  if (!sameOptionalLocation(a.location, b.location)) return false;
  return true;
}

function sameOptionalStringList(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return sameStringList(a, b);
}

function sameOptionalLocation(
  a: AttestationRecord["location"],
  b: AttestationRecord["location"],
): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return a.filePath === b.filePath && a.line === b.line && a.column === b.column;
}
