# 0010 — `coverage` and `checklist` stay separate; sharpen the boundary

- Status: Accepted
- Date: 2026-04-18
- Supersedes: none
- Superseded by: none

## Context

A round-2 consumer eval flagged that three MCP surfaces report the same
automated pass rate — `scan_project.plan`, `coverage[].automatedCriteriaPassRate`,
and `checklist.summary.automatedCoverage` — and that `coverage` and `checklist`
overlap enough (per-standard pass rate, `untargetedCriteria` count,
`likelyIrrelevant` list) that an agent cannot tell which one to call first.

Two options were raised:

- **A.** Merge into one tool with `verbosity: "summary" | "candidates"`.
- **B.** Keep both; document that `coverage` is `checklist` minus file:line
  snippets; make each tool's `nextStep` point at the other.

Three prior ADRs constrain the choice:

- CLAUDE.md §1 "Interrogate the problem before accepting the solution's
  shape" — field reports ship the *problem* (overlap looks redundant), not
  evidence of a structural gap. Check whether the capabilities are
  genuinely one concept before collapsing them.
- CLAUDE.md §1 "One tool call should answer 'what next?'" — cross-surface
  counts must agree, and `nextStep` is the canonical follow-up hint.
- CLAUDE.md §12 semver — removing a tool or renaming its output shape is
  a major bump. We're in v0.2.0.

## Decision

**Option B with teeth.** `coverage` and `checklist` remain two tools in
v0.2.0. Their overlap is tightened by splitting concerns along a sharp
axis, trimming redundant payload, and cross-pointing `nextStep`.

### The two tools answer different questions

| Question the agent is asking | Tool |
|---|---|
| "Am I done? What is the compliance state per standard right now?" | `coverage` |
| "What should I manually review next, and where?" | `checklist` |

`coverage` is the **compliance dashboard** — per-standard pass rate,
automatable/passing/failing counts, untargeted count, irrelevant list,
failing-automated titles. No file:line. No candidates. It's what the agent
returns to the user to answer "how close are we to AA?".

`checklist` is the **workflow queue** — actionable manual items paired
with concrete candidate locations (file:line + snippet + reason +
confidence), priority-bucketed, paginated. It's what the agent iterates
through to drive the review session.

### Mandatory boundary rules

1. **`coverage` never emits `candidates[]`** (file:line review pointers).
   Adding them would recreate `checklist`.
2. **`checklist` never emits `failingAutomatedCriteria`, `criteriaTotal`,
   `criteriaAutomatable`, or `criteriaAutomatablePassing`.** Those are
   compliance-dashboard fields; the agent reads them from `coverage`.
3. **`checklist.summary.automatedCoverage` drops to a one-field gloss**:
   `{ standardId, automatedCriteriaPassRate }` — a headline number for
   context, nothing more. The full shape stays in `coverage`.
4. **Both tools keep `untargetedCriteria: number`** and
   `likelyIrrelevant: …[]`. Those are the manual-review axis; both tools
   need them to frame their output honestly. They must be computed from
   the same `manualApplicability` pass so the scalars agree.

Rule 3 is the acute fix for the "three places reporting the same shape"
complaint — the pass-rate *number* is honest in two places (compliance
report vs. workflow-queue context), but the full per-standard block is
canonical in `coverage` only.

### Cross-pointing `nextStep`

Both tools gain `nextStep: string` + `nextStepStructured: { tool, args }`
pairs following the P1-K contract.

- **`coverage`** — new `nextStep`. When `manualWithCandidates` is
  non-empty, points at `checklist`:
  `"Call 'checklist' to work through the manual criteria with concrete
   candidates."` with `nextStepStructured: { tool: "checklist", args: {
   cwd, standard?, level? } }`. When it is empty but `failingAutomatedCriteria`
  is non-empty, points at `scan_project` instead. Both fields omitted
  when the report is clean — same conditional-spread discipline as
  `scan_project`.
- **`checklist`** — new `nextStep`. When `actionable.length === 0`,
  points at `coverage`:
  `"No actionable manual items. Call 'coverage' for the compliance
   dashboard."` When the page is truncated (`truncated: true`), points at
  the same tool with `offset: nextOffset`. Otherwise omitted.

### Semver

Minor bump — `nextStep` fields are additive; the drop of
`criteriaTotal` / `criteriaAutomatable` / `criteriaAutomatablePassing` /
`failingAutomatedCriteria` from `checklist.summary.automatedCoverage` is
a narrow output-shape break. Called out in CHANGELOG under Changed. The
field still exists; it just carries one key instead of four.

### Deferred to v1.0.0

A unified tool (`evaluate(verbosity: "summary" | "candidates" | "both")`)
may still make sense once the v0.2.0 consumer feedback arrives. Track
that as a candidate for v1.0.0 with a deprecation alias path — not in
this batch.

## Consequences

- `tool-coverage.ts` grows a `nextStep` + `nextStepStructured` pair
  (emitted via the existing `buildNextStep` helper pattern; `next-step.ts`
  already centralizes structured-next-step construction for scan tools).
- `tool-checklist.ts` trims `automatedCoverage` to `{ standardId,
  automatedCriteriaPassRate }` and adds its own `nextStep` pair.
- New cross-tool invariant test under `tests/integration/mcp-consistency/`:
  `coverage.untargetedCriteria` sum ≡ `checklist.summary.untargetedCriteria`
  ≡ `scan_project.plan.untargetedCriteria` on the same scan. We already
  have `untargetedCriteria` parity covered partially via Q2R2-UNTARGETED-NAME
  (landed); this ADR formalizes it as a boundary invariant.
- `docs/mcp/tools.md` gets a "When to call `coverage` vs `checklist`"
  paragraph anchored to these rules.

## Alternatives considered

1. **Merge to one tool with `verbosity`.** Rejected for v0.2.0: the two
   workflows (compliance claim vs review iteration) are different enough
   that a verbosity knob would hide intent, and the merge is a breaking
   MCP shape change for every existing caller. Keep the option open for
   v1.0.0 with an explicit deprecation path.

2. **Keep both tools unchanged, only cross-link `nextStep`.** Rejected:
   leaves the "same pass-rate block in two places" honesty gap that
   motivated the field report. Trimming `automatedCoverage` on
   `checklist` is cheap and eliminates the duplication cleanly.

3. **Move `nextStep` into shared meta on every response.** Rejected as
   scope creep — parity with the rest of the MCP surface is the goal,
   not a new meta envelope. `scan_project` and `scan_file` carry
   top-level `nextStep` pairs today; coverage and checklist match that
   shape.
