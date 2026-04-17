# ra11y backlog

The `/continue` skill reads this file and dispatches work to specialist subagents. Each item should be small enough that one specialist can finish it in under 20 minutes. When an item would produce more work, split it in place before dispatching.

Legend: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked (reason in comment)

## Ship state

- **v0.1.0 — ready to tag.** Code-complete: 54 rules, 4 standards, 9 formatters, 10 MCP tools, 4 reports, CLI wired, release workflow configured. Remaining work is the demo + the tag + publish (Track D).
- **v0.2.0 — in flight.** MCP hardening (Track M), review-candidate coverage + focus-ring cross-ref (Track R), real-world fixture corpus (Track F). Target: 3–4 weeks post-0.1.0.
- **v0.3.0+ — staged, not started.** MCP sampling (Track S), ecosystem integrations + public benchmark (Track E). Phase 20 work is deliberately deferred until after 0.2.0 ships and user feedback tells us which sampling-backed tool matters most. See ADR 0005 for the sampling architecture.

## Dispatch model (parallel tracks, not sequential phases)

Tracks below are independent. `/continue` picks the next open item from each of up to 3 active tracks per turn and dispatches them in parallel (details in `.claude/skills/continue/SKILL.md`). Within a track, items run in order — some tracks have sequencing; cross-track work is always parallelizable.

Active tracks: **D** (docs/release) · **M** (MCP hardening) · **R** (rules + review candidates) · **F** (real-world fixtures).
Staged tracks: **S** (MCP sampling) · **E** (ecosystem/evals). Items here stay untouched until ship state moves.

---

## Track D — Docs & release

Owner: `release-captain` + `doc-writer`. Blocks nothing; can ship independently.

### v0.1.0

- [ ] asciinema demo recording embedded in README
- [ ] Version bump confirmation (package.json already reads `0.1.0`; verify + commit a release-prep chore if anything else drifts)
- [ ] Tag `v0.1.0` and push (triggers `release.yml` → npm publish with provenance)
- [ ] GitHub release with changelog excerpt

### v0.2.0

- [ ] Release notes for 0.2.0 (M + R + F deltas)
- [ ] Migration notes if any track introduces a breaking MCP shape (expected: none)

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
- [ ] Extend `fixture-curator` subagent definition in `.claude/agents/fixture-curator.md` with the new `tests/fixtures/real-world/` conventions once the ADR lands.
- [ ] `real-world/tsx-generics/` — Pick<T,K>, ForwardRefRenderFunction<...>, generic function calls. Guards commit `2968d87`. Assertion: zero-parse-errors.
- [x] `real-world/spa-shell-vite/` — Vite-style `<div id="root">` + module script index.html. Guards `bc3aae4`. Assertion: wcag22:2.4.5 candidate reason includes "SPA index shell".
- [x] `real-world/tailwind-coverage/` — 60 JSX files with utility-class strings, zero CSS. Guards `4700a13`. Assertion: analysisCoverage.hints includes "Tailwind usage detected" + `additionalPaths: ["dist/assets"]`.
- [x] `real-world/logotype-annotation/` — `<img className="site-logo" alt="Acme">`. Guards `71b9954`. Assertions: wcag22:1.4.5 reason contains "logotype exemption"; wcag22:1.4.9 reason does NOT.
- [x] `real-world/timing-role-hints/` — useDebouncedCallback, authManager, telemetryService. Guards `3ada44a`. Assertion: wcag22:2.2.1 reason contains "likely not user-facing" (updated live: now guards "session-keepalive / debounce / animation" + reverted-enrichment absent).
- [x] `real-world/template-directives/` — Jinja `{% extends %}` + `{{ x }}`. Guards `a554d27`. Assertion: analysisCoverage.templateDirectiveHandling includes "parsed as literal".
- [x] `real-world/opaque-components-top/` — 10 PascalCase components with varied call-site counts. Guards `0ee28e1`. Assertion: analysisCoverage.opaqueCustomComponentsTop is a ranked list of length ≤5.
- [x] `real-world/suppression-reason-slot/` — pragma with `: reason` syntax. Guards `d820186`. Assertion: meta.suppressions contains an entry with `reason: "..."`.
- [ ] `real-world/autodetect-attribution/` — autoDetectWrappers scan; assert sessionNativeWrappers is absent (regression on `6821b77`).
- [ ] Policy change: update `CLAUDE.md` §7 and §17 — when fixing a real-world bug (not adding a new rule from spec), add a sanitized repro to `tests/fixtures/real-world/<case>/` FIRST. Unit tests are for invariants; behavior-rehearsals migrate to real-world fixtures on touch.

---

## Track S — MCP sampling (STAGED; defer until v0.3.0+)

Owner: `parser-author` + main session. **Do not start** until v0.2.0 ships and user feedback selects 1–2 high-value tools. Shipping all four speculatively wastes the 0.2 budget on unvalidated surface. See `docs/adr/0005-in-house-mcp-server.md` §Follow-up work.

### v0.3.0+ (candidates)

- [ ] `src/mcp/sampling.ts` — client helper calling `sampling/createMessage` on the host with timeout + max-tokens budget
- [ ] Server capability declaration: advertise `sampling` in initialize; graceful fallback to "return the prompt for the agent to run" on hosts that decline
- [ ] `src/mcp/tool-resolve-component.ts` — verifies PascalCase wrappers via host-sampled source read
- [ ] `src/mcp/tool-verdict-candidate.ts` — pass/fail with reasoning for a review candidate + its `reviewPrompt`
- [ ] `src/mcp/tool-draft-vpat-narrative.ts` — drafts the VPAT "Remarks and explanations" cell per criterion
- [ ] `src/mcp/tool-triage-findings.ts` — pure (no sampling) triage that labels each finding — the input for the LLM-backed tools above
- [ ] Prompt library under `src/mcp/prompts/` as pure strings + variable substitution (checksum registry for version-pinning)
- [ ] `tests/unit/mcp/sampling.test.ts` with a fake host recording sampling requests
- [ ] `tests/integration/mcp-sampling.test.ts` with a scripted host adapter
- [ ] Docs: `docs/kb/architecture/mcp-sampling.md`, `docs/mcp/prompts.md`
- [ ] `/audit` MCP prompt template: end-to-end workflow (scan → triage → verdict → VPAT draft) exposed as a host-driven prompt

---

## Track E — Ecosystem & public benchmark (STAGED; v0.3.0+)

Owner: `doc-writer` + main session. Items here expand the agent-host matrix and establish the public quality story — valuable but not release-gating.

### v0.3.0+

- [ ] Prompt evals harness in `tests/evals/` — measure each sampling prompt's accuracy against a labeled fixture set; CI-gated against a scripted host (no real LLM calls). Paired with Track S.
- [ ] `examples/ra11y-in-claude-code/` — reference `.mcp.json` + sample `CLAUDE.md` section showing triage → verdict → draft-VPAT inside Claude Code
- [ ] `examples/ra11y-in-cursor/` — Cursor-specific wiring once their MCP host ships sampling
- [ ] VS Code extension skeleton under `integrations/vscode/` — wraps the MCP server for IDE-native findings
- [ ] Public benchmark: `benchmarks/a11y-tool-comparison.md` — accuracy, false-positive rate, agent-workflow completion rate against a labeled fixture set, published with each release

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
