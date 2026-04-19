/**
 * Conformance statement — the "can this codebase claim conformance?"
 * gate built on top of the evidence ledger.
 *
 * Given an {@link EvidenceLedger} and a {@link ConformanceProfile} (a
 * standard + level scope), the report inspects every criterion inside
 * the profile and either:
 *
 *   - Emits a statement with `conformant: true` when every in-scope
 *     criterion carries at least one non-`candidate` evidence source
 *     and its status is `"pass"` or `"n/a"`.
 *   - Refuses to emit (`conformant: false`) and lists every blocker —
 *     criteria that are still `"unknown"`, `"fail"`, or only backed by
 *     candidate sources. Each blocker names the criterion, its
 *     current status, and the reason it's blocking so the agent can
 *     route to `attest` / `suggest_fix` / `checklist` without a
 *     second round trip.
 *
 * The report is pure — same ledger + profile in, same statement out.
 * No disk IO, no randomness; the caller is responsible for surfacing
 * the statement (print, commit, ship to auditor).
 *
 * See docs/adr/0011-evidence-as-first-class-primitive.md for the
 * broader evidence model this report sits on top of.
 */

import type {
  AttestationRecord,
  CriterionEvidence,
  EvidenceLedger,
  EvidenceSource,
  EvidenceStatus,
} from "../types/evidence.ts";
import type { Standard } from "../types/standard.ts";
import {
  type ConformanceSignature,
  type SignatureInput,
  signConformanceBundleAt,
} from "./conformance-signature.ts";

/**
 * Defines the scope of a conformance claim. For WCAG, `level` narrows
 * to A / AA / AAA; for standards that don't have levels (Section 508,
 * some plugins), pass `"base"` to mean "every criterion."
 */
export interface ConformanceProfile {
  readonly standardId: string;
  readonly level: "A" | "AA" | "AAA" | "base";
}

/**
 * Why a specific criterion is blocking the conformance claim. Agents
 * route on `reason`:
 *   - `"no-evidence"` → call `attest` with a reason, or run manual
 *     review (`checklist`).
 *   - `"failing"` → call `suggest_fix` to resolve the violations.
 *   - `"candidate-only"` → the manual-review finder surfaced a
 *     location but no one has attested. Call `attest` or dismiss
 *     after reading.
 *   - `"partially-attested"` → some rules under this criterion have
 *     been attested but the union of attested `ruleIds` does not cover
 *     every satisfying rule. Call `attest` with the missing `ruleIds`
 *     (see ADR 0013).
 */
export type ConformanceBlockerReason =
  | "no-evidence"
  | "failing"
  | "candidate-only"
  | "partially-attested";

export interface ConformanceBlocker {
  readonly criterionId: string;
  readonly title: string;
  readonly level: string;
  readonly status: EvidenceStatus;
  readonly reason: ConformanceBlockerReason;
  /**
   * Count of attested sources that backed this criterion. Zero when
   * the criterion is blocked by `no-evidence` or `candidate-only`.
   * Non-zero `attested` count with a `failing` status means at least
   * one attested-fail source overrode a would-be pass.
   */
  readonly attestedSources: number;
  /**
   * Count of static violations against this criterion. Non-zero
   * counts are the primary signal for `reason: "failing"`.
   */
  readonly staticSources: number;
  /** Count of candidate pointers surfaced by review finders. */
  readonly candidateSources: number;
  /**
   * Present when `reason === "partially-attested"`: the rule IDs under
   * this criterion that have not yet been attested. The agent can pass
   * these directly to `attest({ criterionId, ruleIds })` to close the
   * coverage gap. Omitted for other blocker reasons.
   */
  readonly missingRuleIds?: readonly string[];
}

export interface ConformanceStatement {
  readonly profile: ConformanceProfile;
  readonly generatedAt: string;
  readonly conformant: boolean;
  /**
   * Criteria the profile asked about. `criteriaInScope` is the
   * denominator of the claim; `blockers.length` is the gap. When
   * `conformant === true`, `blockers` is empty.
   */
  readonly criteriaInScope: number;
  readonly blockers: readonly ConformanceBlocker[];
  /** Per-status tallies across in-scope criteria. */
  readonly summary: {
    readonly pass: number;
    readonly fail: number;
    readonly partial: number;
    readonly unknown: number;
    readonly na: number;
  };
  /**
   * Tamper-evident signature over the inputs the claim stands on —
   * commit hash, attestation ledger, in-scope criterion set, and
   * config fingerprint. Present only when the statement is conformant
   * and the caller supplied the signing inputs. Omitted on refusal
   * so the field is not a false assurance over a partial claim.
   */
  readonly signature?: ConformanceSignature;
}

