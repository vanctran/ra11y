---
title: "Inherited findings"
topic: architecture
audience: agents, contributors
summary: "Post-scan synthesizer that emits confidence:inherited Violation records at every wrapper call site when the wrapper definition has a finding, carrying sourceOfFinding back to the definition and groupKey for batch remediation."
---

# Inherited findings

When a rule fires at a wrapper component's *definition* file — say `semantics/button-name` on `Button.tsx` — the defect propagates to every consumer of `<Button>` in the codebase. Without explicit attribution, a scan that lists one finding at `Button.tsx:12` silently undercounts the blast radius. An agent reviewing the scan has no pointer from a call site back to the wrapper whose definition is the real issue; fixing the wrapper is silently safe, breaking it is silently catastrophic.

The inherited-findings synthesizer closes this asymmetry. It is an engine post-pass that adds one `Violation` per `(definition finding, call site)` pair — stamped with `confidence: "inherited"` and `sourceOfFinding` pointing at the definition — so the full impact surface is visible without any rule needing to know about wrappers.

See [ADR 0014](../../adr/0014-inherited-findings.md) for the full decision rationale; this page is the runtime walkthrough.

## Shape of an inherited finding

An inherited `Violation` carries the following fields. Compare against a primary finding at the same rule:

| Field | Inherited value | Primary value |
|---|---|---|
| `ruleId` | copied from origin | set by rule |
| `severity` | copied | set by rule |
| `criteria`, `criteriaTitles` | copied | set by rule + engine |
| `fixClass` | copied | set by rule |
| `location` | **call site** file, line, column | definition site |
| `message` | `[inherited from <Button>] <origin message>` | rule message |
| `confidence` | `"inherited"` | `"high"` / `"medium"` / `"low"` / absent |
| `sourceOfFinding` | `{ filePath, line, column? }` of the definition | absent |
| `suggestion` | copied when present | set by rule |
| `fix` / `fixPaths` | **not present** | set by rule |
| `snippet` | **not present** | set by rule |
| `findingId` | freshly minted from `(ruleId, callSitePath, callSiteLineContext)` | minted from definition |
| `groupKey` | freshly minted from `(ruleId, describeNodeShape(callSiteNode))` | minted from definition |
| `couldBeWrongBecause` | copied when present | set by rule |

`fix` and `fixPaths` are deliberately stripped. The edit belongs at the wrapper definition, not at the call site. `sourceOfFinding` routes the agent to the correct file; the call-site location shows the blast radius. `snippet` is stripped for the same reason — the call site is evidence of impact, not the site to act on.

## Invariants

**What triggers inheritance.** A finding is eligible when all of the following hold:

1. `v.location.filePath` matches the definition path of a declared `nativeWrapperElements` entry.
2. `v.ruleId !== "wrapper/drift"` — drift findings live at the definition and have no call-site meaning.
3. `v.ruleId !== "internal/rule-crash"` — synthesized error findings are not propagated.
4. `v.sourceOfFinding === undefined` — a finding that is already inherited (carries `sourceOfFinding`) is skipped. This prevents chain recursion through nested wrappers.

**Scope boundary.** Call sites are eligible only when they appear in a file the current `runScan` parsed. No import-graph walk, no transitive crawl. A `scan_file` or `--changed` invocation that touches only `Button.tsx` emits zero inherited findings — the call sites are not in the scan set. This is honest per ADR 0012's one-hop discipline: the scanner cannot produce evidence for files it did not parse.

**No cap.** Every in-scope call site is emitted. The cap call in ADR 0014 was explicitly rejected per the "Surface, don't suppress" doctrine — a cap picks a point on a continuous axis and hides everything beyond it. The agent reads all call sites and dismisses by `groupKey`; it cannot un-miss a capped site.

**Self-renders are skipped.** The synthesizer skips `<Button>` occurrences inside `Button.tsx` itself (via `componentNameFromPath`). A self-render is the component signature or a recursive internal reference — inheriting at the definition file is redundant with the primary finding already there.

**Deduplication with primary call-site findings.** If a rule fires independently at a call site (the call site has its own offending attribute, not just an inherited one), both findings coexist:

- The primary call-site finding: `confidence` unset or a probabilistic value, `fix`/`fixPaths` populated.
- The inherited record: `confidence: "inherited"`, `sourceOfFinding` populated, no `fix`.

Their `findingId`s differ (different line contexts). Their `groupKey`s may coincide if `describeNodeShape` produces the same output — per [ADR 0008](../../adr/0008-violation-group-key.md), `groupKey` is `(ruleId, shape)` without position, so AST-equivalent nodes collide by design. One fix recipe, two places to act.

## Scanner hook

The synthesizer runs as a post-pass after primary and project rules complete, before sorting (`src/engine/scanner.ts:184–191`):

```ts
for (const v of synthesizeInheritedFindings({
  violations: allViolations,
  files: inputs.files,
  nativeWrapperElements: inputs.nativeWrapperElements ?? {},
}))
  allViolations.push(v);
allViolations.sort(compareViolations);
```

