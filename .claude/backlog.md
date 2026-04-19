# ra11y backlog

The `/continue` skill reads this file and dispatches work to specialist subagents. Each item should be small enough that one specialist can finish it in under 20 minutes. When an item would produce more work, split it in place before dispatching.

Legend: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked (reason in comment)

## Ship state

- **v0.1.0 — ready to tag.** Code-complete: 54 rules, 4 standards, 9 formatters, 10 MCP tools, 4 reports, CLI wired, release workflow configured. Remaining work is the demo + the tag + publish (Track D).
- **v0.2.0 — in flight.** MCP hardening (Track M), review-candidate coverage + focus-ring cross-ref (Track R), real-world fixture corpus (Track F). Target: 3–4 weeks post-0.1.0.
- **v0.3.0+ — staged, not started.** MCP sampling (Track S), ecosystem integrations + public benchmark (Track E). Phase 20 work is deliberately deferred until after 0.2.0 ships and user feedback tells us which sampling-backed tool matters most. See ADR 0005 for the sampling architecture.
- **v1.0.0 — readiness (Track V).** Conformance capstone work is done in Track C. Remaining v1.0 gates are coverage-matrix reconciliation, fix-suggestion audit, prompt template discoverability, performance baseline, deferred-decision resolution (rule renames, ADR 0003, ADR 0010, ADR 0005 sampling tools), and a real-world fixture push into rule-territory (forms/nav/dialog/table/live-region). Derived from 2026-04-19 three-agent gap analysis.

## Dispatch model (parallel tracks, not sequential phases)

Tracks below are independent. `/continue` picks the next open item from each of up to 3 active tracks per turn and dispatches them in parallel (details in `.claude/skills/continue/SKILL.md`). Within a track, items run in order — some tracks have sequencing; cross-track work is always parallelizable.

Active tracks: **D** (docs/release) · **M** (MCP hardening) · **R** (rules + review candidates) · **F** (real-world fixtures) · **S** (MCP sampling) · **E** (ecosystem/evals) · **Q2** (agent-consumer feedback round 3). Track Q (rounds 1-2) closed 2026-04-17.

Staged tracks: **C** (conformance-claim gaps — v0.3.0 foundation + v1.0.0 capstone). Tracks S and E were promoted on 2026-04-17 after the user directed "go all the way without releasing until finalized" — M/R/F are complete, so the remaining pre-release work spans S and E. ADR 0005 §Follow-up work still applies to the speculative tool choices inside S; foundation items (sampling.ts, capability, prompt library, KB docs) are safe to build.

Track Q was added on 2026-04-17 in response to a 10-agent independent eval brief — MCP shape honesty + silent-failure elimination, all derived from real consumer pain on an external React codebase.

Track C was added on 2026-04-17 from a gap analysis on "what's missing to let an agent fully claim WCAG 2.1 AA." Four gaps: runtime-evidence ingest, attestation ledger, process-level scope, conformance statement. None widen detection (no new rules); they widen what an agent can defensibly *say* after using ra11y.

---

## Track D — Docs & release

Owner: `release-captain` + `doc-writer`. Blocks nothing; can ship independently.

### v0.1.0

- [ ] asciinema demo recording embedded in README
- [x] Version bump confirmation (package.json already reads `0.1.0`; verify + commit a release-prep chore if anything else drifts) (a0a805b — README status note, terminal version example, config.md stale forward-ref, writing-a-rule.md afterProject note; no drift in CHANGELOG date, llms.txt absent)
- [ ] Tag `v0.1.0` and push (triggers `release.yml` → npm publish with provenance)
- [ ] GitHub release with changelog excerpt

### v0.2.0

- [x] Release notes for 0.2.0 — drafted under `## [Unreleased]` in CHANGELOG.md (1eabf39). Covers M/R/F/S/E deltas; dated header waits for release.
- [x] Migration notes if any track introduces a breaking MCP shape (b2ed366 — warranted; four hard breaks in response-output shapes: suggest_fix suggestion→fixPaths+kind, checklist.summary.automatedCoverage trimmed to gloss, untargetedCriteria rename, activeNativeWrappers string[]→tagged-object-list; filePath param alias and configure dispatch are input-side compat, not output-side; docs/migrations/0.1-to-0.2.md created)

---

## Track M — MCP hardening

Owner: main session. Internal ordering: baseline first (unlocks scan-diff), then apply-fix, then prompts/resources/capability, then structured errors, then tests last.

### v0.2.0

- [x] `src/mcp/tool-baseline.ts` — create/check/update a baseline from within an MCP session (pairs with Phase 14 baseline work)
- [x] `src/mcp/tool-scan-diff.ts` — compare current scan vs a baseline; emit only new findings
- [x] `src/mcp/tool-apply-fix.ts` — take a `suggest_fix` result, apply the search/replace, re-scan, return the delta (opt-in via `--allow-write` session flag)
- [x] Prompt templates under `src/mcp/prompts/` — reusable `prompts/list` entries for triage / fix / audit / VPAT narrative workflows (pure strings, no template engine)
- [x] `resources/list` support — expose `docs/kb/**` as MCP resources so attached agents can retrieve KB entries without filesystem access
- [x] Capability declaration polish: `logging`, `completions` where meaningful, `roots` so `scan_project` respects the host's declared project boundaries
- [x] Structured errors across tools — replace text-only error payloads with `structuredContent` where the result is machine-consumable (coverage, checklist, list_rules, review_candidates)
- [x] `tests/integration/mcp-resources.test.ts` — resources/list + resources/read round-trip
- [x] `tests/integration/mcp-prompts.test.ts` — prompts/list + prompts/get round-trip

---

## Track R — Rules + review-candidate coverage

Owner: `rule-implementer` (rules) + main session (review finders). Rules within the track are independent; dispatch 3 in parallel when you have 3 open items.

### v0.2.0

- [x] `src/review/finders/consistent-navigation.ts` — wcag22:3.2.3. Compare `<nav>` children structure/order across route files; flag divergent routes as candidates.
- [x] `tests/unit/review/finders/consistent-navigation.test.ts` — ≥3 positive, ≥3 negative, ≥1 edge case against fixtures under `tests/fixtures/review/consistent-navigation/`.
- [x] Tailwind focus-ring cross-reference for `focus/outline-visible`. When `.classname:focus-visible { outline: none }` currently downgrades to `info`, cross-reference against `tailwind.ts` class output: if an element with that className also carries `focus-visible:ring-*` / `focus-visible:outline-*` / `focus-visible:shadow-*` utilities, auto-resolve the info candidate. Not heuristic suppression — a named class-token link is concrete evidence. Extends existing parser output; no new architecture.
- [x] `src/rules/aria/conflicting-role.ts` — wcag22:4.1.2. Flag explicit `role` values that contradict the native element's implicit role: `<button role="link">`, `<a role="button">` without href/handler coupling, `<nav role="main">`, etc. Real 4.1.2 failure — AT announces one thing, browser behaves like another. `docs/kb/concepts/aria-valid-roles.md` already promises this rule exists; implementation fills the gap. Explicitly NOT covering *redundant* role (`<a role="link">`) — pure ARIA code-smell with no WCAG hook; revisit when a best-practices standard lands. Needs implicit-role table in `src/engine/ast-helpers.ts` or a co-located map; pairs with `tests/fixtures/{good,bad}/aria-conflicting-role/` and ≥3 positive/≥3 negative unit tests.

### v0.3.0

- [x] **R-2.3.1-FLASHING** `src/review/finders/flashing-content.ts` — wcag22:2.3.1 + wcag21:2.3.1 (Three Flashes or Below Threshold, Level A). Surface review candidates for static signals of flashing/high-motion content: `<video autoplay>` without a `prefers-reduced-motion` guard, `<canvas>` + `requestAnimationFrame`/animation-library calls outside `@media (prefers-reduced-motion: reduce)`, high-frequency CSS `@keyframes` (opacity/transform cycles faster than ~3Hz) not reduced-motion-gated, `<marquee>` / `<blink>` legacy tags. Follows the `motion-actuation.ts` / `pointer-input.ts` finder shape: reason-text frames the question; agent reads the file and verifies the physical thresholds (3/s flash rate, red-flash area) that static analysis can't. Closes the last A+AA criterion with no static signal (gap surfaced during 2026-04-17 WCAG 2.1 AA coverage audit — all other manual-only A+AA SCs already ship finders or have tracked work). Fixtures under `tests/fixtures/review/flashing-content/`; ≥3 positive, ≥3 negative, ≥1 edge case; kb entry via `/fix-drift`.

---

## Track F — Real-world fixture corpus

Owner: `fixture-curator` + `test-author`. **Sequenced: ADR → harness prototype → fixture backfill (9 items in parallel).** The 9 fixture cases cannot start until the harness lands.

### v0.2.0

- [x] ADR 0006 `docs/adr/0006-real-world-fixture-harness.md` — resolve the five design questions (assertion shape, per-fixture config, sanitization policy, golden-output generation, harness architecture). Chosen positions go in the ADR.
- [x] Harness prototype against `tests/fixtures/real-world/tsx-generics/` validating the `FixtureAssertions` primitives from the ADR before committing to the shape.
- [x] Extend `fixture-curator` subagent definition in `.claude/agents/fixture-curator.md` with the new `tests/fixtures/real-world/` conventions once the ADR lands.
- [x] `real-world/tsx-generics/` — Pick<T,K>, ForwardRefRenderFunction<...>, generic function calls. Guards commit `2968d87`. Assertion: zero-parse-errors.
- [x] `real-world/spa-shell-vite/` — Vite-style `<div id="root">` + module script index.html. Guards `bc3aae4`. Assertion: wcag22:2.4.5 candidate reason includes "SPA index shell".
- [x] `real-world/tailwind-coverage/` — 60 JSX files with utility-class strings, zero CSS. Guards `4700a13`. Assertion: analysisCoverage.hints includes "Tailwind usage detected" + `additionalPaths: ["dist/assets"]`.
- [x] `real-world/logotype-annotation/` — `<img className="site-logo" alt="Acme">`. Guards `71b9954`. Assertions: wcag22:1.4.5 reason contains "logotype exemption"; wcag22:1.4.9 reason does NOT.
- [x] `real-world/timing-role-hints/` — useDebouncedCallback, authManager, telemetryService. Guards `3ada44a`. Assertion: wcag22:2.2.1 reason contains "likely not user-facing" (updated live: now guards "session-keepalive / debounce / animation" + reverted-enrichment absent).
- [x] `real-world/template-directives/` — Jinja `{% extends %}` + `{{ x }}`. Guards `a554d27`. Assertion: analysisCoverage.templateDirectiveHandling includes "parsed as literal".
- [x] `real-world/opaque-components-top/` — 10 PascalCase components with varied call-site counts. Guards `0ee28e1`. Assertion: analysisCoverage.opaqueCustomComponentsTop is a ranked list of length ≤5.
- [x] `real-world/suppression-reason-slot/` — pragma with `: reason` syntax. Guards `d820186`. Assertion: meta.suppressions contains an entry with `reason: "..."`.
- [x] `real-world/autodetect-attribution/` — autoDetectWrappers scan; assert sessionNativeWrappers is absent (regression on `6821b77`).
- [x] Policy change: update `CLAUDE.md` §7 and §17 — when fixing a real-world bug (not adding a new rule from spec), add a sanitized repro to `tests/fixtures/real-world/<case>/` FIRST. Unit tests are for invariants; behavior-rehearsals migrate to real-world fixtures on touch.

