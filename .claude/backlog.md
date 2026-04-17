# ra11y backlog

The `/continue` skill reads this file and dispatches work to specialist subagents. Each item should be small enough that one specialist can finish it in under 20 minutes. When an item would produce more work, split it in place before dispatching.

Legend: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked (reason in comment)

## Ship state

- **v0.1.0 — ready to tag.** Code-complete: 54 rules, 4 standards, 9 formatters, 10 MCP tools, 4 reports, CLI wired, release workflow configured. Remaining work is the demo + the tag + publish (Track D).
- **v0.2.0 — in flight.** MCP hardening (Track M), review-candidate coverage + focus-ring cross-ref (Track R), real-world fixture corpus (Track F). Target: 3–4 weeks post-0.1.0.
- **v0.3.0+ — staged, not started.** MCP sampling (Track S), ecosystem integrations + public benchmark (Track E). Phase 20 work is deliberately deferred until after 0.2.0 ships and user feedback tells us which sampling-backed tool matters most. See ADR 0005 for the sampling architecture.

## Dispatch model (parallel tracks, not sequential phases)

Tracks below are independent. `/continue` picks the next open item from each of up to 3 active tracks per turn and dispatches them in parallel (details in `.claude/skills/continue/SKILL.md`). Within a track, items run in order — some tracks have sequencing; cross-track work is always parallelizable.

Active tracks: **D** (docs/release) · **M** (MCP hardening) · **R** (rules + review candidates) · **F** (real-world fixtures) · **S** (MCP sampling) · **E** (ecosystem/evals) · **Q** (agent-consumer feedback).

Staged tracks: (none). Tracks S and E were promoted on 2026-04-17 after the user directed "go all the way without releasing until finalized" — M/R/F are complete, so the remaining pre-release work spans S and E. ADR 0005 §Follow-up work still applies to the speculative tool choices inside S; foundation items (sampling.ts, capability, prompt library, KB docs) are safe to build.

Track Q was added on 2026-04-17 in response to a 10-agent independent eval brief — MCP shape honesty + silent-failure elimination, all derived from real consumer pain on an external React codebase.

---

## Track D — Docs & release

Owner: `release-captain` + `doc-writer`. Blocks nothing; can ship independently.

### v0.1.0

- [ ] asciinema demo recording embedded in README
- [ ] Version bump confirmation (package.json already reads `0.1.0`; verify + commit a release-prep chore if anything else drifts)
- [ ] Tag `v0.1.0` and push (triggers `release.yml` → npm publish with provenance)
- [ ] GitHub release with changelog excerpt

### v0.2.0

- [x] Release notes for 0.2.0 — drafted under `## [Unreleased]` in CHANGELOG.md (1eabf39). Covers M/R/F/S/E deltas; dated header waits for release.
- [ ] Migration notes if any track introduces a breaking MCP shape (expected: none; `suggest_fix` shape change called out in CHANGELOG Changed section — draft migration note if needed at release time)

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
- [~] **P1-CFG** Superseded by **P0-F** (6a50836). A bogus `cwd` now returns a structured `cwd-not-found` error envelope rather than a successful-looking empty scan, so the schema-presence-check failure mode no longer applies — the envelope shape is categorically different from the success shape, and agents branch on `isError: true` + `code`.
- [ ] **P1-OVF** Pagination / response-size guard on `scan_project`. R2 observed a single-line response > 580 KB on a `/tmp` scan that exceeded MCP's token cap. Add `limit` (max findings) + `continuationToken` + a top-level `truncated: true` flag when the result is capped. Before truncation: the existing structured-response shape; after: same shape with `truncated` and the token. Single-observer in R2 but high-severity (silent overflow on monorepos).
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
