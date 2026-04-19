# 0014 — Inherited findings at wrapper call sites

- Status: Accepted
- Date: 2026-04-18
- Supersedes: none
- Superseded by: none

## Context

[ADR 0012](./0012-wrapper-introspection-role.md) settled the *discovery*
surface for wrapper components: `nativeWrapperElements` is the
source of truth, `wrapper_introspect` is audit evidence, `wrapper/drift`
verifies the contract. The final row in 0012's role-split table —
"inherited finding at call site" — was deferred to a follow-up.

The concrete problem: a rule fires at a wrapper DEFINITION file
(e.g. `semantics/button-name` on `Button.tsx` because the
definition's `<button>` is unlabelled). The defect propagates to every
consumer of `<Button>` across the codebase, but no rule fires at those
call sites — the source-level evidence lives in the wrapper's body,
not at the consumer. A VPAT or conformance report that lists one
finding at `Button.tsx` silently under-counts the blast radius; an
agent reviewing the scan has no pointer from its current file back to
the wrapper whose definition is the real issue.

The synthesizer is a post-pass over the scan's violation set. For
each violation that fires at a declared wrapper's definition file, it
emits one additional `Violation` per call site in the scanned files,
with `confidence: "inherited"` and `sourceOfFinding` pointing at the
definition.

Three things this ADR does NOT do:

- Extend introspection discovery. 0012 already froze that surface.
- Crawl imports transitively. 0012's one-hop discipline applies.
- Change rule-author ergonomics. Rules remain pure and unaware of
  inheritance — this is an engine post-pass.

What it DOES do is pin the policy questions the implementation had to
answer: which field encodes inheritance, whether to cap, how the
synthesized findings interact with baseline / attestations /
polymorphic resolution, and whether to gate rollout behind a flag.

## Decision

**Synthesize one inherited finding per in-scope call site of every
declared native wrapper whose definition has a violation. No cap. No
flag. Always on.**

### Shape of the inherited finding

One new enum value on the existing `Violation.confidence` axis:

```ts
readonly confidence?: "high" | "medium" | "low" | "inherited";
```

Rationale for not introducing a separate axis: `confidence` already
carries scanner-level "how sure am I this is real" semantics
(Q2R2-CONF), distinct from severity. An inherited finding *is* still a
real defect — the severity is the rule's original severity, the
criterion is the rule's original criterion — but the evidence for it
lives elsewhere. Packing that onto the existing enum keeps
forwarders, filters, and report aggregators on a single axis rather
than forcing every consumer to branch on both `confidence` and
`inheritance`. The tradeoff: consumers that want to sort by classic
probabilistic confidence must skip `"inherited"` explicitly. The
agent-response layer already does this (unset confidence inherits
from severity; `"inherited"` is passed through verbatim).

Other fields on the synthesized violation:

| Field                  | Source                                           |
|------------------------|--------------------------------------------------|
| `ruleId`               | copied from origin                               |
| `fixClass`             | copied                                           |
| `criteria`, `criteriaTitles` | copied                                     |
| `severity`             | copied                                           |
| `location`             | **call site** — file, line, column               |
| `message`              | `` `[inherited from <Name>] ${origin.message}` `` |
| `suggestion`           | copied when present                              |
| `fix` / `fixPaths`     | **not copied** — the edit belongs at the definition |
| `snippet`              | not set on the inherited record                  |
| `confidence`           | `"inherited"`                                    |
| `sourceOfFinding`      | origin's `{ filePath, line, column? }`           |
| `findingId`            | **freshly minted** from `(ruleId, callSitePath, callSiteLineContext)` |
| `groupKey`             | **freshly minted** from `(ruleId, describeNodeShape(callSiteNode))` |
| `couldBeWrongBecause`  | copied when present                              |

`fix`/`fixPaths` are deliberately stripped: applying a call-site fix
would paper over the real defect. The agent reading
`sourceOfFinding` has the file and line it needs to fix the wrapper
body; the call site is there to show the blast radius, not to be
edited.

`snippet` is stripped for the same reason `fix` is — the call site is
evidence of impact, not the site to act on. The agent already has
`location` to Read the call site if it wants context.

### Cap policy — all call sites, no cap

This is the load-bearing doctrine call and the one 0012 explicitly
deferred. Two options were on the table:

1. Emit every in-scope call site.
2. Emit the top-N call sites (by some heuristic: first-seen, most
   distinct groupKeys, largest files).

The answer is (1), per
[`docs/kb/architecture/ai-first-consumer.md`](../kb/architecture/ai-first-consumer.md)
§"Surface, don't suppress" and §"Labeled buckets are suppression too":

- A cap picks a point on a continuous axis and hides everything
  beyond it — the silent-miss failure mode the doctrine exists to
  prevent. An agent reading a 40-call-site list dismisses the
  redundancy in one response; an agent that never sees sites 21..40
  cannot un-miss them.
- Any ranking the scanner could apply ("most relevant first") is a
  heuristic on weaker evidence than the agent has. The agent reads
  the call site and decides; ranking adds nothing it can audit.
- `groupKey` already gives agents the deduplication primitive they
  want: the same rule firing on AST-equivalent call sites shares a
  key, so "fix every finding with groupKey X" is one script, not
  forty round trips.

The deterministic escape hatch for noise is the source-level disable
pragma (ADR 0013) — an agent that has investigated and dismissed a
call site writes the pragma, the ledger records it, future scans
route the finding to a ledger attestation rather than a primary
finding. No bucket-then-filter.

### Deduplication with independent call-site findings

If a rule fires *both* at the wrapper definition AND independently at
a call site (e.g. the call site has its own offending attribute in
addition to inheriting one), the two findings coexist:

- The call-site primary: `confidence` unset (or `"high"`/`"medium"`/
  `"low"` per the rule), `sourceOfFinding` absent, `fix`/`fixPaths`
  populated.
- The inherited record from the wrapper: `confidence: "inherited"`,
  `sourceOfFinding` populated, `fix` absent.

Their `findingId`s differ (different line contexts). Their
`groupKey`s may or may not match depending on whether the
`describeNodeShape` output is identical — per [ADR 0008](./0008-violation-group-key.md)
groupKey is a `(ruleId, shape)` key without position, so two findings
on the same rule at AST-equivalent nodes collide by design. That is
the correct semantics: one fix recipe, two places to act.

### Scope boundary — "bounded by scanned files"

A call site is eligible iff it appears in a file the current
`runScan` parsed. No separate file-discovery pass, no import-graph
walk. Two concrete consequences:

- A `scan_file` or `--changed` invocation that touches only
  `Button.tsx` emits **zero** inherited findings — the call sites
  aren't in the scan set. This is honest: we cannot produce evidence
  at files we did not parse.
- A wrapper definition outside the scan set with call sites inside it
  emits zero inherited findings. The synthesizer has no definition
  file to key off. This matches 0012's one-hop discipline — no
  transitive crawl to pull the definition in.

Concrete implication for agents: run `scan_project` (not `scan_file`)
when you want the inherited-finding signal. The scan response's
`meta` already carries `filesScanned` and `filesByExtension` as
scan-confidence telemetry; an agent can tell whether inheritance had
material to work with.

### Interaction with baseline

Each inherited finding has its own `findingId` (call-site-derived)
and is therefore an independent baseline entry. Adopting a baseline
on a codebase with a pre-existing wrapper defect records both the
primary finding at `Button.tsx` AND one entry per call site.
Subsequent scans match all of them as grandfathered. This is correct
but has a load-bearing consequence: **fixing the wrapper** at
`Button.tsx` resolves the primary and the inherited entries in one
edit, and the next baseline `update` drops every inherited entry
alongside the primary.

No special-case baseline handling for inheritance was considered
warranted. The honest answer is "one logical violation maps to N
baseline rows," and baseline's existing per-`findingId` semantics
already handle the case — the edit that clears the primary also
clears every inherited entry on re-scan.

### Interaction with attestations (ADR 0013)

An attestation at the wrapper's criterion does not automatically
cover inherited findings — attestations key on `(criterionId, ruleIds?)`
(ADR 0013), not on `findingId`. Inherited findings carry the same
`ruleId` and `criteria` as the origin, so a rule-scoped attestation
of the origin's rule already covers the inherited records by
coverage-set membership. A criterion-wide attestation fans out to all
satisfying rules, which again covers inherited records by the same
mechanism.

The inherited records do **not** require separate attestation. This
matches the "one logical violation" framing: attestation is a claim
about a rule's verification, not about each emitted row.

The pragma resolver runs independently of the synthesizer. A
call-site pragma disabling a rule emits an attestation keyed on the
call site's file; whether that attestation participates in criterion
status is governed by 0013's coverage check. The inherited finding
itself is still emitted — pragmas are ledger evidence, not
emission filters.

### Interaction with polymorphic resolution

When a rule fires against a polymorphically resolved element (e.g.
`<Button as="a" href={...}>` re-runs `link-descriptive-text`), the
emitted violation's `location` is the call site, not the wrapper's
definition file. `shouldInherit` (see `src/engine/inherited-findings.ts`)
only inherits when the origin's `location.filePath` matches a
declared wrapper's definition path — so polymorphic re-dispatches
are invisible to the synthesizer and do not trigger a second round
of fan-out. Correct by construction.

An inherited finding that itself carries `sourceOfFinding` (the
synthesized records do) is skipped by `shouldInherit`, preventing
chain recursion through nested wrappers.

### Performance

The synthesizer is O(V + F·E) per scan: one pass over violations (V),
one pass over parsed JSX/TSX files (F) collecting JSX elements (E),
one hashmap lookup per inheritable violation. Call-site indexing
reuses `indexFilesByComponentName` from `src/engine/wrapper-probe.ts`
— no new traversal machinery.

No cache across runs. Within a run the work is bounded by files
already parsed; there is no additional filesystem I/O.

### Rollout — always on

A flag (`--inherited-findings`, or a config field) was considered as
a first-release hedge. Rejected: the same AI-first doctrine that
blocks a cap also blocks an opt-in flag. An agent cannot opt into a
signal it doesn't know is missing; a flag off by default for "the
first few releases to measure noise" is suppression at a different
level of the stack. "Noise" is the agent's word for "more findings
than I wanted to read"; the agent reads all of them in milliseconds
and dismisses by groupKey. A human-facing tool would gate this
behind a flag for attention-budget reasons; ra11y is not that tool.

Semver: additive. No existing consumer sees a new required field
(confidence has always been optional; `"inherited"` extends the
existing enum). Formatters that surfaced `confidence` already emit
the new value unchanged. No rule-author API change.

## Consequences

**Accepted:**

- `Violation.confidence` enum gains `"inherited"` (already landed —
  see `src/types/violation.ts`).
- New engine module `src/engine/inherited-findings.ts` implements the
  post-pass. The scanner calls it after primary + project rules run,
  before sort. ~130 LOC source.
- Baseline, attestations, pragma resolver, and polymorphic dispatch
  need no changes — the inherited records are first-class
  `Violation`s on every axis those subsystems key on.
- Formatters surfacing `sourceOfFinding` (agent, JSON, MCP) render
  the pointer back to the wrapper definition so agents route
  remediation to the right file.

**Rejected alternatives:**

- **Top-N cap.** Rejected per doctrine — see cap policy above.
- **Opt-in flag for the first few releases.** Rejected per doctrine
  — see rollout above.
- **Emit a separate `inheritedFindings` bucket on `ScanResult`.**
  Rejected — this is the labeled-bucket failure mode the doctrine
  names explicitly. Inherited findings are `Violation`s and belong
  in `violations[]` alongside primary findings, with `confidence:
  "inherited"` as the honest marker.
- **Copy `fix`/`fixPaths` onto the inherited record.** Rejected —
  applying a call-site fix would paper over the real defect at the
  wrapper. `sourceOfFinding` routes the agent to the right file;
  that's the honest affordance.
- **Transitive import crawl to pick up call sites in unparsed
  files.** Rejected per 0012's one-hop discipline — the scanner
  cannot produce evidence for files it did not parse, and an
  agent's `Read`+`Grep` is strictly better evidence than an in-tool
  chain resolver. "Bounded by scanned files" is load-bearing.
- **Automatic attestation or baseline fan-out for inherited
  records.** Rejected — the existing per-`findingId` baseline and
  per-`(criterionId, ruleIds)` attestation semantics already produce
  the right answer. No special-case plumbing needed.

## References

- [ADR 0008](./0008-violation-group-key.md) — `groupKey` semantics.
- [ADR 0012](./0012-wrapper-introspection-role.md) — wrapper
  introspection as audit signal; one-hop discipline; the role-split
  table this ADR closes out.
- [ADR 0013](./0013-rule-scoped-attestations.md) — rule-scoped
  attestations and coverage check.
- [`docs/kb/architecture/ai-first-consumer.md`](../kb/architecture/ai-first-consumer.md)
  — doctrine cited for the cap and rollout calls.
- `src/engine/inherited-findings.ts` — synthesizer implementation.
- `src/types/violation.ts` — `confidence` and `sourceOfFinding` field
  definitions.