---

## Track S — MCP sampling

Owner: `parser-author` + main session. Promoted from staged 2026-04-17. Foundation items (sampling.ts, capability plumbing, prompt library, KB docs) land freely; the three speculative LLM-backed tools (`resolve-component`, `verdict-candidate`, `draft-vpat-narrative`) still need a concrete use-case selection per ADR 0005 §Follow-up work — surface them as review candidates before wiring.

### v0.2.0 (foundation)

- [x] `src/mcp/sampling.ts` — client helper calling `sampling/createMessage` on the host with timeout + max-tokens budget
- [x] Server capability declaration: read host `sampling` capability from `initialize.params.capabilities`; graceful fallback to "return the prompt for the agent to run" via `SamplingNotSupportedError` on hosts that decline
- [!] `src/mcp/tool-resolve-component.ts` — verifies PascalCase wrappers via host-sampled source read. ADR 0005 §Follow-up: pick 1–2 speculative tools based on user feedback before wiring; this one is a candidate.
- [!] `src/mcp/tool-verdict-candidate.ts` — pass/fail with reasoning for a review candidate + its `reviewPrompt`. ADR 0005 §Follow-up: same caveat.
- [!] `src/mcp/tool-draft-vpat-narrative.ts` — drafts the VPAT "Remarks and explanations" cell per criterion. ADR 0005 §Follow-up: same caveat.
- [!] `src/mcp/tool-triage-findings.ts` — pure (no sampling) triage that labels each finding. Scope of the label schema is ambiguous without downstream consumers (the three tools above are its consumers); define + pick one before dispatch.
- [x] Prompt library under `src/mcp/prompts/` — checksum registry for version-pinning (9cfc547). Surfaced on `prompts/list` + `prompts/get` via `_meta.checksum`. Substitution was already in place.
- [x] `tests/unit/mcp/sampling.test.ts` with a fake host recording sampling requests
- [!] `tests/integration/mcp-sampling.test.ts` with a scripted host adapter — blocked on first sampling-backed tool (one of the three [!] tools above). Scripted host lives at `tests/evals/scripted-host.ts` and is reusable here.
- [x] Docs: `docs/kb/architecture/mcp-sampling.md`
- [x] Docs: `docs/mcp/prompts.md`
- [!] `/audit` MCP prompt template: end-to-end workflow (scan → triage → verdict → VPAT draft) — blocked on the three speculative tools landing; template already exists as a prompt (`audit.ts`), the "MCP prompt template" wording refers to the end-to-end wiring.

---

## Track E — Ecosystem & public benchmark

Owner: `doc-writer` + main session. Promoted from staged 2026-04-17. Items expand the agent-host matrix and establish the public quality story.

### v0.2.0

- [x] Prompt evals harness in `tests/evals/` — measure each sampling prompt's accuracy against a labeled fixture set; CI-gated against a scripted host (no real LLM calls). Paired with Track S. (committed d00535b)
- [!] `examples/ra11y-in-claude-code/` — reference `.mcp.json` + sample `CLAUDE.md` section showing triage → verdict → draft-VPAT inside Claude Code. Blocked on the Track S speculative tools landing (the workflow references them).
- [!] `examples/ra11y-in-cursor/` — blocked externally on Cursor's MCP host shipping sampling.
- [x] VS Code extension skeleton under `integrations/vscode/` — wraps the MCP server for IDE-native findings (f0508dd). Sibling project with isolated toolchain; no runtime deps leak into @ra11y/core. Explicit non-goals (marketplace, EDH smoke test, CodeActionProvider, per-file scan-on-save, streaming, multi-root, reconnection) listed in README for follow-up.
- [x] Public benchmark: `benchmarks/a11y-tool-comparison.md` — scaffold (2f5539a) + ra11y-side numbers via `scripts/benchmark-run.ts` (f3878e3). Cold start 41.3ms, 10/100/1000 files 3.4/28.3/235.9ms, real-world corpus 72.4ms for 9 fixtures. Competitor columns remain "pending" until those tools are added as isolated dev deps.

---

## Track Q — Agent-consumer feedback

Owner: main session + general-purpose. Source: 10 independent agent runs against an external React codebase (2026-04-17 eval brief). All accepted items are MCP shape/honesty fixes — none touch detection logic. Dispatch in parallel; each touches a different surface.

### v0.2.0 — accepted (P0/P1)

- [x] **P0-E** Top-level `warnings: string[]` for silent-failure modes on `scan_project` / `scan` responses (31e040f). Codes wired: `scanned_zero_files`, `root_source_defaulted` (scan_project only), `no_config_found`, `tailwind_detected_css_undercounted`, `template_files_parsed_as_literal`. Conditional-spread; never `warnings: []`.
- [x] **P0-C** Populate `snippet` on every `review_candidates` and `checklist` candidate (9ba1c2b). ±3 lines, de-indented, 300-char cap, omitted (not `""`/`null`) when file:line is absent. Per-response source cache so each file is read at most once.
- [x] **P0-D** Widen `suggest_fix.oldText` to a unique anchor window (50b4514). Three-step ladder (opening-tag cluster → ±1 line → bracket expansion), 200-char cap, falls back to original narrow edit + `caveat` when no unique window fits. `apply_fix`'s existing literal-match path consumes the widened pair without changes. Bonus: extracted `buildSuggestFixPayload` to its own file to keep `tools.ts` under the 500-line budget.
- [x] **P1-F** AST-verify auto-detected native wrappers (c725cd0). One-hop probe: matches PascalCase basename to a `*.{tsx,jsx,ts,js}` file and inspects the first JSX element's tag name; native interactive root → `confirmed`, anything else → `assumed`. Only `confirmed` enter `activeNativeWrappers` and silence findings; `assumed` are surfaced under `bySource.fromAutoDetect.assumed` but findings on them are NOT silenced. No name-pattern matching, no transitive following.
- [x] **P1-J** Stable `findingId: string` on every Violation (49f9227). Truncated sha256 of (ruleId, relativeFilePath, lineContextHash); 12 hex chars. Line numbers NOT in the hash by design (drift resilience); ±3-line source context IS. Path normalization to relative-form so IDs match across machines. Baseline cross-run matching now uses findingId; legacy SHA1 helper kept as `fingerprintOf` for any straggling callers.
- [x] **P1-M** `plan.actionableManualItems` + `plan.untargetedCriteria` both top-level; summary leads with the actionable count (ab35222). Old composite `manualReviewRequired` removed.
- [x] **P1-H** `plan.mechanicalEditsAvailable` + `plan.guidanceFixesAvailable` both top-level (ab35222). Old composite `fixSuggestionAvailable` removed.
- [x] **P1-K** `nextStepStructured: { tool, args }` alongside prose `nextStep` (ab35222). Both omitted together when the next step is generic; aligned pair by construction.
- [x] **P1-L** Concrete `editCandidate` for `label-in-name` non-contiguous fixes (53ab36b). Synthesizes `aria-label="<visible text>: <remaining aria-label words>"` only when diagnosis is `isInterleavedExpansion`; case-insensitive dedupe of overlapping tokens. Field is `editCandidate` (NOT `edit`) so kind stays `guidance` — agent decides whether to apply.

### v0.2.0 — accepted (P2)

- [x] **P2-V** `criteriaTitles: string[]` aligned index-for-index with `criteria` (70a9cd7). Standard-filter looks up titles from the criterion registry; scanner stamps both at violation construction; formatters and MCP `formatFinding` forward.
- [x] **P2-N** `plan.limitations` emitted on every scan response, not only clean ones (turn 7). Prevents agents from overclaiming conformance on mixed-result responses.
- [x] **P2-P** `opaqueCustomComponents.names` inlined on every response when count ≤ 50 (c1f7e6b). Above 50 keep the current top-5 + `verboseMeta` pattern. Named constant `OPAQUE_COMPONENT_INLINE_NAMES_MAX = 50` with size-budget rationale.
- [x] **P2-R** `file` is canonical across suggest_fix + apply_fix; `filePath` accepted as deprecated alias (c2ea3b5). Using the alias fires `warnings: ["deprecated_param_filepath"]`; passing both raises a structured error.

### v0.2.0 — accepted (from 20-run combined brief, 2026-04-17)

Net-new items from round 2 of the consumer eval (round 2 explicitly probed edge cases — bogus `cwd`, `changedOnly`, subpath scans, large-directory overflow). 4 unanimous round-2 issues + several single-observer R2 finds; all are correctness or honest-shape, none are heuristic suppression.