export interface BuildConformanceStatementInputs {
  readonly ledger: EvidenceLedger;
  readonly profile: ConformanceProfile;
  readonly standards: readonly Standard[];
  /**
   * Returns the rule IDs that satisfy the given criterion (via the
   * satisfying-rules index on the scanner's registries). Used by this
   * builder only to populate `missingRuleIds` on `partially-attested`
   * blockers so agents can call `attest` with an actionable ruleIds
   * list. When omitted, `missingRuleIds` is not populated — today's
   * callers that don't have a rules registry still get a correct
   * statement, just without the drill-down hint. See ADR 0013.
   */
  readonly rulesForCriterion?: (criterionId: string) => readonly string[];
  /**
   * Signing inputs for the tamper-evident signature stamped on a
   * conformant statement. When present and the claim is conformant,
   * the builder computes a SHA-256 over the canonicalized
   * (commit hash, attestation ledger, in-scope criterion set, config
   * fingerprint) bundle and attaches it as `statement.signature`.
   * Omitted → no signature field is emitted. The statement is still
   * refused (no signature) when any blocker remains.
   */
  readonly signing?: {
    readonly commitHash: string;
    readonly attestations: readonly AttestationRecord[];
    readonly configFingerprint: {
      readonly standards: readonly string[];
      readonly level?: string;
    };
  };
}

/**
 * Builds a {@link ConformanceStatement}. Refuses to emit
 * `conformant: true` unless every criterion in scope has at least
 * one non-`candidate` evidence source with a final status of `pass`
 * or `n/a`.
 */
export function buildConformanceStatement(
  inputs: BuildConformanceStatementInputs,
): ConformanceStatement {
  const standard = inputs.standards.find((s) => s.id === inputs.profile.standardId);
  if (!standard) {
    throw new Error(
      `ra11y: conformance profile references standard '${inputs.profile.standardId}' which is not loaded.`,
    );
  }
  const inScope = standard.criteria.filter((c) => isInLevel(c.level, inputs.profile.level));
  const ledgerByCriterion = new Map(inputs.ledger.entries.map((e) => [e.criterionId, e] as const));

  const blockers: ConformanceBlocker[] = [];
  const summary = { pass: 0, fail: 0, partial: 0, unknown: 0, na: 0 };
  for (const criterion of inScope) {
    const entry = ledgerByCriterion.get(criterion.id);
    const counts = countSources(entry?.sources ?? []);
    const status: EvidenceStatus = entry?.status ?? "unknown";
    tallySummary(summary, status);
    const reason = classifyBlocker(status, counts, entry);
    if (reason !== null) {
      blockers.push(
        buildBlocker(criterion, status, reason, counts, entry, inputs.rulesForCriterion),
      );
    }
  }

  const conformant = blockers.length === 0;
  const signature =
    conformant && inputs.signing !== undefined
      ? signConformanceBundleAt(
          buildSignatureInput(inputs.signing, inScope),
          inputs.ledger.meta.generatedAt,
        )
      : undefined;
  return {
    profile: inputs.profile,
    generatedAt: inputs.ledger.meta.generatedAt,
    conformant,
    criteriaInScope: inScope.length,
    blockers,
    summary,
    ...(signature !== undefined && { signature }),
  };
}

/**
 * Packs the caller-supplied signing inputs together with the derived
 * in-scope criterion ID list into the {@link SignatureInput} the
 * signing module canonicalizes. The builder owns the in-scope list
 * (it already walked the profile to compute blockers), so the caller
 * only supplies the pieces the builder can't infer.
 */
function buildSignatureInput(
  signing: NonNullable<BuildConformanceStatementInputs["signing"]>,
  inScope: readonly Standard["criteria"][number][],
): SignatureInput {
  return {
    commitHash: signing.commitHash,
    attestations: signing.attestations,
    inScopeCriterionIds: inScope.map((c) => c.id),
    configFingerprint: signing.configFingerprint,
  };
}

interface SummaryTally {
  pass: number;
  fail: number;
  partial: number;
  unknown: number;
  na: number;
}

function tallySummary(summary: SummaryTally, status: EvidenceStatus): void {
  if (status === "pass") summary.pass += 1;
  else if (status === "fail") summary.fail += 1;
  else if (status === "partial") summary.partial += 1;
  else if (status === "n/a") summary.na += 1;
  else summary.unknown += 1;
}

