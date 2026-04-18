# 0007 — Rule-level `fixClass` metadata inlined onto every Violation

- Status: Accepted
- Date: 2026-04-17
- Supersedes: none
- Superseded by: none

## Context

An AI agent scanning a project via the ra11y MCP server needs to route each
finding to the right remediation lane — batch-apply the mechanical edits,
rewrite the prose-only ones, defer the runtime-dependent ones to the axe-core
side of the pipeline, and open the source file for the ones that only
resolve after reading adjacent code.

Today that routing decision requires a per-finding round-trip: call
`suggest_fix` for every violation and branch on the returned
`kind: "edit" | "guidance"` discriminator. On a report with a few hundred
findings that is a few hundred extra tool calls before the agent can even
begin batching.

A second problem is that `suggest_fix.kind` collapses the landscape into
two values. "Edit" vs "guidance" conflates three categories the agent
actually wants to separate:

- mechanical edits the agent can apply without looking at other files
- prose-only guidance (contrast ratios, copy rewrites)
- rules whose resolution requires reading adjacent code (handler-missing,
  nested-interactive) even though the scanner can emit no edit
- rules that can only be fully verified at runtime (focus traps,
  live-region announcements) — static analysis flags the pattern but the
  agent needs to route these into the Playwright/axe-core lane

## Decision

Introduce a Rule-level metadata field `fixClass: FixClass` with four
values:

```ts
export type FixClass =
  | "mechanical"       // deterministic source transform
  | "guidance"         // prose-only judgment
  | "runtime-only"     // needs runtime harness (axe-core, Playwright)
  | "verify-in-source" // agent reads adjacent code to decide
```

The field is required on every `Rule`. The engine stamps it onto every
`Violation` emitted by that rule during `stampViolation` in the rule
runner. The shared `buildAgentFinding` builder
(`src/output/agent-response/build-finding.ts`) — consumed by every MCP
tool response and the CLI agent formatter — forwards it verbatim.

### Name: `fixClass`, not `fix.kind`

The backlog item proposed nesting under a `fix` namespace. We rejected
that for two reasons:

1. `Violation.fix` already exists — it carries a structured auto-fixer
   edit (`type: "insert" | "replace" | "delete"`, `range`, `text`,
   `safety`). A sibling `fix.kind` with a different four-value enum on
   the same object shape collides semantically and confuses readers.
2. `suggest_fix` tool output carries its own `kind: "edit" | "guidance"`
   on a different axis ("what does the fix payload contain"). A
   Violation-level `fix.kind` with four values on the "what class of
   fix" axis compounds the naming collision.

`fixClass` is the unambiguous name and pairs with the kebab-case literal
string vocabulary without colliding with either existing field.

### Why rule-level, not per-finding synthesis

The fix class is a property of the rule's *nature*, not of a specific
instance. Every violation of `contrast/minimum` wants prose guidance;
every violation of `media/alt-text-missing` wants a deterministic attribute
insert. Synthesizing the class per-finding at the scanner would duplicate
rule-author knowledge into engine heuristics — the same anti-pattern
CLAUDE.md §14 warns against when it says rules are content, not engine
code.

### Why required, not optional

Optional means silent miss: a rule author forgets to declare the field,
the engine stamps nothing, and the agent's batch-router sees a finding
with no routing hint. Making it required on the `Rule` type is a compile-
time guard that every shipped rule classifies itself. The four-value
enum has at least one correct answer for every rule we will ever write,
so "no sensible value" isn't a real escape hatch.

### Default classification when unsure: `verify-in-source`

The safest fallback is "agent should read the surrounding code." That
wastes one file-open when the right answer was `mechanical` or
`guidance`; the other three directions risk silent misses (labelling a
prose-only rule as `mechanical` invites a wrong batch-apply).

## Consequences

- `Rule` type gains `fixClass: FixClass`. A new type `FixClass` lives in
  `src/types/rule.ts` alongside `Severity` / `RuleScope`.
- `Violation` type gains `fixClass: FixClass`. Required (the engine
  stamps it from rule metadata on every emit).
- Every rule under `src/rules/**` declares its `fixClass`. Bulk mechanical
  edit, one logical commit.
- `EmittedViolation = Omit<Violation, "ruleId" | "criteria" | "findingId" | "fixClass">`
  — rules don't know their own class at emit time any more than they
  know their own ID.
- `stampViolation` in `src/engine/rule-runner.ts` writes the class onto
  every emitted violation, including the synthetic `internal/rule-crash`
  case (classified as `verify-in-source` — the agent reads the crash
  message and the rule source).
- `buildAgentFinding` in `src/output/agent-response/build-finding.ts`
  forwards the new field through `fixClass`. That single builder
  backs both the MCP tool responses and the CLI agent formatter.
  `suggest_fix.kind` stays untouched — different axis, different name.
- Existing `plan.mechanicalEditsAvailable` / `plan.guidanceFixesAvailable`
  counters are unaffected — they count per-finding fix-payload presence,
  not rule-class. They remain the right shape; the new `fixClass` is
  additive.

## Alternatives considered

1. **Synthesize per-finding from `fixPaths.primary.edit` presence.**
   Rejected: a rule can emit a `fixPaths.primary.edit` for some findings
   but not others (e.g. `media/alt-text-missing` can mechanically insert
   `alt=""` when the image is decorative-looking, but needs agent
   judgment for content images). The rule's overall class doesn't change
   per-finding; per-finding fix-payload presence already has two dedicated
   top-level counters in `plan`.

2. **Reuse `suggest_fix.kind` vocabulary (`edit | guidance`).**
   Rejected: the two-value vocabulary collapses three distinct routing
   destinations into one bucket, which defeats the point of the inlined
   field.

3. **Optional field, computed lazily.**
   Rejected: silent-miss on forgotten declarations. Required + enum is
   the honest shape.