- [x] **P0-F** Hard-error envelope on silent-failure paths (6a50836). `code: "cwd-not-found"` on `scan_project` with nonexistent `cwd`; `code: "scan-paths-not-found"` on `scan` when every requested path is missing. Discriminator: did the user point at something that exists? Yes → soft signal (warnings: ["scanned_zero_files"]); no → hard error envelope. Categorically different cases now have categorically different shapes.
- [x] **P1-CHG** `changedOnly: true` silently falls back to a full scan with no staged files (7824f81). Picked the hybrid: hard-error envelope (`code: "no_staged_files"`) for the in-repo case, honest fallback signal (`scanMode: "full-fallback"`, `fallbackReason`) for the not-in-a-git-repo case. Same lying-field bug exists in `tool-scan-diff.ts` per agent report — follow-up below.
- [x] **P1-CFG** Superseded by **P0-F** (6a50836). A bogus `cwd` now returns a structured `cwd-not-found` error envelope rather than a successful-looking empty scan, so the schema-presence-check failure mode no longer applies — the envelope shape is categorically different from the success shape, and agents branch on `isError: true` + `code`.
- [x] **P1-OVF** scan_project pagination (ab23bd5). `limit` (default 200, clamped [1, 2000]) + `offset` (default 0) input params; response carries `truncated: true` + `nextOffset` + `totalFilesWithFindings` when the cap truncates, else omits them. Offset-based (stable across rescans). Scan still runs over everything — only the emitted `files` array is capped; `plan.totalFindings` reports the full pre-truncation tally so page 1 doesn't mislead.
- [x] **P1-DUP** Dedupe `reviewPrompt` text in `review_candidates` (496b2e1). Top-level `prompts: { [criterionId]: { text } }` keyed map; candidates omit the per-item `reviewPrompt`. Field omitted when zero prompts apply. Lossless.
- [x] **P1-FILE-ENV** `scan_file` envelope parity (70a9cd7). Now carries `meta.configSource`, `activeNativeWrappers`, `rulesEvaluated`, `nextStep`, `opaqueCustomComponents`. Reused scan_project helpers rather than duplicating.
- [x] **P1-FILE-DEDUP** `scan_file` cross-standard dedup (70a9cd7). Same finding under multiple loaded standards collapses to one with `criteria: [...]`, matching scan_project. Shared dedup pass in `review-candidate-dedup.ts`.
- [x] **P1-ACCT** `analysisCoverage.opaqueCustomComponentsExcludedByAutoDetect` surfaces the subtraction count when auto-detect contributed (457635d). Agents computing "with-flag count + excluded = without-flag count" now see the scan-scope of the flag in the same field it affects.
- [x] **P1-IGN** Subpath scans now honor root `.gitignore` (389ba58). Walks up to git root, collects ancestor `.gitignore` files in order, translates patterns to scan-root-relative form, then enumerates from `cwd`. Per-scan memoization. Edge cases handled: `**/`-leading patterns, anchored-at-scan-root, anchored-outside-scan-root (dropped), FS-root termination. `!`-negation re-includes still unsupported (pre-existing glob.ts limitation, called out in docs).
- [x] **P1-CONF** Typed `confidence` on every manual-review candidate (3d258a3). `"high" | "medium" | "low"`, same enum as automated findings. Each finder picks its default; `priority: "high"` on checklist items stays (different axis).
- [x] **P2-BASE** `meta.baselineStatus: { exists, path, lastModified }` on scan_project when `.ra11y-baseline.json` exists at the scan root (457635d). Omitted when absent. Prevents re-proposing fixes for grandfathered violations without the baseline-check round-trip.
- [x] **P2-BUILD** `meta.scannedBuildArtifacts: [paths]` + `warnings: ["scanned_build_artifacts_present"]` when scanned set includes compiled-CSS / bundler-output (c2ea3b5). Findings on those files STILL surface — this is labeling, not filtering. Detection is deterministic (escape-bracket utility selectors, size threshold, /dist/ /build/ /static/assets/ path markers).

### Considered and rejected (per CLAUDE.md §1)