function buildBlocker(
  criterion: Standard["criteria"][number],
  status: EvidenceStatus,
  reason: ConformanceBlockerReason,
  counts: SourceCounts,
  entry: CriterionEvidence | undefined,
  rulesForCriterion: ((criterionId: string) => readonly string[]) | undefined,
): ConformanceBlocker {
  const missingRuleIds =
    reason === "partially-attested" && rulesForCriterion !== undefined
      ? computeMissingRuleIds(rulesForCriterion(criterion.id), entry?.sources ?? [])
      : undefined;
  return {
    criterionId: criterion.id,
    title: criterion.title,
    level: criterion.level,
    status,
    reason,
    attestedSources: counts.attested,
    staticSources: counts.static,
    candidateSources: counts.candidate,
    ...(missingRuleIds !== undefined && { missingRuleIds }),
  };
}

/**
 * Markdown renderer for the conformance statement — the shape an
 * auditor or release process can drop into a release note or
 * compliance bundle. Minimal: title, profile, verdict, counts, and
 * a blocker table when not conformant.
 */
export function renderConformanceMarkdown(statement: ConformanceStatement): string {
  const lines: string[] = [];
  const { profile, generatedAt, conformant, criteriaInScope, summary, blockers } = statement;
  lines.push(`# Conformance Statement — ${profile.standardId} ${profile.level}`);
  lines.push("");
  lines.push(`- Generated: ${generatedAt}`);
  lines.push(`- Criteria in scope: ${criteriaInScope}`);
  lines.push(
    `- Status: **${conformant ? "CONFORMANT" : "NOT CONFORMANT"}** (pass=${summary.pass}, fail=${summary.fail}, partial=${summary.partial}, unknown=${summary.unknown}, n/a=${summary.na})`,
  );
  lines.push("");
  if (conformant) {
    lines.push(
      `Every criterion in scope is backed by at least one non-candidate evidence source with a final status of pass or n/a.`,
    );
    return lines.join("\n");
  }
  lines.push(`## Blockers`);
  lines.push("");
  lines.push(`| Criterion | Title | Level | Status | Reason | Static | Attested | Candidate |`);
  lines.push(`|---|---|---|---|---|---:|---:|---:|`);
  for (const b of blockers) {
    lines.push(
      `| ${b.criterionId} | ${escapePipe(b.title)} | ${b.level} | ${b.status} | ${b.reason} | ${b.staticSources} | ${b.attestedSources} | ${b.candidateSources} |`,
    );
  }
  return lines.join("\n");
}

function isInLevel(criterionLevel: string, target: "A" | "AA" | "AAA" | "base"): boolean {
  if (target === "base") return true;
  if (criterionLevel === "A") return true;
  if (criterionLevel === "AA") return target === "AA" || target === "AAA";
  if (criterionLevel === "AAA") return target === "AAA";
  return false;
}

interface SourceCounts {
  readonly static: number;
  readonly attested: number;
  readonly candidate: number;
  readonly sampled: number;
}

function countSources(sources: readonly EvidenceSource[]): SourceCounts {
  let s = 0;
  let a = 0;
  let c = 0;
  let sp = 0;
  for (const src of sources) {
    if (src.kind === "static") s += 1;
    else if (src.kind === "attested") a += 1;
    else if (src.kind === "candidate") c += 1;
    else if (src.kind === "sampled") sp += 1;
  }
  return { static: s, attested: a, candidate: c, sampled: sp };
}

function computeMissingRuleIds(
  satisfyingRules: readonly string[],
  sources: readonly EvidenceSource[],
): readonly string[] {
  const covered = new Set<string>();
  let isUniversal = false;
  for (const s of sources) {
    if (s.kind !== "attested") continue;
    const verdict = s.verdict ?? "pass";
    if (verdict !== "pass") continue;
    if (s.ruleIds === undefined) {
      isUniversal = true;
      break;
    }
    for (const r of s.ruleIds) covered.add(r);
  }
  if (isUniversal) return [];
  return satisfyingRules.filter((r) => !covered.has(r));
}

function classifyBlocker(
  status: EvidenceStatus,
  counts: SourceCounts,
  entry: CriterionEvidence | undefined,
): ConformanceBlockerReason | null {
  if (status === "fail") return "failing";
  if (status === "partial") return "partially-attested";
  if (status === "pass" || status === "n/a") {
    // Pass/n/a are only honest when they stand on a non-candidate
    // source. Without one, the "pass" is the automatable-with-no-
    // sources default from the ledger — no evidence was actually
    // collected. Promote to blocker.
    if (counts.static === 0 && counts.attested === 0 && counts.sampled === 0) {
      return "no-evidence";
    }
    return null;
  }
  if (entry && counts.candidate > 0) return "candidate-only";
  return "no-evidence";
}

function escapePipe(s: string): string {
  return s.replace(/\|/g, "\\|");
}