`synthesizeInheritedFindings` is a pure function — no I/O, no global state. Caller concatenates the returned `Violation[]` with `allViolations` and re-sorts. The synthesizer does not sort internally.

## Interaction with baseline, attestations, and pragmas

**Baseline.** Each inherited finding has its own `findingId` (call-site-derived) and is a first-class baseline entry. Adopting a baseline on a codebase with a pre-existing wrapper defect records both the primary and one entry per call site. Fixing the wrapper definition resolves the primary and all inherited entries in one edit; the next `baseline update` drops every inherited entry alongside the primary.

**Attestations (ADR 0013).** A rule-scoped attestation on the origin's `ruleId` covers inherited records by coverage-set membership — inherited findings carry the same `ruleId` and `criteria` as the origin. No separate attestation is required.

**Pragmas.** A call-site pragma disabling a rule emits a ledger attestation keyed on the call site's file. The inherited finding is still emitted — pragmas are ledger evidence, not emission filters — and ADR 0013's coverage check governs whether the attestation contributes to criterion status.

**Polymorphic re-dispatch.** When a rule fires against a polymorphically resolved element (e.g. `<Button as="a">`), the violation's `location` is the call site, not the definition file. `shouldInherit` only fires when `location.filePath` matches a declared wrapper definition path — so polymorphic re-dispatches are invisible to the synthesizer and do not trigger a second fan-out.

## Performance

The synthesizer is O(V + F·E): one pass over violations (V), one pass over parsed JSX/TSX files (F) collecting JSX elements (E), one hashmap lookup per inheritable violation. Call-site indexing reuses `indexFilesByComponentName` from `src/engine/wrapper-probe.ts` — no new traversal machinery and no additional filesystem I/O beyond the files already parsed.

## Doctrinal anchors

Three rules from [`ai-first-consumer.md`](./ai-first-consumer.md) are load-bearing:

- **"Surface, don't suppress."** Every call site in scope is emitted. The agent dismisses redundant entries by `groupKey`; the scanner cannot make that call.
- **"Labeled buckets are suppression too."** Rejected alternatives included a separate `inheritedFindings` bucket on `ScanResult`. Inherited findings are `Violation`s and belong in `violations[]` alongside primary findings. `confidence: "inherited"` is the honest marker, not a bucket.
- **"No heuristic suppression."** A cap at N call sites would be a numeric-threshold heuristic — hiding everything beyond N is the same silent-miss failure mode as a filename-pattern carve-out.

The rollout call in ADR 0014 also follows from doctrine: an opt-in flag off by default is suppression at a different stack level. An agent cannot opt into a signal it doesn't know is missing.

## When NOT to rely on it

- **Bounded by scanned files.** Run `scan_project` (not `scan_file`) when you want the inherited-finding signal. Narrow scans produce zero inherited findings because call sites aren't in scope.
- **Only declared wrappers attribute through.** `nativeWrapperElements` in `ra11y.config.ts` is the source of truth. A component that introspection would match but that is not in the config map does not trigger inheritance — the config is the explicit contract.
- **Definition outside scope emits nothing.** If the wrapper's definition file was not parsed, the synthesizer has no origin finding to key off.
- **Attestation is per-(criterionId, ruleIds), not per findingId.** A rule-scoped attestation on the origin's rule covers inherited records. But a finding-level baseline entry for an inherited finding is distinct from the primary's baseline entry; you cannot suppress one by attesting the other.
- **`fix` is absent by design.** An agent should route to `sourceOfFinding` for the edit target, not apply a fix at the call site.

## Cross-references

- [`src/engine/inherited-findings.ts`](../../../src/engine/inherited-findings.ts) — `synthesizeInheritedFindings`, `shouldInherit`, `buildInheritedViolation`.
- [`src/engine/scanner.ts`](../../../src/engine/scanner.ts) lines 184–191 — the post-pass hook.
- [`src/types/violation.ts`](../../../src/types/violation.ts) — `confidence` and `sourceOfFinding` field definitions.
- [`tests/unit/engine/inherited-findings.test.ts`](../../../tests/unit/engine/inherited-findings.test.ts) — unit and end-to-end scanner coverage.
- [ADR 0014](../../adr/0014-inherited-findings.md) — full decision log: cap policy, flag rejection, shape rationale.
- [ADR 0012](../../adr/0012-wrapper-introspection-role.md) — wrapper introspection role and one-hop discipline.
- [ADR 0013](../../adr/0013-rule-scoped-attestations.md) — attestation interaction.
- [ADR 0008](../../adr/0008-violation-group-key.md) — `groupKey` semantics.
- [`three-layer-model.md`](./three-layer-model.md) — rules are pure; inheritance is engine, not rule logic.
- [`rule-engine.md`](./rule-engine.md) — scanner lifecycle and where the post-pass sits.
- [`ai-first-consumer.md`](./ai-first-consumer.md) — doctrine for the cap, flag, and bucket decisions.