- **P0-A** Heuristic pre-filter for `wcag22:2.2.1` setTimeout/setInterval candidates by filename (`hooks/useDebounce*`, `telemetry/`, `auth/`), enclosing-function name regex, and duration threshold. → rejected per **§1 "Numeric-threshold heuristics are suppression"** + **"No heuristic suppression, even for spec carve-outs"** + **§17** "Adding a numeric-threshold gate." A 4.5s debounce and a 4.5s session timeout are indistinguishable from static analysis. The reason-text enrichment shipped under Track F (`real-world/timing-role-hints`) — "session-keepalive / debounce / animation" — is the correct mechanism. If agents still struggle, sharpen the reason text further; do not filter the candidate list. **Re-affirmed in 20-run brief (P0-A there, 20/20 agreement on the noise — but the noise is real signal the agent dismisses, per CLAUDE.md §1.**
- **P0-B** Tighten `wcag22:3.2.2 On Input` to skip `onChange` handlers whose body is `(e) => setX(e.target.value)`. → rejected for the same reason. The agent reading the handler body is the only correct arbiter; a controlled-input setter and a `navigate()` call are both `onChange` from the AST. Enrich the `reason` text with the detected handler shape ("body calls a single React setter") as additive context if the existing reason is thin; do not drop the candidate.
- **P1-I (10-run brief)** SPA-mode / file-class awareness — auto-suppress `2.4.5 Multiple Ways` / `1.4.5 Images of Text` / `2.4.1 Bypass Blocks` on server-template SPA shells. → rejected per **§1 "No heuristic suppression, even for spec carve-outs."** Whether a template is "the SPA shell" or "the start of a content site" cannot be statically determined. The deterministic disable pragma (`<!-- ra11y-disable wcag22:2.4.5 -->`) is the durable mechanism. Reason-text enrichment ("template parsed as literal — verify whether navigation is owned by the SPA") is acceptable; suppression is not.
- **P2-W (10-run brief) / P2-Y (20-run brief)** Severity downgrade for `aria/hidden-focus` when descendants are `disabled` + container has `pointer-events-none`. → rejected per **§1 "Don't downgrade priority to hide things."** Severity is for sorting; downgrading hides the candidate from agents that filter by severity. The reason text already explains state-dependent nature; that is enough. If a `caveat` field would help, add it as additive metadata at the same severity.
- **P1-R (20-run brief)** Tailwind utility-class awareness on `layout/reflow-hardcoded-width` — skip or downgrade when the rule fires inside `.w-\[Npx\]` selectors on compiled-CSS paths and no JSX consumer exists. → rejected per **§1 "No heuristic suppression"**. Path-pattern + selector-shape suppression replaces honest "please verify" with false confidence; the agent reading the file can confirm "this is a Tailwind utility-class definition" in one read. Pair with **P2-BUILD** above (the build-artifact warning) so the agent gets the labeling signal without losing the candidate.

### Deferred (worth doing eventually, not in this batch)

- **P1-G** Auto-detect compiled-CSS output paths via vite/next/tsup config. The current `additionalPaths: ["dist/assets"]` hint is wrong for many projects. Worth doing properly (read config, surface as `meta.inferredBuildOutput`), but scope is larger than the rest of Track Q. Park for later sprint.
- **P2-Q** Batch variant of `suggest_fix({ findings: [...] })`. Nice-to-have; round-trip reduction is real but not urgent.
- **P2-S** `plan.candidateCountsByCriterion: { ... }` histogram. Cheap, but no agent in the brief said they were blocked on it. Park.
- **P2-T** Gate `unusedNativeWrappers` on full-scan only. Single-observer (run #8 only); the existing `unusedNativeWrappersNote` already disclaims. Low ROI.
- **P2-U** Promote `absentDeclaredWrappers` to `meta.configHealth.staleWrappers` on `scan_project`. Single-observer; nice but not urgent.

---

## Track Q2 — Agent-consumer feedback (round 3, 10-agent eval)

Owner: main session + general-purpose. Source: a 10-agent parallel eval against an external React/Vite/TS/Tailwind codebase — each agent exercised a different MCP slice in a "you-find, I-fix" workflow. Round 3 ran after Q (rounds 1-2) closed, on the post-Q shape. All accepted items are shape-honesty, batch-primitive, or workflow-gap fixes — none are heuristic suppression.

### v0.2.0 — accepted (P0)

- [x] **Q2-PROSE** Top-level `referenceGuide.suppressPlacement: { [ext]: prose }` on scan / scan_file / scan_project / scan_diff responses; findings no longer carry `suppressPlacement` inline. Keyed by file extension (`tsx`, `css`, `html`, `htm`, `default`), populated only with extensions that actually have findings, omitted entirely when no findings exist (honest conditional-spread). `suppressWith` stays inline per finding — short, rule-ID-specific, ready-to-paste, not worth hoisting. apply_fix/baseline still use the old per-finding shape (small response bodies, no hoist benefit); documented as intentional scope. New module `src/mcp/reference-guide.ts` owns the builder + language mapping. `analysisCoverage.rulesByExtension` is already top-level — not actually per-finding prose, so nothing to hoist there.
- [x] **Q2-FIXKIND** Per-finding `fixClass` discriminator inline on every violation (bbbecf1 + 0da8a45). `mechanical | guidance | runtime-only | verify-in-source`. Stamped by the engine from required Rule.fixClass metadata; forwarded through MCP formatFinding. Distribution: 15 mechanical, 8 guidance, 2 runtime-only, 24 verify-in-source. ADR 0007. Named `fixClass` not `fix.kind` to avoid collision with existing `Violation.fix` auto-fixer shape and `suggest_fix.kind` 2-value axis.
- [x] **Q2-REASON** Bare `ra11y-disable` pragmas (no `: reason`) emit a review candidate under `suppression/no-reason` (d69175f). New `ra11y:` process-rule namespace with one criterion (`ra11y:suppression-no-reason`); engine activates `RA11Y_PROCESS_CRITERION_IDS` unconditionally so the finder fires regardless of enabled standards. Suppression semantics unchanged — pragma still honored; additive accountability signal.
- [x] **Q2-RULEDETAILS** `includeRuleDetails: "none" | "unique" | "all"` accepted on `scan` + `scan_project`; when set, response carries `ruleCatalog: { [ruleId]: { description, rationale, normativeQuote, goodExample, badExample, references } }` at the top level. `unique` is filtered to ruleIds that actually fired in the scan; `all` includes every loaded rule for first-contact caching. Default `none` keeps the baseline shape (field omitted entirely, not `{}`). New module `src/mcp/rule-catalog.ts` owns the builder, `collectFiredRuleIds`, the shared JSON-Schema fragment, and a `ruleCatalogField` conditional-spread helper so both tools share one code path. Mirrors the Q2-PROSE inline-once/reference-from-findings architecture.

### v0.2.0 — accepted (P1)

- [x] **Q2-HUNK** `scan_diff` now accepts `hunksOnly: boolean` + `comparisonRef` (ff21fa5). Shells out to `git diff --unified=0 <ref>` via `spawnSync` with array args (zero-dep, no shell injection); parses hunk headers per file; filters findings to `(filePath, line)` inside a hunk. Baseline path is the default and untouched. Error envelope: `not-a-git-repo` + `unknown-ref`; soft signal `warnings: ["no_hunks_in_comparison"]` when both succeed but diff is empty. macOS symlink realpath normalization applied so `/var/` vs `/private/var/` doesn't break path comparisons.
- [x] **Q2-RESOLVED** `scan_diff` baseline mode now carries `resolved: ResolvedFinding[]` + `resolvedCount: number` (9d85885). `ResolvedFinding = { filePath, ruleId, message }` — mirrors the baseline entry minus the opaque hash. Both fields emitted even at zero in baseline mode (meaningful: "this scan fixed nothing"). In `hunksOnly: true` mode the fields are **omitted entirely** (not empty-array) — concept doesn't apply without a baseline. `nextStep` surfaces the resolved count when non-zero and nudges toward `baseline` mode: "update" to prune.
- [x] **Q2-GROUPKEY** `groupKey: string` stamped on every Violation (217d97c + ce8d6ac + 9184f6d + b979244). 12-hex-char truncated SHA-256 of `ruleId + "\0" + describeNodeShape(node)`. Helper `describeNodeShape` lives in `src/engine/ast-helpers.ts`; attribute NAMES and children-structure coarsened to `[text]`/`[expr]`/`[element]`/`[empty]`/`[mixed]` — values stripped, positions excluded. Stamped by engine (scanner + rule-runner), forwarded through MCP + JSON + agent + SARIF (`partialFingerprints.groupKey`) formatters. ADR 0008. Constant `GROUP_KEY_HEX_LENGTH = 12` mirrors `FINDING_ID_LENGTH` for symmetric read.
- [x] **Q2-CHECKLIST-LIMIT** Checklist pagination (df8946c + 73a545b). Inputs: `limit` (default 200, clamp [1,2000]), `offset` (default 0, ≥0), `maxCandidatesPerCriterion` (default 10, clamp [1,100]). `totalCandidates` always emitted. `truncated: true` + `nextOffset` conditionally spread when global `limit` clipped the flat stream; `perCriterionClipped: true` conditionally spread when any criterion hit the per-criterion cap. Orthogonal signals — either, both, or neither. Named constants; no magic numbers. Scan_project pagination helper extraction deferred as follow-up.
- [x] **Q2-SKIPCRIT** `skipCriterion: string[]` accepted on `checklist` + `scan_project`. Findings / checklist entries whose entire `criteria` set is contained in the skip list are dropped; entries tied to un-skipped criteria stay. Caller's filter of its own result — not tool suppression — surfaced as `summary.skippedByCaller` (checklist) and `meta.skippedByCaller` (scan_project). Shared schema + `skippedByCallerField` helper live in `src/mcp/skip-criterion.ts`. Filter applied in `runScanAndFormat` via new `applyCriterionSkip` pass so plan counts stay honest. Also consolidated `referenceGuideField` + `baselineStatusField` helpers into their owning modules to free file-budget headroom.
- [x] **Q2-LISTSUPP** `list_suppressions` MCP tool (d0a017c + 60df697). Input `{ cwd?, additionalPaths? }`; output `{ suppressions: [{ file, line, ruleId|null, criterionId|null, reason?, wildcard }], meta, nextStep }`. Does NOT run rules — enumerates pragmas only via the existing parser. Wildcard pragmas emit one entry with `ruleId: null, criterionId: null, wildcard: true`; multi-token pragmas emit one entry per token. `reason` field is conditionally spread (omitted for bare pragmas). Registered as tool #17.

### v0.2.0 — accepted (P2)

- [x] **Q2-WRAPMAP** Config accepts `nativeWrappers` as `{ Button: "button", Link: "a" }` alongside the legacy `string[]` form (4e40f10). Loader normalizes to two honest LoadedConfig fields: `nativeWrappers: string[]` (names — every existing consumer keeps working unchanged) and `nativeWrapperElements: Record<string, string>` (new, populated only when the object form was supplied, empty `{}` otherwise). Tests cover all three input shapes (array, object, absent). Rule opt-in shipped as Q2-WRAPMAP-RULES (3f7a07f + 7c7e43b + 713506a); compound-component extension shipped as Q2R2-COMPOUND (e1ca368). MCP tool wiring of `nativeWrapperElements` is the last remaining wedge — promoted as its own item below.
- [x] **Q2-WRAPMAP-MCP** Thread `LoadedConfig.nativeWrapperElements` through the MCP handlers so `configure` / `sessionConfigure` / `scan` / `scan_project` surface the element mapping alongside the flat names list (92dc714). `meta.activeNativeWrapperElements` emitted when map non-empty, omitted otherwise; `sessionConfigure` accepts both flat-array and object forms via `oneOf`. New `src/mcp/scan-assembly.ts` extracted plan/meta assemblers to stay under the line budget.
- [x] **Q2-WRAPGLOB** Glob patterns now accepted on `nativeWrappers` — `*Button`, `Icon*`, `*Card*`, `Icon*Button`. `*` expands to `[A-Za-z0-9]*` so globs stay inside identifier boundaries (no cross-dash or cross-whitespace match). Centralized in `src/mcp/wrapper-matcher.ts` (`matchesWrapperPattern`, `nameMatchesAnyWrapper`, `wrapperPatternToTagRegexSource`) and threaded through the three consumer sites: `dropWrapperNoise` (silence findings), `collectUsedWrappers` (unusedWrappers detection via AST walk), `findWrappersInExcludedSources` (text-search widening into stories/dev-tools). `unusedNativeWrappers` now tracks which PATTERNS matched — `*Button` counts as "used" when any variant appears; `Ghost*` surfaces as unused when nothing matches. No `?` / `[abc]` / `!` — just `*`, by design.
- [x] **Q2-WRAPMAP-RULES** `Rule.wrapperTreatsAsElement?: string` opt-in (3f7a07f + 7c7e43b). Context builder filters `LoadedConfig.nativeWrapperElements` against the rule's declared target tag and exposes `ctx.wrappersForElement: ReadonlySet<string>`. Rules that don't set the field see an empty set — identical to pre-Q2-WRAPMAP-RULES. Wired on 3 rules: `navigation/link-descriptive-text` (`"a"`), `media/alt-text-missing` (`"img"`), `forms/labels-required` (`"input"`). `forms/labels-required` also teaches implicit-label detection to accept mapped wrappers. CLI scan threads `fileConfig.nativeWrapperElements` into `runScan`. MCP tool wiring deferred — task guardrails excluded `src/mcp/` during concurrent work.
- [x] **Q2-WRAPPATH** `detect_native_wrappers` candidates now carry `definitionFile: string | null` (6930fce). One-hop basename probe (matches `ComponentName` against `{ComponentName}.{tsx,jsx,ts,js}`) via the existing `indexFilesByComponentName` helper P1-F already uses — no import-graph traversal, no transitive barrel-following. Barrels are invisible to the probe because the basename still matches the defining file. `null` is emitted (not omitted) when the probe fails — the attempt is meaningful.
- [x] **Q2-SNIPPET-KIND** Reason-driven snippet widening (bd94a21 + b0e26cc + 11a9472). `CROSS_LINE_REASON_PATTERNS` matches cues like "defined outside this line" / "referenced function"; matched candidates get a wide snippet instead of the ±3-line default. For TSX/JSX/TS/JS, `findEnclosingBlock` does a regex-free brace-balance walk (string/comment/template-expression aware via a per-state machine) to bound the enclosing function/block; over-cap blocks honestly fall back to the 10-line window rather than silently truncating. HTML/CSS keep the 10-line fallback. Snippet remains a plain string — no shape change.
- [x] **Q2-SESSIONCFG** Canonical tool name is now `sessionConfigure`; `configure` is a dispatch-only backward-compat alias not listed in `tools/list`. Calls via the legacy name still land on the same handler but get `warnings: ["deprecated_tool_name_configure"]` layered onto the response so agents can migrate on their own schedule. Description reframed to lead with the ephemeral session-only semantics and point at `ra11y.config.ts` for durable committed config. New `src/mcp/deprecation-warning.ts` owns the warning-layering helper (will be reusable when we rename other tools). Pattern mirrors P2-R's `file`/`filePath` alias.
- [x] **Q2-PRUNE** `ra11y baseline prune [--dry-run]` subcommand (ebbe753). Pure `pruneBaseline(entries, fileExists)` helper in `src/engine/baseline.ts`; CLI wrapper in `src/cli/commands/baseline.ts`. Reuses the existing `writeBaseline` serializer so metadata and retained-entry order round-trip. Missing/malformed baseline → exit 2 with stderr pointer to `ra11y baseline create`. No new exit codes.
- [x] **Q2-VERIFYCMD** `verifyCommand` + `verifyCommandStructured` on every `suggest_fix` response (100a0fa). Prose + structured pair, always populated (no conditional-spread — no suggest_fix response is meaningful without a re-verify). Structured form: `{ tool: "scan_file", args: { file, ruleId? } }`. Chose `scan_file` (narrowest deterministic verify) over `scan_project`; `ruleId` is advisory so the agent can post-filter the re-scan output.
- [x] **Q2-SARIF-DOCS** SARIF output + exit codes documented (d987876). `docs/cli.md` gets a `## SARIF output` section with field-mapping table sourced from `src/output/formatters/sarif.ts`; `docs/ci.md` is new — exit-code table, `--fail-on` reference, GitHub Actions (blocking + Security-tab upload via `github/codeql-action/upload-sarif@v3`), GitLab CI with artifact export, baseline adoption in CI.

### Considered and rejected (per CLAUDE.md §1)

- **Promote `editCandidate` to `kind: "edit"`** when the synthesis looks concrete (e.g. label-in-name's heuristic rewrite). → rejected per **§1 "Ambiguous field shapes are dishonest"**. `kind: "edit"` is a contract that the oldText/newText pair is a mechanical swap — the rule emitted it with certainty. `editCandidate` at `kind: "guidance"` is an LLM-synthesized guess from visible text + aria-label tokens (per P1-L). Promoting the guess to `kind: "edit"` would make the contract lie; the agent would batch-apply candidates that aren't verified. Current shape is correct.
- **Heuristic auto-dismissal** for "obvious debounces" (timer duration < 1s, pure-value-bubbleup onChange). → rejected per **§1 "Numeric-threshold heuristics are suppression"** + **"No heuristic suppression"**. Same reasoning as the original Q P0-A rejection. A 800ms animation and a 800ms auth-retry back-off are indistinguishable from static analysis; the agent reading the surrounding code is the only correct arbiter. Enrich `reason` text further if needed; do not filter the candidate list.
- **Weight cross-line signals** (`pointer-events-none`, `disabled`, `focus-visible:ring-*`) in `suggest_fix` ranking. → rejected per **§1 "Don't duplicate capability the agent already has"**. The agent reading the file sees those signals in one pass; a heuristic weighting in-tool produces output the agent can't tell to mistrust. The `focus-visible:ring-*` cross-reference IS already shipped for the `focus/outline-visible` rule (Track R) where the evidence is a concrete class-token link — but fix-ranking heuristics are the fuzzier form and belong to the agent.
- **Framework-version awareness in `suggest_fix`** (detect React 18 vs 19 from `package.json`, etc.). → rejected per **§1 "Don't duplicate capability"**. Agents read `package.json` trivially; building a detector in-tool is the kind of in-process inference that can be confidently wrong (monorepos, overrides, multiple React versions). Better: the agent reads the config and compose the fix itself.
- **Flatten `files[].findings[]` to `findings[]` with `file` inlined** when total < 10. → deferred (not rejected). Token-saving but introduces a shape branch on response-size — consumers that iterate by-file now have to handle both shapes. The current nested shape is fine; optimize only with a measured token budget goal.

### Deferred (worth doing eventually, not in this batch)

- **Rule-catalog reorganization** — resolve `parsing/duplicate-id` + `parsing/html-has-lang` vs `document/lang-attribute`; clarify `semantics/label-in-name` vs `forms/labels-required` vs `forms/non-empty-label`. Renames need a deprecation path (alias old IDs for one major release). Costs a semver major.
- **Server-side typecheck/parse verification** on `suggest_fix` suggestions. Expensive (spins up a parse per suggestion); might be worth it for high-stakes mechanical fixes but not across the board.
- **SARIF output for GitHub annotations** — already emit SARIF; "::error" annotation mapping is a small transform. Tied to Q2-SARIF-DOCS; promote if demand surfaces.

### v0.2.0 — round 2 retriage (added 2026-04-17)

Source: the 10-agent round-2 eval aggregation (`AGGREGATED.md`). Most items were *not* folded into Track Q (rounds 1-2, closed 2026-04-17) — the round-2 aggregation was produced around the same time but separately. Triage below retriages each item against CLAUDE.md §1 doctrine and existing Q/Q2 shipped work.

#### Accepted (P0 — structural/bug/shape parity)

- [x] **Q2R2-DIR-NEXT** `scan` (directory mode) now emits `nextStep` + `nextStepStructured` at parity with `scan_project` and `scan_file`. Uses the shared `buildNextStep` helper; `iterativeTip` left empty (scan has no scope-dimension to nudge about, unlike scan_project full vs changed mode). Empty-files branch still skips the pair — same as scan_project — because `warnings: ["scanned_zero_files"]` carries the "nothing scanned" signal and a `checklist` suggestion would be dishonest when no files were actually scanned. [round 2, agent 5]
- [x] **Q2R2-FIX-DEDUPE** When a finding's inline `fix` (now `fixClass`-typed, bbbecf1) already carries primary + alternatives + context, drop the `suggest_fix` suggestion from `nextStep`/`nextStepStructured`. Pairs with Q2-VERIFYCMD — the verify step still applies, but the "now call suggest_fix" handoff is redundant. Saves ~600 tokens per finding in tight fix loops. [round 2, agent 1] — 14e3d9a
- [!] **Q2R2-SCANNED-KEY** Canonicalize the "what was scanned" envelope across scan_project / scan / scan_file. Today: `scannedRoot` vs `scannedPaths` vs `scannedFile` — three keys forcing a branch. Target: `scanned: { mode: "project"|"dir"|"file", root?, paths?, file? }`. Parity with the P1-FILE-ENV alignment (70a9cd7). [round 2, agent 5] **BLOCKED 2026-04-18**: agent stashed its own MCP source edits as `unrelated-mcp-wip` (currently stash@{8} — was stash@{1} at block time; renumbered as other stashes landed on top). 7 files / 85 lines inserted including `src/mcp/scanned-envelope.ts`. Partial test-side updates landed dirty in `tests/{integration,unit}/mcp/*` but were reverted since source never materialized. Resume by `git stash apply stash@{8}` + re-running the agent with explicit stash-hygiene guardrails (don't treat concurrent-agent files as foreign).
- [x] **Q2R2-UNTARGETED-NAME** One canonical field name for the untargeted-criteria count (today: `plan.untargetedCriteria` on scan_project, `untargeted` on checklist, `manualUntargetedCount` on coverage, top-level `untargetedCriteria` on scan_file — four names, same concept). Same canonicalization pattern as P2-R (file/filePath). [round 2, agent 9]
- [x] **Q2R2-WRAPPER-SOURCES** Collapse `activeNativeWrappers` + `activeNativeWrappersBySource` + `sessionNativeWrappers` into one tagged list: `activeNativeWrappers: [{name, source: "config"|"autoDetect"|"session", confirmed?}]`. `confirmed` folds in P1-F. [round 2, agent 9]
- [x] **Q2R2-COVERAGE-CHECKLIST** ADR 0010 landed (fe962f6) + execution (3093b67, 27e12d0). `checklist.summary.automatedCoverage` trimmed to `{ standardId, automatedCriteriaPassRate }`; `criteriaAutomatable` + `criteriaAutomatablePassing` dropped. `coverage` cross-points to `checklist` when `manualWithCandidates` non-empty, to `scan_project` when only failing-automated remain, omitted when clean. `checklist` cross-points to `coverage` when `actionable === 0`, to `checklist` (paging) when truncated, omitted otherwise. Both tools conditional-spread `nextStep`+`nextStepStructured` as one unit. 4 new integration tests cover scalar parity + args round-trip + aligned-pair discipline. Merge with verbosity knob still deferred to v1.0.0 behind a deprecation alias path. [round 2, agent 7]
- [x] **Q2R2-META-CACHE** Meta-cache skeleton + wiring landed across scan / scan_file / scan_project / scan_diff (14c35a4 + 608cda7 + a2d7b57). Input flag is `metaMode: "full" | "delta"`, default `"full"` so legacy callers see zero shape change. Under `metaMode: "delta"`, first call returns full meta stamped with `sessionRef: "<tool>-<8hex>"`; repeat call with same signature returns `{ sessionRef, delta: {...}, removedFields? }` (removedFields omitted when empty, honest conditional-spread). Signature hash covers tool name + cwd + paths + standards/level + additionalPaths; excludes `metaMode` itself + pagination so a paged walk stays on one ref. Unit + integration tests committed (2ae7baa + c14e137). Extension shipped across checklist / coverage / list_suppressions — three out of the four follow-up tools wired; list_rules deferred because its response is pure enumeration data (no scan-confidence telemetry, no cwd/filesScanned signal to cache) and the meta block would be trivial. For checklist + coverage the `meta` block is opt-in per `metaMode: "delta"` so legacy callers see zero shape change (neither tool had `meta` historically); list_suppressions' existing meta gets wrapped by `applyMetaCacheMode` directly. [round 2, agent 1]

#### Accepted (P1 — load-bearing capability)

- [x] **Q2R2-WRAPPER-INTROSPECT** ADR 0012 (e47ec5d) + execution (81707b1, 5bf4c00, a16a3a9). `wrapper_introspect` MCP tool returns per-wrapper records with `observedRoot ∈ {button|a|input|div|opaque|unknown}` + `confidence ∈ {confirmed|assumed|unresolved}`; textarea/select/input collapse onto `"input"` to match the ADR's DOM bucket set. Per-file-hash cache keyed via `WeakMap<McpSession>`; natural invalidation on content change. One-hop basename probe only (no transitive import following). `nextStep` routes to `propose_config` when all records are confirmed, else `detect_native_wrappers`. 11 tests. Per ADR, introspection is an audit/discovery signal — never silently rewrites `LoadedConfig.nativeWrappers`. [round 2, agent 2]
- [x] **Q2R2-DRIFT** New rule `wrapper/drift` — component declared in `nativeWrappers` (or auto-detected) whose definition no longer renders the expected native element. Fires at the DEFINITION file. Closes the "fixing a wrapper is silently safe; breaking it is silently catastrophic" asymmetry — the breakage surfaces the moment the wrapper is edited. [round 2, agent 2]
- [x] **Q2R2-INHERITED** ADR 0014 `docs/adr/0014-inherited-findings.md` (a271077) + implementation `src/engine/inherited-findings.ts` + `tests/unit/engine/inherited-findings.test.ts` (landed earlier; ADR now documents the decisions the impl already encodes). Cap decision: **all call sites, no cap** — per CLAUDE.md §1 "Surface, don't suppress" + "Labeled buckets are suppression too"; agents dedup via groupKey, suppress via source pragma. Rollout: **always on, no flag** — the signal is not something an agent can opt into discovering. `confidence: "inherited"` extends the existing enum (single axis); fresh findingId/groupKey per call site so each is an independent baseline/attestation target. Interaction with polymorphic-dispatch + baseline + attestations (ADR 0013) documented in §Consequences. [round 2, agent 2]
- [x] **Q2R2-POLYMORPHIC** Resolve literal `as` / `asChild` prop values and re-dispatch rules against the resolved element. `<Button as="a" href=...>` re-runs `link-no-href`, `link-descriptive-text`. Only literals — dynamic `as={Something}` stays unresolved (honest — agent reads and decides). Engine surface shipped (0b130dd: `ctx.resolvePolymorphic`, link-descriptive-text opted in); follow-up opt-ins landed (b07455b: alt-text-missing, labels-required, semantics/button-name). [round 2, agent 2]
- [x] **Q2R2-COMPOUND** Typed compound-component mapping in config: `nativeWrappers: { Card: { Header: "div", Body: "div" }, Composer: { SendButton: "button" } }`. Extends Q2-WRAPMAP object form with nested dotted-path keys. [round 2, agent 2]
- [x] **Q2R2-RULE-COV** Per-rule coverage confidence on scan responses: `{ ruleId, filesEvaluated, filesEligible, coverageConfidence: "high"|"low", reason?, remediation? }`. Derivative split: `confidentlyClean: [ruleIds]` vs `lowConfidenceClean: [ruleIds]`. Tailwind-pre-build is the acute case (`contrast/minimum` runs against 2 CSS files, 0 findings ≠ clean). Distinct from Q2-RULEDETAILS (rule *catalog* inline) — this is per-rule *trust* per scan. [round 2, agent 6]
- [x] **Q2R2-CWBB** Shape + forwarders landed (2df787a + ADR 0009, 3e63715 for json/sarif). Optional `readonly couldBeWrongBecause?: readonly string[]` on `Violation`; wired through MCP `formatFinding`, `agent` formatter, `json` (passthrough), and SARIF (`Result.properties.couldBeWrongBecause`) with conditional-spread so empty/absent reads identically to consumers. Text-contrast opt-in shipped (02b8bf8): `contrast/minimum` + `contrast/enhanced` emit `tailwind_class_on_consumer` when a `text-*`/`bg-*` utility on the consumer would override the failing declaration; rules promoted to project scope; helpers in `src/rules/contrast/_shared.ts`. Non-text contrast opt-in shipped: `contrast/non-text` emits `tailwind_class_on_consumer` when a `border-*` / `outline-*` / `ring-*` utility on the consumer would override the failing declaration (boundary-vs-background axis — distinct family set from the text-contrast opt-in, same reason code); rule promoted to project scope; family sets exposed as `TEXT_CONTRAST_OVERRIDE_FAMILIES` / `NON_TEXT_CONTRAST_OVERRIDE_FAMILIES` in `_shared.ts`; `divide-*` intentionally excluded (applies between children, not the element itself). **Deferred** (rejected by the implementing agent as a fuzzy signal): `forms/required-indicator-missing` → `replacement_indicator_in_sibling_file` — "required"/"Required" tokens fire on nearly every form-heavy codebase (react-hook-form, zod, formik, test assertions); needs a tighter signal before it earns the opt-in. `estimatedFpRate` numeric remains rejected per §1 "Numeric-threshold heuristics are suppression." [round 2, agent 8]
- [x] **Q2R2-STORYBOOK-PRESET** MVP shipped (6dfa231 + aee3134). `Config.preset: "storybook"` accepted + validated; `isStorybookStoryFile` matches `*.stories.{tsx,jsx,ts,js}` + `*.story.*`; `DiscoverOptions.includeStoryFiles` drops only story-file patterns when the preset fires (tests/mocks still excluded); Storybook primitives (`Meta`, `StoryObj`, `StoryFn`, `Story`) exempt from opaque-component classification inside story files only (product `<Meta/>` stays opaque); `warnings: ["storybook_preset_active"]` emitted when preset engages. Args-binding follow-up landed (0bb8842 + 0fa523d + 55ba1f7 + 2a95a48 + 6c878dd): `parseTsx(source, { filePath })` runs a Storybook synthesis pass that appends a virtual `<ComponentName attr=... />` JsxElement for each `StoryObj` / `StoryFn` / `Story` / `Meta`-typed declarator with literal `args`, so rules that need to evaluate the rendered shape (alt-text-missing, button-name, labels-required, etc.) get a chance to fire on story files. Each synthesized element carries `synthesized: { source: "storybook-args", storyName }` for honest provenance. Spreads, callbacks, identifier-reference values, dynamic templates, and unresolvable components all skip synthesis (no half-known elements). [round 2, agent 4]
- [x] **Q2R2-FORM-REQ** New rule `forms/required-indicator-missing` — component forwards `required` to a native input but renders no visible marker and no `aria-required`. Cites wcag22:3.3.2. Fires at the wrapper DEFINITION. [round 2, agent 3]
- [x] **Q2R2-FORM-TIE** Review finder `forms/server-error-untied` under wcag22:3.3.1. `<p role="alert">` / `<div aria-live>` sibling of a field where the field has no `aria-invalid` / `aria-describedby` pointing at the error's id. Finder, not rule — cross-element proof requires inspection agents do better. [round 2, agent 3]
- [x] **Q2R2-FORM-TIMING** Review finder `forms/validation-timing` under wcag22:3.3.3 / 3.3.4. Surfaces `onChange` validation handlers that fire per-keystroke. Reason-text enrichment only — agent decides whether `onBlur` is appropriate; no auto-downgrade. [round 2, agent 3]

#### Accepted (P2 — orchestration / DX)

- [x] **Q2R2-BOOTSTRAP** `bootstrap` MCP tool — composes `detect_native_wrappers` + `propose_config` + `scan_project` + `baseline create` + returns a CI snippet in one call. Interrogation note (§1 "Interrogate the problem"): is this a docs gap or a genuine composition primitive? Round-2 signal from two independent agents suggests the latter; build after Q2R2-PROPOSE-CFG lands. [round 2, agents 7, 10]
- [x] **Q2R2-SUPPRESS-TOOL** `suppress` MCP tool — input `{ file, line, ruleId, reason }`. Inserts the appropriate source pragma (block-comment for HTML, JSX-comment for TSX). Required reason (rejects bare — mirrors Q2-REASON source-rule). [round 2, agent 7]
- [x] **Q2R2-CFG-SNIPPET** `detect_native_wrappers` response adds `suggestedConfigSnippet: string` as a structured field. Today it's buried in `nextStep`'s English; agents parse prose to extract config. [round 2, agent 9]
- [x] **Q2R2-PROPOSE-CFG** `propose_config` MCP tool — synthesizes `ra11y.config.ts` from scan state (wrappers + exclude + commented rules stub). Deterministic; no LLM. [round 2, agent 10]
- [x] **Q2R2-PROPOSE-BASE** `propose_baseline` MCP tool — categorizes each would-be entry with a machine-readable reason code (`wrapper-undetected` / `third-party-html` / `legacy-route` / `design-system-internal`). Reviewers triage by category. [round 2, agent 10]

#### Accepted (P3 — polish)

- [x] **Q2R2-INTENTIONAL** `@ra11y-intentional` JSDoc tag on a component declaration — intentional-failure-demo marker (Storybook "bad example" pattern). Functionally a file-scoped `ra11y-disable *` pragma but syntactically part of docs markup. Required reason. [round 2, agent 4]
- [x] **Q2R2-SCAN-MIXED-DOC** Document that `scan` accepts `paths: string[]` of mixed files + dirs. The primitive exists; it's non-obvious. One-line in `tools/list` description + a `docs/mcp/tools.md` note. [round 2, agent 5]

#### Considered and rejected (round 2 retriage)

- **Glob-ignore `*.stories.tsx` as default** → rejected per §1 "Default-exclude globs are suppression too." Story-file zero-findings is an honest signal (structurally unanalyzable). Fix: the `preset: "storybook"` that scans what stories exercise (Q2R2-STORYBOOK-PRESET above), not a filename carve-out. Severity-downgrade variants fail for the same reason.
- **Auto-suppress when `couldBeWrongBecause` escape hatch is provably present** → rejected per §1 "No heuristic suppression." The structured field is informational (Q2R2-CWBB); the agent reads the file and decides. Baking inference into the tool creates the silent-miss mode the doctrine exists to prevent.
- **`estimatedFpRate: number` on every finding** → rejected per §1 "Numeric-threshold heuristics are suppression." Any consumer filtering on `fp_rate > X` reintroduces silent-miss. Reason-text + `couldBeWrongBecause` carry the same information without the threshold.
- **`reportFalsePositive` as a persistent out-of-tree dismissal** → rejected as new surface; **superseded by C-ATTEST-TOOL** (Track C). Attestation ledger is the durable out-of-tree evidence channel with the evidence-slot the doctrine requires. Track here as "duplicates Track C."
- **Surface `limitations` once at session level** → rejected. `limitations` is a per-scan honest signal; the specific scan's inability to verify runtime criteria is what the agent needs for that specific claim. Session caching creates a "was this scan's limits the session's, or did they change?" gap — silent-miss risk. Keep per-response.

---

## Track C — Conformance-claim gaps

Owner: main session + `spec-researcher` + `doc-writer`. Staged; do not dispatch alongside active tracks. ra11y today produces *signals* (findings, review candidates, coverage hints). It does not produce a *claim*. Track C closes the four gaps that separate the two — attestation ledger, runtime-evidence ingest, process-level scope, conformance statement. **No new rules**; the track widens what an agent can defensibly say after using the tool.

Sequencing (cross-gap, soft): attestations first (unlocks evidence semantics everywhere else), then axe ingest (wide-reach runtime coverage), then process scope, then conformance capstone. Within each gap items are ordered by the ADR-then-foundation-then-surface pattern.

### v0.3.0 — attestation ledger (foundation)

- [x] **C-ATTEST-ADR** ADR 0011 (evidence as first-class primitive) + ADR 0012 (rule-scoped attestations) cover this slot.
- [x] **C-ATTEST-STORE** `.ra11y/attestations.jsonl` append-only store with validated envelope landed in `src/config/attestation-store.ts`.
- [x] **C-ATTEST-TOOL** `attest` MCP tool landed; accepts `criterionId`, `ruleIds?`, `verdict`, `scope`, `location?`, `reason`, `by`; stamps commit hash; rejects bare verdicts.
- [x] **C-ATTEST-LIST** `list_attestations` MCP tool landed with git-backed staleness probe + `staleProbeUnavailable` signal for non-repo environments.
- [x] **C-ATTEST-PRUNE** `ra11y attestations prune [--dry-run]` subcommand landed; pure function + injectable `fileExists` predicate.
- [x] **C-ATTEST-CHECKLIST** Checklist items spread per-criterion `attestation?: { verdict, stale?, evidence, by? }` with conditional-spread discipline.
- [x] **C-SUPPRESSION-ATTEST** Bare pragmas emit `verdict: "pending"` attestations; reasoned pragmas emit `"pass"`; `suppression/no-reason` finder retained as complementary signal.

### Rejected — runtime evidence bridge (2026-04-19)

A prior plan proposed ingesting vendor runtime results (axe-core JSON → normalized shape → ledger) as the path to close runtime-only WCAG criteria. Rejected: vendor-specific ingest adapters duplicate capability agents already have via their own test harnesses, and the tool's job is to point at the source — not at another tool's output. The ingest shape is also fragile to vendor schema drift, and the normalized layer re-buckets findings in ways the reading agent can't re-audit. Agents that run runtime checks bridge their results through the existing `attest` tool — the reason text is the evidence, and the attestation ledger is the durable, vendor-neutral channel.

Items struck: C-RUNTIME-ADR, C-AXE-SCHEMA, C-AXE-INGEST, C-RUNTIME-MAP. C-COVERAGE-MERGE is re-scoped below.

- [x] **C-COVERAGE-MERGE** Coverage report integrates attestations; per-criterion row carries optional `attested: { verdict, stale? }`. Manual criteria with fresh pass/n-a attestations count toward covered. Stale/pending/fail don't flip static verdicts.

### v0.3.0 — process-level scope

- [x] **C-PROCESS-ADR** ADR 0016 (process-level scope) landed.
- [x] **C-PROCESS-CONFIG** `processes: [{ name, pages }]` config primitive + schema validation + loader wiring.
- [x] **C-PROCESS-SCAN** `scan_process` MCP tool landed; orchestrates per-page scan with process-level frame.
- [x] **C-PROCESS-CONSISTENCY** `consistent-navigation` finder honors declared processes; heuristic path retained as fallback with a reason-text nudge to declare the primitive.
- [x] **C-PROCESS-IDENT** `consistent-identification` finder for wcag22:3.2.4; emits zero candidates when no processes config (honest needs-config gap).

### v1.0.0 — conformance capstone

- [x] **C-PROFILE-WCAG21AA** `ConformanceProfile` primitive + 8 built-ins (wcag21-a/aa, wcag22-a/aa/aaa, section508, en301549, ada); `--profile` CLI flag with explicit-override warning. Profile→reports scope filtering wired in turn 8.
- [x] **C-CONFORM-ADR** ADR 0017 (conformance-statement-output) landed.
- [x] **C-CONFORM-STATEMENT** `conformance_statement` MCP tool + `src/reports/conformance.ts` landed; refuses when coverage is incomplete; blocker list cites missing criteria.
- [x] **C-CONFORM-SIGN** SHA-256 digest over (commit hash + attestations + in-scope criteria + config fingerprint); canonical JSON; `verifyConformanceBundle` for drift detection.
- [x] **C-CONFORM-DOC** `docs/conformance.md` end-to-end agent guide: scan → checklist → attest → coverage → signed statement.

### Dependencies + interactions with Track S

Track S speculative tools (`verdict-candidate`, `draft-vpat-narrative`, `resolve-component`) become concretely useful once **C-ATTEST-TOOL** lands — their output is evidence the agent writes to the ledger. Track C resolves Track S's "pick 1–2 speculative tools" decision (ADR 0005 §Follow-up): `verdict-candidate` is the natural first pick because its output IS an attestation entry. Promote Track S `[!]` items to `[ ]` once C-ATTEST-TOOL is merged.

### Considered and rejected

- **Embed axe-core as a runtime dep.** Rejected per **§3 invariant 1** (zero runtime deps). Parse axe's JSON output; don't pull axe-core into the install. Agents already run axe in their test harness; they hand us the JSON path.
- **In-tool headless browser (Playwright / Puppeteer).** Rejected per zero-deps + MCP-first-consumer framing — the agent already runs the browser in its test harness. We ingest; we don't drive.
- **Blanket "ra11y verifies conformance" marketing.** Rejected — the conformance statement will cite evidence sources; ra11y is the aggregator, the attestation is the agent's (or human's) word, and the signed bundle is what survives audit. Honesty > reach.

---

## Track V — v1.0.0 readiness

Owner: main session + `doc-writer` + `fixture-curator` + `test-author` + specialists as indicated per item. Source: 2026-04-19 three-agent gap analysis (rule coverage vs WCAG 2.1/2.2 A+AA, MCP shape discipline, backlog + semver + CI infra). The conformance capstone in Track C is shipped; these are the remaining gates for the "find all violations" bar.

No item here proposes new rule detection logic — Track V is about honesty surfaces, decision closure, and coverage verification. Items that WOULD add detection get logged as Track R or Track C items.

### v1.0.0 — coverage honesty

- [x] **V1-COVERAGE-MATRIX** Authoritative matrix published at `docs/kb/standards/coverage.md` (92f6070 generator + c7d41fa doc + check-kb-drift extension). 252 unique criteria across 5 standards: 116 rule · 105 finder · 25 attestation-only · 6 gap. All six gaps are AAA-only (animation-from-interactions, link-purpose-link-only, target-size AAA) where the AA equivalent already ships. Drift check green.
- [~] **V1-CRITERION-KB** Attestation-only criteria seeded — 25 KB entries landed (ca35661): 13 wcag22 + 10 wcag21 + 1 section508 + 1 en301549. One of the 9 `GUIDANCE_BY_ID` entries (`wcag22:3.1.3`) is attestation-only and now has a KB entry; the other 8 are finder-covered and would need entries in that tier. Full acceptance (every criterion in the matrix → KB file, `GUIDANCE_BY_ID` removed) deferred to v1.0.x follow-up; the attestation-only half unblocks the `attest` workflow documentation.
- [~] **V1-FIX-AUDIT** Audit published at `docs/kb/rules/fix-suggestion-audit.md` (e1d571c + a5f1a58). 52 rules enumerated: **41 context-aware · 11 generic · 0 caveat-only · 0 needs-review**. Acceptance says "zero rows marked generic at v1.0 tag" — 11 rows remain generic: `document/lang-attribute`, `document/page-titled`, `focus/tabindex-positive`, `forms/non-empty-label`, `media/video-captions-missing`, `navigation/link-no-href`, `parsing/duplicate-id`, `semantics/button-name`, `semantics/empty-heading`, `semantics/landmark-main`, `semantics/table-headers`. Each needs a `feat(rules): context-aware fix for <rule>` follow-up commit before v1.0 tag — audit file has proposed context inputs per row.
- [x] **V1-FIX-RANK-DOC** `docs/kb/patterns/suggest-fix-ranking.md` published (92f6070). Documents the two axes (fixClass on Violation vs kind on suggest_fix response), batch-routing table for all four fixClass values with per-value rule inventories, primary/alternatives ranking contract, edit vs editCandidate distinction, verifyCommand post-fix workflow. `confidenceRationale?: string` decision: **defer** — existing `primary.label`, `explanation`, `caveat` already carry the signal in human-readable form.

### v1.0.0 — surface discoverability

- [x] **V1-PROMPT-LINK** Prompt templates wired into `nextStep` prose across scan / scan_project / review_candidates / checklist (52f97aa). `ra11y/triage` surfaces on clean+manual and on review_candidates; `ra11y/audit` on clean+zero-manual and on checklist-zero-actionable; `ra11y/fix` on violations-with-fix and all-mechanical; `ra11y/vpat-narrative` on checklist-zero-actionable alongside audit. `nextStepStructured` left as-is per ADR 0010 alignment.

### v1.0.0 — real-world fixture push

Track F shipped 10 fixtures, all guarding scanner infrastructure (wrappers, templates, TSX generics). Zero fixtures exercise rule-territory behavior in production-like shape. Each item below lands one sanitized fixture under `tests/fixtures/real-world/<case>/` with `source/` + `assertions.ts`, following the ADR 0006 harness. Dispatch in parallel — independent fixtures.

- [x] **V1-FIXTURE-FORMS** `tests/fixtures/real-world/forms-validation/` landed (7694cdb). Asserts labels-required, fieldset-legend, required-indicator-missing, autocomplete-missing rules; validation-timing, error-identification, server-error-untied finders. Zero-parse-errors across ContactForm.tsx + PhoneField.tsx.
- [x] **V1-FIXTURE-NAV** `tests/fixtures/real-world/nav-landmarks/` landed (f97ccbf). Asserts landmark-main, skip-link, link-descriptive-text rules + consistent-navigation finder across two divergent route files (home.tsx + about.tsx) and shell.html.
- [x] **V1-FIXTURE-DIALOG** `tests/fixtures/real-world/dialog-modal/` landed (2be0974). Three ConfirmDialog variants + page.tsx; asserts no-keyboard-trap finder fires on `role="dialog"` regardless of labeling; valid ARIA role passes aria/invalid-role; backdrop onClick exempted by keyboard/handler-missing. Drift: no rule today emits `couldBeWrongBecause` on dialogs — documented in fixture README.
- [x] **V1-FIXTURE-TABLE** `tests/fixtures/real-world/data-tables/` landed (aaa94ed). Three variants — SimpleTable (td-only, violation), ScopedHeaderTable (clean), ComplexHeaderTable (clean). Finding: `semantics/table-headers` satisfies wcag22:1.3.1; no table-specific review finder exists (Track R gap).
- [x] **V1-FIXTURE-LIVE-REGION** `tests/fixtures/real-world/live-region-status/` landed (aaa94ed bundle). StatusBanner + ToastRegion + Page; asserts aria/live-region-valid fires on invalid tokens, role/aria-live contradictions, hidden regions. Drift: `couldBeWrongBecause: "runtime_behavior_required"` is NOT emitted by this rule today — documented in fixture README; that enrichment would be a Track R item.
- [x] **V1-FIXTURE-ATTEST** Both fixtures + doc landed (d43358f attest-axe + 1750692 attest-lighthouse + bbcd71a `docs/kb/patterns/bridging-runtime-a11y.md`). Synthetic axe-core JSON + Lighthouse JSON, bridge scripts showing the agent-side mapping to `attest` calls, assertions verifying the parse path. No vendor-specific runtime ingest adapters in src/ — the bridge is a documented PATTERN, not code ra11y runs. (d43358f's commit subject mis-titles the fixture work as "prompt templates"; content is correct.)

### v1.0.0 — deferred-decision closure

Each item closes one deferred ADR or semver-major decision. Acceptance for each: an ADR marked Accepted (or Superseded / Rejected) + the corresponding backlog item flipped.

- [x] **V1-RULE-RENAME-DECIDE** Deferred past v1.0 via ADR 0018 (93e0207). Current rule names stay stable; revisit on user complaints / further catalog-overlap signals.
- [x] **V1-COV-CHECK-MERGE** Deferred past v1.0 via ADR 0018 (93e0207). ADR 0010 stays; coverage + checklist remain separate tools with cross-linked `nextStep` pairs. Revisit on concrete round-trip-cost evidence.
- [x] **V1-PARSER-SUBPKG-DECIDE** Deferred past v1.0 via ADR 0018 (93e0207). ADR 0003 stays; core stays monolithic. Revisit on peer-resolution edge cases or a second non-trivial parser.
- [x] **V1-SAMPLING-TOOL-PICK** Deferred past v1.0 via ADR 0018 (93e0207). Track S `[!]` items remain blocked; `verdict-candidate` is the pre-picked first promotion when a sampling-capable host surfaces a concrete workflow.

### v1.0.0 — release hygiene

- [x] **V1-BENCH-BASELINE** v1.0 performance baseline locked (8e8a564). All four scenarios 79-95% under budget: cold 41ms/200ms, 10-files 5.2ms/100ms, 100-files 28.5ms/500ms, 1000-files 272ms/3000ms. Headroom watch: cold-start grows with CLI module graph; 1000-file throughput scales linearly with rule count.
- [x] **V1-API-STABILITY-AUDIT** v1.0 public surface frozen in ADR 0019. Audit confirmed `check-tsdoc.ts` passes on baseline; no `@experimental` / `@internal` tags on exported names (the one `@internal` marker in the tree sits on a non-exported symbol in `src/output/agent-response/build-finding.ts`); no accidental re-exports of internal types (types not listed in `src/types/index.ts` are deep-import-only and remain free to evolve). ADR enumerates every exported name across both entry points: 8 names from `@ra11y/core` (`Criterion`, `ReportData`, `ScanResult`, `Severity`, `Standard`, `Violation`, `scan`, `ScanOptions`) and 7 from `@ra11y/core/plugin` (`defineRule`, `defineStandard`, `defineFormatter`, `defineConfig`, `defineCandidateFinder`, `FormatterFn`, `Formatter`). Escape-hatch `experimental` column documented but empty at v1.0.
- [~] **V1-CHANGELOG-V1** Draft `## [1.0.0]` entry landed (1d784b7). Date placeholder `YYYY-MM-DD` stays until user says ship. Sections populated: Breaking Changes (exit-code freeze), Added (13 sub-groups), Changed (9 items), Deprecated (2 aliases), Fixed (19 items), Deferred (the four ADR 0018 items). New empty `## [Unreleased]` sits at top. Ready for `/release 1.0.0` when the user triggers.

### v1.0.0 — test coverage gates (second-pass scan, 2026-04-19)

Source: coverage sweep during second-pass gap scan — MCP surface and several CLI commands have severe coverage deficits that contradict the "find all violations" bar. Every item here lands tests against committed behavior; no behavioral changes.

- [x] **V1-TEST-MCP-SERVER** `src/mcp/server.ts` raised from 8.28% → 96.96% lines / 97.22% funcs (eb6fd73 + cb0da5a + d42c6fb). 36 new in-process dispatch tests via a new shared `tests/helpers/mcp-harness.ts` since integration tests spawn subprocesses and don't cross instrumentation. Remaining uncovered lines are defensive/unreachable branches.
- [x] **V1-TEST-MCP-SCAN-DIFF** `src/mcp/tool-scan-diff.ts` raised from 18.12% → 96.90% lines / 95% funcs (c3efd95 + 5d0c99b). 21 in-process dispatch tests cover baseline mode, hunks mode, structured errors, symlink normalization, stable `findingId`/`groupKey`. Remaining uncovered branches are impossible-in-practice race cases.
- [x] **V1-TEST-MCP-APPLY-FIX** `src/mcp/tool-apply-fix.ts` raised from 43.71% → 100% lines / 95.49% branches (120569d + 6f36e30). 26 new unit tests drive the handler in-process (existing integration tests drive the subprocess, which instrumentation doesn't cross). Internals file `tool-apply-fix-internals.ts` rode along to 96.55%/95.91%.
- [x] **V1-TEST-CLI-CMDS** Six CLI commands lifted from 0% to 100% function coverage (b827dc7 + 30644ea + 4342de4). `certification`, `checklist`, `coverage`, `vpat`, `doctor`, `init` all exercised via in-process handler invocations against tmpdir fixtures; `doctor` line-coverage at 87.93% (remaining branches require mocking `process.version`), all others at 100%.
- [x] **V1-TEST-MCP-GLUE** All five target modules raised to 100% lines / 100% branches (235db1a + 28f2224 + 7740a44; logging.test.ts file swept into 5d0c99b by parallel agent). 59 new tests across completions, deprecation-warning, outbound, logging, ra11y-kb resources. Every module confirmed reachable from `src/mcp/server.ts`.
- [x] **V1-TEST-CONFIG-SCHEMA** `src/config/schema.ts` raised from 6.94% → 100% lines / 100% funcs (4dfd9d6). 42 new tests in `tests/unit/config/schema.test.ts` covering accepted shapes, rejection paths, error-path indices, and output normalization.

### v1.0.0 — CI + release pipeline gates (second-pass scan, 2026-04-19)

- [x] **V1-CI-WINDOWS** `windows-latest` added to verify matrix (b0b07cc). Fail-fast stays false so an OS hiccup doesn't cancel the other lanes.
- [x] **V1-RELEASE-VERIFY-FULL** Already satisfied — `.github/workflows/release.yml:43` runs `bun run verify` (full, not trimmed). The second-pass audit that flagged this was against stale state.
- [x] **V1-CI-SARIF-UPLOAD** Self-scan job added to ci.yml (6315a06). Runs `ra11y scan src/ --format sarif --fail-on never` and uploads to GitHub Security via `github/codeql-action/upload-sarif@v3`. Makes ra11y the reference implementation of its own CI integration.
- [x] **V1-CI-DEP-REVIEW** `.github/workflows/dependency-review.yml` added (914d4f1). GitHub's dependency-review action runs on every PR alongside the in-house zero-dep guard; `fail-on-severity: moderate`, `comment-summary-in-pr: on-failure`.
- [x] **V1-EXIT-CODES** Canonical `ExitCode.{OK,VIOLATIONS,USER_ERROR,NEW_VIOLATIONS}` enum landed in `src/cli/exit-codes.ts` (8e8b0ef). Every command now returns via the enum; `ra11y --help` renders the legend from `EXIT_CODE_LEGEND`; `docs/cli.md` cross-links `docs/errors.md`. Frozen at v1.0.
- [x] **V1-MCP-ERRORS-DOC** `docs/errors.md` created (5bfcf34). 26 MCP structured errors indexed (24 from the central union + 2 suppress-local cast-through codes documented as intentional), 4 CLI exit codes indexed. Canonical error + exit-code reference.

### v1.0.0 — code-quality polish (second-pass scan, 2026-04-19)

- [x] **V1-TYPE-ESCAPE** Redundant `as unknown` cast dropped (7979ef8); `coerceAttestationRecord` already accepts `unknown`, the cast widened a narrower type to no purpose.
- [x] **V1-ERROR-MSG-QUALITY** All three throw sites rewritten (7979ef8): sampling.ts now names the actual type returned + links the MCP spec + suggests the host decline the capability; attestation-store.ts enumerates the specific failed field + shows a concrete example record; tool-suggest-fix-internals.ts is marked as an internal invariant with a file-an-issue hint.
- [x] **V1-COMMENT-DRIFT** Hardcoded count removed (456158d); the comment now describes the contents (excludes 4.1.1, includes the nine new 2.2 criteria) rather than asserting a drifting count.
- [x] **V1-README-PLUGIN-LINK** Per-plugin-kind authoring guides now linked inline in the Plugin API section (3379e03). The prior scan's claim of a broken `docs/plugin-authoring.md` link did not match the current README — the three `docs/plugins/authoring-a-*.md` guides are now cross-linked alongside the examples + architecture deep-dive.
- [x] **V1-DOCS-CLI-COMMANDS** Per-command reference section added to `docs/cli.md` (192cf0d). Each command gets a subsection with purpose + representative invocation + key non-global flags; `baseline prune` + `attestations prune` subcommands now documented; `--profile` flag added; usage synopsis updated to reflect command dispatch.
- [x] **V1-MIGRATION-0.2-TO-1.0** `docs/migrations/0.2-to-1.0.md` landed (2f9af2e). TL;DR: v1.0 is additive for most consumers. 4 deferred items (from ADR 0018) + 1 breaking change (exit-code freeze) + 2 soft deprecations (`configure` → `sessionConfigure`, `filePath` → `file`). Cross-linked from CHANGELOG.md + docs/getting-started.md.

### Considered but not elevated to Track V

- **Implement the remaining manual-only criteria as finders.** The coverage matrix (V1-COVERAGE-MATRIX) will enumerate actual gaps — per finder review the finder list confirms most are already covered. If V1-COVERAGE-MATRIX surfaces genuine gaps, each becomes a Track R `R-<criterion>-<topic>` item, NOT a Track V item. Track V verifies; Track R implements detection.
- **Widen real-world fixtures beyond the five above.** SPA routing, internationalization, dark-mode contrast, reduced-motion — all worth fixtures, none are "find all violations" gates. Log as Track F `F-V1.x` items if the v1.0 bar rises.
- **OSSF Scorecard / npm audit workflows.** Nice-to-have for supply-chain posture; zero-dep invariant already covers most of the surface. Skip unless a real signal arrives.

---

## History — Phases 0–17 complete

Historical record; do not modify. The `/continue` skill does not walk this section.

- **Phase 0** — Autonomous Claude Code infrastructure (hooks, agents, skills, settings).
- **Phase 1** — Guard + generator scripts; `scripts/verify.ts` single entrypoint.
- **Phase 2** — Core types, registries, scanner skeleton, AST helpers, public API surface.
- **Phase 3** — WCAG 2.2 standard module; 86 active criteria + historical 4.1.1.
- **Phase 4** — In-house utilities (logger, assert, fs, path, glob, git, ansi, string-width, wrap, color, contrast, args, index).
- **Phase 5** — Parsers: tsx, html, css, tailwind + theme resolver + discover; unit + fuzz tests.
- **Phase 6** — Rule engine + first 5 rules (alt-text-missing, contrast/minimum, link-descriptive-text, focus/outline-visible, parsing/duplicate-id).
- **Phase 7** — Scanner + terminal/plain/json formatters + theme + snapshot tests.
- **Phase 8** — CLI: scan, list-rules, list-standards, explain, coverage, checklist, vpat, certification, init, doctor.
- **Phase 9** — WCAG 2.1 standard module (reuses rules via equivalentTo).
- **Phase 10** — Section 508 + EN 301 549 standard modules (thin equivalentTo wrappers).
- **Phase 11** — Remaining rules across contrast, focus, keyboard, aria, semantics, forms, pointer, navigation, layout, tooltip, document domains. 54 rules total.
- **Phase 12** — Alternative formatters: sarif, junit, markdown, html, agent.
- **Phase 13** — Reports: coverage, checklist, vpat, certification.
- **Phase 14** — Config, inline disables, baseline mode (create/check/update), monorepo `projects: []` support.
- **Phase 15** — Plugin API (`defineRule`, `defineStandard`, `defineFormatter`, `defineConfig`) + three example plugins + CI smoke job.
- **Phase 16** — Long-form docs: getting-started, CLI, configuration, architecture, KB (architecture + patterns + concepts + gotchas + glossary), certification guides, plugin authoring, MCP docs, ADRs 0001–0005.
- **Phase 17** — CI workflows (ci.yml, release.yml), issue + PR templates, dependabot.
- **Phase 18 partial** — README with real output snapshots + multi-standard-scan integration test + mcp-session integration test coverage audit. Remaining demo/tag/publish items live in Track D above.
- **Phase 19 partial** — In-house JSON-RPC 2.0 MCP server (~200 LoC), session state + AST cache by mtime, 10 live tools, session config for `nativeWrappers`, `.mcp.json` auto-attach, integration tests. Remaining hardening items live in Track M above.
- **Phase 22 partial** — Review finders shipped: use-of-color, error-identification, headings-and-labels, on-input-body (landed as reason-text tiers on on-input-change per CLAUDE.md §1), `tool-audit` meta-tool. Remaining finder + finder tests live in Track R.
