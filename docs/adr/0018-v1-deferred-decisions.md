# ADR 0018 — v1.0 deferred decisions

- Status: Accepted (2026-04-19)
- Supersedes: none
- Related: ADR 0003 (parser peer), ADR 0005 (MCP server + sampling follow-up), ADR 0010 (coverage vs checklist), Track V backlog items V1-RULE-RENAME-DECIDE, V1-COV-CHECK-MERGE, V1-PARSER-SUBPKG-DECIDE, V1-SAMPLING-TOOL-PICK

## Context

Four v1.0-readiness decisions were tracked as open questions through the pre-release audit. Each carries non-trivial implementation cost, unclear user demand, and a semver-major consequence if the decision turns out wrong. This ADR closes all four at once so the v1.0 tag is not blocked on speculative work, and documents the signal that would cause us to revisit each.

## Decisions

### 1. Rule-catalog renames — **Deferred past v1.0**

The rule-catalog reorganization previously flagged (resolve `parsing/duplicate-id` + `parsing/html-has-lang` vs `document/lang-attribute`; clarify `semantics/label-in-name` vs `forms/labels-required` vs `forms/non-empty-label`) would require a one-major deprecation-alias cycle. No user has complained about the current names; the overlap is mild and documented in `docs/kb/rules/`. The renames also cost churn across every rule-referencing doc, fixture reason-substring, and downstream baseline. Ship v1.0 with current names.

Revisit if: (a) three or more users open issues about rule-name clarity in the first minor after v1.0, (b) a fourth family (`aria/*`, `keyboard/*`) introduces similar overlap the current naming can't absorb, or (c) we accumulate enough renames in one minor that a batched rename amortizes the deprecation cost.

### 2. Coverage + checklist merge — **Deferred past v1.0** (ADR 0010 stays as-is)

The follow-up question on ADR 0010 (`Q2R2-COVERAGE-CHECKLIST`) was whether to merge the two reports behind a verbosity knob with a deprecation alias. The current shape — separate `coverage` and `checklist` tools with cross-linked `nextStep` pairs — is honest, well-tested, and survived the round-3 agent eval without a merge request. Merging now would introduce a verbosity axis that agents must branch on. The cost exceeds the benefit at this evidence level.

Revisit if: an agent consumer demonstrates a concrete workflow where coverage-then-checklist round-trips dominate their call budget and a merge would demonstrably cut that cost without harming the honest-shape invariants.

### 3. `@ra11y/parser-typescript` subpackage — **Deferred past v1.0** (ADR 0003 stays as-is)

Extracting TSX parsing into a sibling npm package would decouple the TypeScript peer-dependency range from the core package and let us ship non-TSX installs without pulling `typescript` in. The concrete benefit is narrow — TSX is the dominant codebase shape we scan, and the peer is already an OPTIONAL peer. The cost is an extra package to version, publish, document, and keep in sync; it also adds a release-coordination step that amplifies the blast radius of any parser bug.

Revisit if: (a) a production consumer reports that the optional `typescript` peer still pulls in the compiler API against their will (indicating a peer-resolution edge case not covered by the current setup), (b) we add a second non-trivial parser that would benefit from the same extraction (e.g. Vue SFCs, Svelte), or (c) supply-chain audit pressure specifically cites the TypeScript tree.

### 4. Sampling-backed speculative tools — **Deferred past v1.0** (ADR 0005 §Follow-up)

Three speculative tools remained pending in Track S: `resolve-component`, `verdict-candidate`, `draft-vpat-narrative`. C-ATTEST-TOOL landed in Track C, so the sequencing dependency is met and `verdict-candidate` is the natural first pick (its output IS an attestation entry). The remaining hesitation is not architectural — it's evidence: we do not yet have a concrete host running the sampling capability end-to-end against ra11y, and building speculative tools against an unexercised capability surface is how in-tool heuristics sneak back in (see CLAUDE.md §1 "Don't duplicate capability the agent already has").

All three stay `[!]` blocked on first-user sampling-host evidence. When the first host that declares `sampling` during `initialize` calls one of these tools, we promote `verdict-candidate` first (ADR 0005 §Follow-up) and iterate from there.

Revisit if: (a) a sampling-capable host surfaces a concrete workflow demand, or (b) the existing `prompts/` + `attest` round-trip proves insufficient for the attestation pattern documented in `docs/conformance.md`.

## Consequences

- v1.0 ships with current rule names, separate coverage/checklist tools, core-only parser, and no sampling-backed tools.
- Backlog items V1-RULE-RENAME-DECIDE / V1-COV-CHECK-MERGE / V1-PARSER-SUBPKG-DECIDE / V1-SAMPLING-TOOL-PICK all check off.
- `docs/migrations/0.2-to-1.0.md` reflects the deferred list so consumers know what is NOT changing in v1.0.
- Each deferral lists its revisit signal so a future minor can revive the work on real evidence, not anticipated demand.
