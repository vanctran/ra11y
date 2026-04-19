# 0017 — Conformance statement output

- Status: Proposed
- Date: 2026-04-18
- Supersedes: none
- Superseded by: none

## Context

ra11y already emits a `conformance_statement` MCP tool and enforces that it
refuses to produce output when any in-scope criterion lacks a positive source
(`src/reports/conformance.ts`). Per-criterion attestation surfacing landed in
the checklist report. What was missing was a pinned ADR specifying:

- the exact shape of the formal claim object;
- how evidence is cited per criterion (finding records, attestation records,
  verdicted review candidates);
- the distinction between a conformance statement (claim-facing, binary,
  commit-anchored) and a VPAT (procurement-facing, partial-compliance
  language, marketing artifact);
- the refusal semantics that make the statement honest rather than a silent
  partial claim.

A W3C conformance claim has six normative required fields
([WCAG 2.2 §5.5](https://www.w3.org/TR/WCAG22/#conformance-claims)):

1. Date of the claim.
2. Guidelines title, version, and URI.
3. Conformance level (A, AA, or AAA).
4. Concise description of the web pages (scope).
5. List of web content technologies relied upon.
6. (Optional) additional information — user-agent compatibility, methodology,
   reference to a VPAT.

For a static scanner, fields 4 and 5 require special treatment: scope is a
file set and commit hash, not a URL; technologies are derived from extension
analysis rather than declared in markup.

## Decision

**The conformance statement output is a typed claim object anchored to a
specific commit and evidence bundle. It is refused (not degraded) when any
required criterion has zero positive sources.**

### Output shape

```ts
interface ConformanceStatement {
  /** ISO 8601 date the claim was generated. */
  readonly date: string;
  /** Always "Web Content Accessibility Guidelines 2.2". */
  readonly guidelinesTitle: string;
  /** Always "https://www.w3.org/TR/WCAG22/". */
  readonly guidelinesUri: string;
  /** Version string, e.g. "2.2". */
  readonly guidelinesVersion: string;
  /** Highest level for which all criteria are positively sourced. */
  readonly conformanceLevel: "A" | "AA" | "AAA";
  /** Static-analysis scope — file set + commit anchor. */
  readonly scope: ConformanceScope;
  /** Derived from scanned file extensions + detected frameworks. */
  readonly technologiesReliedUpon: string[];
  /** Per-criterion positive evidence. */
  readonly evidence: ConformanceEvidence;
  /**
   * Present-when-nonempty: criteria that prevented issuance.
   * Absent on a fully-issued statement.
   */
  readonly blockers?: ConformanceBlocker[];
  /**
   * Reserved for tamper-evident signing.
   * Shape and semantics deferred to ADR 0018.
   */
  readonly signature?: unknown;
}

interface ConformanceScope {
  /** File paths included in the scan, relative to the repo root. */
  readonly files: string[];
  /** Git commit hash at scan time. Empty string when not in a git repo. */
  readonly commitHash: string;
  /** Snapshot of the ra11y.config.ts fields active during the scan. */
  readonly configSnapshot: Record<string, unknown>;
  /**
   * Process definitions folded into scope when `processes` config is present
   * (see ADR 0016). Absent when no process config was active.
   */
  readonly processes?: Array<{ name: string; pages: string[] }>;
}

interface ConformanceEvidence {
  /**
   * Finding IDs for criteria whose positive source is a rule-pass record.
   * When a rule fires no violations, cite its execution record ID here.
   */
  readonly findingIds: string[];
  /**
   * Attestation IDs for criteria whose positive source is an attestation
   * (ADR 0013). Covers both inline pragmas and MCP `attest` calls.
   */
  readonly attestationIds: string[];
  /**
   * Review candidate IDs marked `verdicted` for criteria whose positive
   * source is a human or agent verdict on a manual-review item.
   */
  readonly processLevelRefs?: string[];
}

interface ConformanceBlocker {
  readonly criterionId: string;
  readonly reason:
    | "no_positive_source"   // criterion has no finding, attestation, or verdict
    | "attested_fail"        // an attestation explicitly records a failure
    | "stale_attestation"    // attestation's commit anchor is older than threshold
    | "missing_process_config"; // process-level criterion with no processes config
  readonly details?: string;
}
```

`blockers` is present-when-nonempty (conditional spread at the response-assembly
site). An issued statement omits the field entirely rather than carrying
`blockers: []`. This follows the AI-first consumer model's rule on ambiguous
absent-vs-empty fields — a consumer that reads `blockers` present as meaningful
must not also read `blockers: []` as meaningful.

`signature` is reserved. ADR 0018 will spec tamper-evident signing (key
management, algorithm, what the signed payload is). Until ADR 0018 is accepted,
the field is typed `unknown` and omitted from issued statements.

### Refusal semantics

The report-builder in `src/reports/conformance.ts` MUST return:

```ts
{ status: "incomplete", blockers: ConformanceBlocker[] }
```

when any criterion in the active conformance profile has zero positive sources.
It MUST NOT emit a statement with empty or partial evidence — a partial
conformance claim is a dishonest claim.

This is load-bearing per CLAUDE.md §1 "honest failure over silent partial
claim" and the AI-first consumer model's "zero-output success is ambiguous
failure." An agent receiving `status: "incomplete"` with a `blockers` list
knows exactly which criteria are missing evidence and can call `checklist`,
`scan_process`, or `attest` to close the gaps. An agent receiving a silently
partial statement acts on bad data.

The refusal also covers the process-level case from ADR 0016: any criterion
that requires `processes` config (3.2.3, 3.2.4, 2.4.5) and has no process
config present emits `reason: "missing_process_config"` as a blocker.

### VPAT vs conformance statement

These are distinct artifacts that share the same evidence ledger:

| Dimension              | VPAT                                    | Conformance statement                    |
|------------------------|-----------------------------------------|------------------------------------------|
| Audience               | Procurement officers                    | Standards bodies, legal, internal audit  |
| Status language        | "Supports" / "Partially Supports" / "Does Not Support" / "Not Applicable" | Binary pass/refuse |
| Partial compliance     | First-class concept                     | Not representable; produces a refusal    |
| Anchoring              | Point-in-time snapshot, no commit req.  | Must cite a commit hash                  |
| Marketing artifact?    | Yes — intended for product sheets       | No — a legal/technical claim             |
| ra11y module           | `src/reports/vpat.ts`                   | `src/reports/conformance.ts`             |

Both reports consume the same evidence ledger (finding IDs, attestation IDs,
review candidate verdicts) assembled by `src/reports/evidence-ledger.ts`.
They differ only in presentation and what they will output when evidence is
incomplete.

**VPAT** surfaces partial coverage with per-criterion remarks and is always
emittable. **Conformance statement** is binary — it either reflects a
defensible claim or it refuses.

### Technologies-relied-upon derivation

`technologiesReliedUpon` is derived from the scanned file set at evidence-ledger
assembly time:

| Extension(s)           | Technology named                     |
|------------------------|--------------------------------------|
| `.html`                | HTML                                 |
| `.css`                 | CSS                                  |
| `.tsx`, `.jsx`         | HTML (React-derived), JavaScript, ARIA |
| `.ts`, `.js`           | JavaScript                           |
| Tailwind class hints   | CSS (Tailwind)                       |
| `aria-*` usage detected | ARIA                                |

The list is deduplicated and sorted. The W3C requirement is that the named
technologies are those the content *relies on* — not all technologies present.
ARIA is included when `aria-*` attributes appear in any scanned file. CSS
(Tailwind) is included only when the Tailwind detector fires. "JavaScript" is
not added for `.html`-only scans unless `<script>` elements are detected.

This list is load-bearing: the conformance claim reader needs to know which
technologies are in scope to assess whether their user-agent supports the claim.

### Scope description

ra11y is a static file scanner, not a deployed-page auditor. Scope is expressed
as a file set + commit anchor, not as URLs.

```ts
const scope: ConformanceScope = {
  files: [...parsedFilePaths],          // relative paths, sorted
  commitHash: gitRevParseHead(),        // "" when outside a git repo
  configSnapshot: activeConfigFields,   // ra11y.config.ts fields at scan time
  ...(processes ? { processes } : {}),  // present when ADR 0016 config is active
};
```

`configSnapshot` captures the `include`, `exclude`, `standard`, `level`,
`nativeWrappers`, and `processes` fields. It does not capture
secrets, absolute paths, or environment-specific values. Its purpose is to let
a reader reproduce the scan conditions from the statement alone.

If `commitHash` resolves to the empty string (the scanned tree is not a git
repository), the statement is issued but the scope carries an explicit warning
in `meta.warnings: ["no_commit_hash"]`. The claim is still defensible as of the
scan date; the commit anchor is absent rather than falsified.

### Evidence citation

Every criterion in the conformance profile must map to at least one of:

1. **`findingId`** — the execution record for a rule that produced zero
   violations against the criterion. The finding-ID format follows ADR 0011;
   a zero-violation run gets a synthetic record ID keyed on
   `(ruleId, scanId, "pass")`.
2. **`attestationId`** — an attestation record from ADR 0013 whose `criterionId`
   covers this criterion and whose `status` is `"pass"` or `"partial-pass"`.
3. **`processLevelRef`** — a `ReviewCandidate.id` whose `verdict` field is set
   to `"pass"` by a prior `checklist` call or `attest` call. Only applicable
   for criteria with manual-review candidates.

No hand-waving. Every supposedly-passing criterion points at an auditable,
machine-readable record. The evidence-ledger module (`src/reports/evidence-ledger.ts`)
assembles this index before the statement builder runs; the statement builder
reads the index and fails if any criterion has an empty evidence set.

## Consequences

**Accepted:**

- `ConformanceStatement` and supporting interfaces are the canonical output
  shape for `src/reports/conformance.ts` and the `conformance_statement`
  MCP tool.
- `src/reports/conformance.ts` enforces refusal semantics as specified — this
  behaviour is already present; the ADR makes it load-bearing policy.
- `src/reports/vpat.ts` and `src/reports/conformance.ts` share evidence-ledger
  assembly via `src/reports/evidence-ledger.ts`. No duplication.
- `technologiesReliedUpon` derivation lives in the evidence-ledger assembler,
  not in either report module, so both VPAT and conformance statement derive the
  same list from the same logic.
- `signature` is reserved as `unknown` until ADR 0018 is accepted. The field
  is omitted from issued statements; downstream consumers must not rely on its
  absence meaning "unsigned."
- `processes` in `ConformanceScope` is present-when-meaningful (ADR 0016 config
  active), absent otherwise. No `processes: null` or `processes: []` sentinel.

**Rejected alternatives:**

- **Emit a partial conformance statement with a `partialCoverage` flag.**
  Rejected — a partial claim is a dishonest claim. W3C conformance semantics
  are binary at each level; a claim that silently omits criteria is not a
  conformance claim at the cited level. Refusal with a `blockers` list is the
  only honest response.
- **Merge VPAT and conformance statement into one module.** Rejected — they
  have different audiences, different completeness semantics, and different
  legal implications. Shared evidence-ledger assembly is the right abstraction
  boundary.
- **Derive `technologiesReliedUpon` from an explicit user config field.**
  Rejected — this would require users to enumerate what the scanner already
  knows from the file set. Derivation from extensions is deterministic and
  requires no user burden. An explicit override field can be added later
  without a breaking change if a user needs to declare a technology not
  detectable from file extensions.
- **Include `signature` shape in this ADR.** Rejected — key management,
  algorithm selection, and payload scope for tamper-evident signing are
  non-trivial decisions that belong in their own ADR and their own
  implementation track. Reserving the field with type `unknown` keeps the door
  open without over-specifying.
- **Scope as URL set rather than file set.** Rejected — ra11y is a static
  scanner; it sees files, not deployed pages. Pretending the scope is URLs
  would require the caller to supply a URL mapping that ra11y cannot verify.
  File paths + commit hash are the honest scope representation for a
  file-based tool.

## Open questions

1. **Tamper-evident signing (deferred to ADR 0018).** What algorithm signs the
   claim payload? Who holds the key? Is it a symmetric HMAC tied to the repo
   secret, or an asymmetric detached signature? How does an agent verify a
   statement it receives from a third party? The `signature` field is reserved;
   nothing in this ADR should be interpreted as a signing commitment.

2. **Multi-scope claims.** A single product may have multiple scans — the
   checkout flow scanned Monday, the catalog pages scanned Tuesday, each with
   its own commit hash. Can a conformance statement span multiple scope objects?
   This ADR models a single scope (one `ConformanceScope`). Multi-scope claims
   would require a `scopes: ConformanceScope[]` variant and a policy on how
   blockers from different scopes compose. Deferred until a concrete need arises.

3. **Cross-standard equivalence and evidence deduplication.** When one
   attestation satisfies WCAG 2.2 1.4.3, Section 508 §1194.22(c), and EN 301
   549 9.1.4.3 simultaneously (via the equivalence index), the attestation ID
   appears in each standard's evidence block. This is probably correct — the
   same record supports three criteria — but the conformance statement format
   does not yet model per-standard evidence blocks. Factoring `evidence` into
   `{ [standardId: string]: ConformanceEvidence }` is deferred until a
   multi-standard conformance statement is concretely needed.

4. **Stale-attestation threshold.** `reason: "stale_attestation"` is defined in
   the blocker type but the staleness window (e.g. 90 days since the
   attestation's commit anchor) is not pinned here. The threshold should be
   configurable and should appear in `configSnapshot`. Deferred to the
   attestation implementation track.

## References

- [ADR 0011](./0011-evidence-as-first-class-primitive.md) — finding IDs as
  auditable records; the basis for citing a rule-pass by ID.
- [ADR 0013](./0013-rule-scoped-attestations.md) — attestation shape,
  `(criterionId, ruleIds?)` keying, and partial-pass semantics.
- [ADR 0014](./0014-inherited-findings.md) — inherited finding IDs as
  first-class evidence entries in the ledger.
- [ADR 0016](./0016-process-level-scope.md) — process-level scope config;
  refusal semantics for process-level criteria without process config.
- [`docs/kb/architecture/ai-first-consumer.md`](../kb/architecture/ai-first-consumer.md)
  — doctrine cited for refusal semantics, present-when-meaningful fields,
  and zero-output ambiguity.
- WCAG 2.2 §5.5 Conformance claims:
  https://www.w3.org/TR/WCAG22/#conformance-claims
- `src/reports/conformance.ts` — report-builder implementation.
- `src/reports/vpat.ts` — VPAT report; shares evidence-ledger with conformance.
- `src/reports/evidence-ledger.ts` — evidence assembly shared by both reports.
