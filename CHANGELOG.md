# Changelog

All notable changes to ra11y are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) — see `CLAUDE.md` section 14 for the ra11y-specific semver policy.

## [Unreleased]

Migration guide (v0.2 → v1.0): [`docs/migrations/0.2-to-1.0.md`](./docs/migrations/0.2-to-1.0.md)

### Added

#### Configuration

- **`preset: "storybook"` config option** — opt-in framework preset that pairs two behaviors: `*.stories.{tsx,jsx,ts,js}` / `*.story.{…}` / `stories/**` files reach the scanner (they're excluded by default), and Storybook primitives (`Meta`, `StoryObj`, `StoryFn`, `Story`) render transparent in the opaque-component telemetry when they appear inside a story file. Findings on the underlying JSX still surface — the preset removes the wrapper-noise inflation, not the signal. `scan_project` responses carry a `storybook_preset_active` warning code so the agent can tell non-default behavior engaged. Invalid preset values are rejected at load time with a stderr warning; unknown or unsupplied values keep the default behavior. Follow-up (deferred): StoryObj `args` binding onto the underlying component's JSX.

#### MCP server — new tools

- **`scan_diff` tool** — per-scan baseline delta. Returns only violations that are new since the baseline snapshot, giving agents a clean "what regressed?" view without reprocessing unchanged findings.
- **`baseline` tool** — create/check/update baseline from within an MCP session, mirroring the CLI `--baseline` modes. Uses the same SHA-1 fingerprinting (line-number-independent) as the CLI baseline.
- **`apply_fix` tool** — write-gated fix-verify loop. Accepts a structured fix instruction, applies it to the source file, and re-scans to confirm the violation is resolved. Disabled by default; the host must set the session-level `allowWrite: true` flag to enable any write to disk.
- **`audit` meta-tool** — one-call shorthand that runs `scan`, `coverage`, and `checklist` and merges the results into a single response. Intended for "cold start" onboarding where the agent needs the full picture in a single round trip.
- **`bootstrap` meta-tool** — single-call onboarding that composes `detect_native_wrappers`, `propose_config`, `scan_project`, and (opt-in) `baseline create`, plus a copy-pasteable GitHub Actions snippet wiring `baseline check` into CI. Read-only by default; `writeBaseline: true` grandfathers current violations into `.ra11y-baseline.json`. Partial-failure tolerant via `Promise.allSettled` — a degraded sub-leg surfaces as a `bootstrap_<leg>_failed` warning code without sinking the response.
- **`autoDetectWrappers` and `additionalPaths`** on `scan` — `autoDetectWrappers: true` runs the wrapper detector inline and registers found components for the scan; `additionalPaths` accepts an explicit list of built CSS/HTML files to include alongside the discovered source tree.

#### MCP server — prompt templates

- **`ra11y/triage`** — frames a scan result as a prioritized triage agenda for the calling agent.
- **`ra11y/fix`** — wraps a single violation with fix-path guidance and a verification checklist.
- **`ra11y/audit`** — produces a project-level WCAG readiness narrative suitable for a technical lead.
- **`ra11y/vpat-narrative`** — drafts per-criterion VPAT remarks from checklist output.

All four prompts are served via `prompts/list` and `prompts/get`. See [`docs/mcp/prompts.md`](./docs/mcp/prompts.md).

#### MCP server — prompt checksum registry

- `src/mcp/prompts/checksums.ts` computes a stable 16-hex SHA over the canonical serialization of each prompt template. The checksum surfaces as `_meta.checksum` on both `prompts/list` and `prompts/get` responses so agents can pin to a specific prompt version and detect drift without re-reading the full content. (Commits: c141440, 08e5ba0, 9cfc547.)

#### MCP server — capabilities and resources

- **`logging` capability** — server declares `logging` in the initialize response; hosts that opt in receive structured scan telemetry (start/finish events) via `notifications/message`. Level controlled at runtime via `logging/setLevel`.
- **`completions` capability** — `completion/complete` dispatch enables argument autocompletion for prompt names and resource URIs.
- **`roots` capability** — server declares `roots` and reads `params.roots` from the `initialize` call (and from `notifications/roots/list_changed` events) to set the default scan root without requiring the agent to pass an explicit path.
- **`resources/list` and `resources/read`** — the full `docs/kb/**` tree is exposed as MCP resources, letting agents retrieve architecture docs, rule entries, and gotchas directly via URI without a file read.

#### MCP server — structured errors

- Error responses across `scan`, `scan_diff`, `scan_file`, `apply_fix`, and `audit` now carry a `structuredContent` envelope with machine-consumable fields (`code`, `message`, optional `details` and `remediation`). Agents can branch on `code` without parsing prose. (Commit: 19333a1.)

#### MCP server — bidirectional outbound rail and sampling

- `src/mcp/outbound.ts` — JSON-RPC rail that lets the server issue requests to the host, not just receive them.
- `src/mcp/session.ts` — `hostCapabilities` slot captures what the host declared at initialize; `sendRequest` sends a request down the outbound rail.
- `src/mcp/sampling.ts` — `sample()` helper that calls `sampling/createMessage` on the host. Raises `SamplingNotSupportedError` when the host did not declare the sampling capability; raises `SamplingTransportUnavailableError` on transport failure. Default timeout: 60 s. (Commits: c141440, 08e5ba0.)

#### MCP server — additional surface improvements

- Checklist items now carry the WCAG principle name (Perceivable / Operable / Understandable / Robust) alongside the criterion ID, removing a lookup step for agents writing narrative output.
- `suggest_fix` now returns structured `fixPaths` (primary + alternatives) rather than a single prose string, matching the shape `apply_fix` expects.
- `scan_project` surfaces `wrapper provenance` — each active native wrapper is annotated with whether it came from `ra11y.config`, `autoDetectWrappers`, or a prior `configure` call.
- `scan_project` response includes Tailwind-aware CSS coverage hints when Tailwind utilities are detected in the scanned files.
- `scan_project` returns a ranked `top-N opaque components` list in `verboseMeta`, ordered by interactive call-site count.
- `coverage` tool: `manualUntargeted` list is gated behind `showUntargeted: true`; the count is always present. Default-off prevents agents from receiving a large flat list on every call.
- `checklist` summary leads with a plain-English headline before the structured counts.
- Per-finding suppression placement guidance: each violation now includes a `suppressionHint` field with the exact pragma to silence it and where to place it (before the element vs. at the file top).
- `aria/hidden-focus` emits a mechanical `aria-hidden → inert` edit alongside the prose suggestion when the source is JSX.
- Suppress with reason: inline disable pragmas accept a reason annotation after `:` or `--` (e.g. `ra11y-disable wcag22:1.4.5 -- confirmed logotype`). The reason is captured in `meta.suppressions` for audit output.

#### Engine

- **`afterProject` hook for finders** — `Finder` objects may now implement `afterProject({ files, enabledStandards })` to emit cross-file review candidates after all individual-file passes are complete. The scanner collects per-file candidates first, then invokes `afterProject` on all finders and appends surviving candidates. Required by the consistent-navigation finder (WCAG 3.2.3) and available for future cross-file rules. (Commit: 1c20455.)
- **Criterion IDs in inline disable pragmas** — `ra11y-disable wcag22:2.4.5` now works alongside rule IDs like `ra11y-disable keyboard/handler-missing`. The candidate runner checks both the full criterion ID and the wildcard `*`.
- **Conformance level gate** — rules and finders are now skipped end-to-end when their criterion level exceeds the active scan level, eliminating wasted parse work. (Commit: 347e59e.)
- **Inherited findings at wrapper call sites** — new `Violation.sourceOfFinding?: { filePath, line, column? }` and a fourth `Violation.confidence` value `"inherited"` propagate findings from a wrapper DEFINITION file out to every call site of that wrapper in the scanned files. The post-scan synthesizer (`src/engine/inherited-findings.ts`) reads `LoadedConfig.nativeWrapperElements` as the source of truth (per ADR 0012), skips `wrapper/drift` and already-inherited findings to prevent chain noise, and emits one inherited Violation per call site with `confidence: "inherited"` + `sourceOfFinding` pointing at the definition. Bounded by the parsed files — no transitive import-graph crawl. Forwarders (JSON, SARIF, agent response) pass the fields through; SARIF maps `sourceOfFinding` to `Result.relatedLocations[0]` with role `"origin"` and surfaces `confidence` under `properties.confidence`.

#### Review finders (new since v0.1.0)

Finders produce grounded manual-review candidates (file + line + reason); they do not emit automated violations. All finders below operate in the `afterProject` phase or per-file phase and respect the active standard + level.

- `use-of-color` — wcag22:1.4.1 — flags color-only information signals without a secondary cue.
- `images-of-text` — wcag22:1.4.5, 1.4.9 — surfaces `<img>` and CSS background-image patterns that may present text as raster graphics; 1.4.9 candidates are annotated separately.
- `media-variants` — wcag22:1.2.1 through 1.2.6 — flags `<video>` and `<audio>` elements, noting which captions/descriptions/transcripts are statically detectable.
- `timing` — wcag22:2.2.1, 2.2.2, 2.2.3, 2.2.4, 2.2.6 — surfaces `setTimeout`/`setInterval` call sites with the literal duration in the reason text.
- `pointer-input` — wcag22:2.5.1, 2.5.6 — flags touch/pointer event handlers that may lack a keyboard or single-pointer alternative.
- `motion-actuation` — wcag22:2.5.4 — flags `devicemotion`/`deviceorientation` event listeners.
- `identify-purpose` — wcag22:1.3.6 — surfaces landmark and widget candidates where purpose could be made programmatic.
- `section-headings` — wcag22:2.4.10 — flags long sections without intervening headings.
- `multiple-ways` — wcag22:2.4.5 — annotates SPA index-shell routes that have no secondary navigation path.
- `error-suggestion` — wcag22:3.3.3 — surfaces form validation handlers without visible suggestion text.
- `error-prevention` — wcag22:3.3.4 — flags form submissions that are irreversible without a confirmation step.
- `redundant-entry` — wcag22:3.3.7 — flags multi-step forms that re-ask for data the session already has.
- `error-identification` — wcag22:3.3.1 — surfaces inline error message patterns.
- `captcha` — wcag22:3.3.8, 3.3.9 — flags CAPTCHA-shaped UI patterns and suggests an accessible alternative.
- `on-input-change` — wcag22:3.2.1, 3.2.2 — surfaces focus/input change handlers that trigger context changes; annotated with confidence tier based on detectable handler body shape.
- `headings-and-labels` — wcag22:2.4.6 — flags headings and labels that are present but not descriptive.
- `consistent-navigation` — wcag22:3.2.3 — cross-file finder; detects navigation components that differ in order or structure across route files. Uses the `afterProject` hook.
- `sensory-characteristics`, `meaningful-sequence`, `no-keyboard-trap`, `media-alternatives` — additional finders covering remaining WCAG A criteria. See `src/review/finders/` for the full inventory.

**Tailwind focus-ring cross-reference for `focus/outline-visible`**: when a CSS rule suppresses the outline and the same element carries a `focus-visible:ring-*`, `focus-visible:outline-*`, or `focus-visible:shadow-*` Tailwind utility class, the finding is automatically resolved to info-level. Resolution is deterministic — literal class-token prefix match only; no fuzzy inference. (Commit: ddaada4.)

#### Rules

- `aria/hidden-focus` now emits a structured `fixPaths` object (primary: change to `inert`; alternative: remove element from tab order before hiding) in addition to the prose suggestion. (Commit: 5a2f244.)
- `label-in-name` detects the interleaved-expansion pattern (visible text split across nodes with ARIA expansion in between) and normalizes whitespace before comparison. (Commit: ba80a62.)
- Six rules — `button-name`, `fieldset-legend`, `labels-required`, `non-empty-label`, `empty-heading`, `list-structure` — now use `hasSpreadProps` to detect JSX components with unknown spread props, avoiding false positives on primitives that receive their label via a spread.

#### Parser

- TSX parser correctly disambiguates TypeScript generic syntax (`<T>`, `<T extends U>`) from JSX open tags. Previously, a generic in an expression position would corrupt the following parse. (Commit: 2f00c1f via fix commit 2968d87.)

#### Configuration

- Inline disable pragmas accept a reason annotation: `ra11y-disable wcag22:1.4.5 -- confirmed logotype` or `ra11y-disable focus/outline-visible: reviewed, Tailwind provides indicator`. The reason text is captured in the parsed suppression record and surfaced in `meta.suppressions` for audit tooling.

#### Scripts and developer tooling

- **`scripts/scaffold-rule.ts`** — generates a complete rule skeleton: source file, unit test file, good/bad fixture directories, and an alphabetically-inserted registry entry. The output typechecks out of the box. Run: `bun scripts/scaffold-rule.ts <domain>/<slug> --satisfies wcag22:X.Y.Z`. (Commit: f1226ed.)
- **400-LOC reviewable-size cap** in `scripts/check-commit.ts` — staged diffs (excluding generated KB, fixtures, and lockfiles) exceeding 400 net lines cause `bun run verify:precommit` to fail. The `chore(kb):` prefix is exempt. (Commit: c9016c4.)

#### Real-world fixture corpus

- `tests/integration/real-world-fixtures.test.ts` — harness that discovers every subdirectory under `tests/fixtures/real-world/`, loads its `assertions.ts`, and verifies the scanner output matches the declared invariants. Fixtures survive internal API refactors that would break unit tests tied to AST shapes.
- `tests/fixtures/real-world/runner.ts` — shared fixture runner with typed `assertions.ts` contract.
- Sanitized fixtures (see `tests/fixtures/real-world/` for the full source trees):
  - `tsx-generics` — generics-in-JSX parse regression
  - `spa-shell-vite` — WCAG 2.4.5 multiple-ways on a Vite SPA shell
  - `tailwind-coverage` — CSS coverage meta hints with Tailwind classes
  - `logotype-annotation` — WCAG 1.4.5 / 1.4.9 logotype candidate + reason text
  - `timing-role-hints` — WCAG 2.2.1 timing candidates with filename role hints
  - `template-directives` — `template-directive` meta-field telemetry
  - `opaque-components-top` — opaque-component ranking cap
  - `suppression-reason-slot` — reason annotation on inline disable pragmas
  - `autodetect-attribution` — wrapper provenance from `autoDetectWrappers`

ADR: [`docs/adr/0006-real-world-fixture-harness.md`](./docs/adr/0006-real-world-fixture-harness.md).

#### Prompt evaluations

- `tests/evals/` — scripted-host harness that replays prompt templates against a deterministic host stub and asserts on the rendered output. Each eval declares the arguments, the expected prompt messages, and structural invariants. See `tests/evals/README.md` for the fixture contract.

#### VS Code extension scaffold

- `integrations/vscode/` — extension skeleton that wraps the ra11y MCP server. Isolated toolchain; no runtime dependency on `@ra11y/core` in the extension host process. The extension launches the MCP server as a subprocess and registers it with the VS Code language server client.

#### Docs and knowledge base

- [`docs/mcp/prompts.md`](./docs/mcp/prompts.md) — prompt library user guide: available prompts, argument reference, checksum pinning, and how to call each prompt from an agent.
- [`docs/kb/architecture/mcp-sampling.md`](./docs/kb/architecture/mcp-sampling.md) — architecture entry for the bidirectional outbound rail and sampling client: sequence diagram, error types, and agent guidance.
- [`benchmarks/a11y-tool-comparison.md`](./benchmarks/a11y-tool-comparison.md) — scaffolded benchmark comparison against reference tools (numeric values to be filled from a dedicated benchmarking pass).
- ADR 0006 — `docs/adr/0006-real-world-fixture-harness.md` — records the decision to maintain a real-world sanitized fixture corpus alongside unit tests, the fixture contract, and the naming conventions.
- CLAUDE.md §7a — "Bug-fix workflow — real-world fixture first" — codifies the fixture-before-fix cadence for regression bugs.
- CLAUDE.md §17 — new gotcha entries: numeric-threshold heuristics as suppression, ambiguous-field-shape antipattern (`newText: ""`, `snippet: ""`), behavior-rehearsal unit tests as the wrong vehicle for real-world bugs, hardcoded inventory counts in docs.

### Changed

- **Breaking (MCP response shape):** `checklist.summary.automatedCoverage` trimmed to a one-field gloss `{ standardId, automatedCriteriaPassRate }` per ADR 0010. The previous per-standard block (`criteriaAutomatable`, `criteriaAutomatablePassing`) is canonical on `coverage` only — agents reading the full shape from `checklist` must migrate to a `coverage` call, or read the headline pass-rate from the surviving gloss. `coverage` and `checklist` now cross-point via `nextStep` + `nextStepStructured` pairs so the agent has a single call for "what next?".
- **Breaking (MCP response shape):** collapsed the three wrapper-provenance fields on MCP tool responses — `activeNativeWrappers: string[]`, `activeNativeWrappersBySource: { fromConfig?, fromSession?, fromAutoDetect? }`, and `sessionNativeWrappers: string[]` — into a single tagged list `activeNativeWrappers: Array<{ name: string; source: "config" | "autoDetect" | "session"; confirmed?: boolean }>`. The `confirmed` flag (folded in from P1-F) is populated only for `source: "autoDetect"` entries: `true` when the one-hop AST probe matched a native interactive root, `false` when the scanner considered the name but did not trust it. Omitted for `"config"` and `"session"` per the honest-shape doctrine — those are author-supplied. The former `sessionNativeWrappers` list is now readable by filtering entries where `source === "session"`; the `sessionOverridesNote` prose is preserved. Affects `scan`, `scan_project`, `scan_file`, `scan_diff`, `list_suppressions`, and any other tool that emits wrapper meta. Callers reading the removed fields see `undefined` and must migrate.
- `scan` tool: `autoDetectWrappers` and `additionalPaths` parameters added (previously available only via CLI). Wrapper provenance is now annotated per-entry in `activeNativeWrappers`.
- `suggest_fix`: response shape changed from `{ suggestion: string }` to `{ fixPaths: { primary: FixPath, alternatives: FixPath[] } }`. Agents relying on the prose-only shape must update to read `fixPaths`.
- `checklist`: `reviewNeeded` field renamed to a structured array with `priority` and `wcagPrinciple` per item.
- `coverage`: `manualUntargeted` is no longer returned by default; `manualUntargetedCount` is always present. Pass `showUntargeted: true` to restore the full list.
- Canonical untargeted-criteria count is now `untargetedCriteria` across all tools: `scan_project` (on `plan`), `checklist` (on `summary`), `coverage` (per-standard). Previous names `untargeted` (checklist) and `manualUntargetedCount` (coverage) removed — callers reading them will see `undefined`. Gated list emitted as `untargetedCriteriaList` when requested.
- `/continue` skill now fans out up to three parallel agents per turn across active tracks (D/M/R/F). Serial dispatch is no longer used.
- Pre-commit hook scoped to staged files only; previously it ran on the full working tree, causing false failures on unstaged changes.
- `list-structure` rule: bare `<li>` outside a list container is now `info` severity (down from `warning`). The element is still surfaced; the level reflects that the most common cause is a template partial that renders correctly at runtime.

### Fixed

- `scan_project`: manual-review count was inconsistent between `scan`, `checklist`, and `coverage` when the active level filter excluded some finders. All three surfaces now use the same filtered count. (Commit: df26f17.)
- `scan_project`: empty `snippet` field was emitted alongside a populated `sourceContext` on some `suggest_fix` paths, sending an ambiguous signal to agents. The field is now conditionally spread and omitted when empty. (Commit: 406a28f.)
- `checklist`: empty-candidate items (criteria with no grounded candidates) were mixed into the primary list. They are now separated and only included when explicitly requested.
- Engine: conformance level filter was not applied to finders, allowing AA-only finders to fire during A-only scans. (Commit: 347e59e.)
- Engine: `.js` and `.ts` files were excluded from the JSX rule filter even when they contained JSX syntax. (Commit: 2558bea.)
- Engine: inline `ra11y-disable` was not applied to review candidates, only to automated violations. (Commit: 1beda8a.)
- Review: `3.2.1`/`3.2.2` finders were emitting candidates for all focus/input handlers regardless of whether the handler visibly changed context. They now gate on detectable context-change signals. (Commit: 9cac116.)
- Review: `use-of-color` finder was treating `aria-hidden` colored elements as active color signals; they are now excluded.
- Review: `1.3.3` finder was matching polysemous words ("view", "press") in noun phrases that carry no directional instruction. Instructional context is now required.
- Review: page-set finders (multiple-ways, skip-link) were emitting duplicate candidates across root layouts in Next.js / Remix app directories. Deduplication is now applied after `afterProject`. (Commit: e59af58.)
- Review: timing finder was emitting filename-based role hints in user-facing reason text; those are removed. Filename role is used only as an internal confidence signal. (Commit: adb3976.)
- Rules: `nested-interactive` was flagging the native `<details>`/`<summary>` nesting pattern, which is spec-correct. Both elements are now allowlisted. (Commits: 0e7a2ce, 99e2616.)
- Rules: `button-name`, `fieldset-legend`, `labels-required`, `non-empty-label`, `empty-heading` were emitting false positives when the element carried a JSX spread (`{...props}`). `hasSpreadProps` detection now suppresses the finding with an info-level note.
- Parser: TSX generic disambiguation — a bare `<T>` in an expression position was parsed as a JSX open tag, corrupting subsequent parse state. (Commit: 2968d87.)
- MCP wrapper detection: usage scan for `autoDetectWrappers` was not reaching paths in the default-excluded list, causing wrappers used only in test or stories directories to be missed. Detection now widens to include those paths. (Commit: 18ec904.)

## [0.1.0] — 2026-04-13

This is the first public release of ra11y: a zero-dependency, multi-standard accessibility scanner for JSX/TSX, HTML, and CSS. It covers WCAG 2.2 A+AA and WCAG 2.1 A+AA with 49 automated rules, ships four conformance standards, and publishes with npm provenance.

### Added

#### Architecture
- Three-layer architecture: standards → criteria → rules, glued by a reciprocal `equivalentTo` closure so one rule can cite every conformance framework simultaneously.
- Engine: scanner, rule-runner, context-builder, AST helpers, standard-filter, and three registries (standards, criteria, rules). ~500 lines end-to-end.
- Zero-runtime-dependency invariant enforced by `scripts/check-zero-deps.ts` — `dependencies: {}` in `package.json`.
- Network-isolation invariant enforced by `scripts/check-network-isolation.ts` — `src/` cannot reference `fetch`, `node:http`, `node:https`, `node:net`, or `node:dns`.
- File/function/nesting-depth guard enforced by `scripts/check-limits.ts` (500/120/5).
- Import-cycle guard enforced by `scripts/check-cycles.ts` (Tarjan SCC).
- Build pipeline via `scripts/build.ts` (Bun.build for ESM JS + tsc for .d.ts).
- Benchmark suite enforcing CLAUDE.md §13 budgets. Current headroom: 1000 files in ~170ms (budget: 3000ms), cold start ~33ms (budget: 200ms).

#### Standards (4 built-in)
- **WCAG 2.2** — all 87 success criteria with automatability classification.
- **WCAG 2.1** — 78 criteria with `equivalentTo` links back to WCAG 2.2.
- **Section 508 (2017 refresh)** — 38 criteria equivalent to WCAG 2.0 A+AA.
- **EN 301 549 v3.2.1** — 50 criteria equivalent to WCAG 2.1 A+AA.

#### Rules (49 built-in)

**ARIA**
- `aria/hidden-focus` (wcag22:4.1.2) — flags `aria-hidden` on focusable elements
- `aria/invalid-role` (wcag22:4.1.2) — flags roles outside the WAI-ARIA 1.2 dictionary, suggests the nearest valid role via edit-distance
- `aria/live-region-valid` (wcag22:4.1.3) — flags invalid `aria-live` values and conflicting politeness attributes
- `aria/required-attrs` (wcag22:4.1.2) — flags ARIA roles missing required state attributes
- `aria/valid-attr` (wcag22:4.1.2) — flags `aria-*` attributes not in the WAI-ARIA 1.2 dictionary

**Contrast**
- `contrast/enhanced` (wcag22:1.4.6) — WCAG AAA enhanced contrast check
- `contrast/minimum` (wcag22:1.4.3) — WCAG AA contrast ratio check with large-text heuristic
- `contrast/non-text` (wcag22:1.4.11) — non-text contrast check for UI components and graphical objects

**Document**
- `document/iframe-title` (wcag22:4.1.2, 2.4.1) — flags iframes without a title or aria-label
- `document/lang-attribute` (wcag22:3.1.1) — flags HTML root without a lang attribute
- `document/lang-on-parts` (wcag22:3.1.2) — flags content in a different language without a lang override
- `document/meta-refresh` (wcag22:2.2.1, 2.2.4, 3.2.5) — flags `<meta http-equiv=refresh>` auto-redirects
- `document/page-titled` (wcag22:2.4.2) — flags documents without a meaningful `<title>`
- `document/viewport-zoom` (wcag22:1.4.4, 1.4.10) — flags `<meta viewport>` that disables pinch-to-zoom

**Focus**
- `focus/not-obscured` (wcag22:2.4.11) — flags focused components fully hidden by sticky headers or overlays
- `focus/outline-visible` (wcag22:2.4.7, 2.4.11) — flags elements where focus outline is suppressed without a replacement
- `focus/tabindex-positive` (wcag22:2.4.3) — flags positive tabindex values

**Forms**
- `forms/autocomplete-missing` (wcag22:1.3.5) — flags personal-info inputs without an autocomplete token
- `forms/fieldset-legend` (wcag22:1.3.1, 3.3.2) — flags fieldset without a legend
- `forms/label-for-id-mismatch` (wcag22:1.3.1) — flags `label[for=X]` where no element has `id=X`
- `forms/labels-required` (wcag22:1.3.1, 3.3.2, 4.1.2) — flags form controls without an accessible label
- `forms/non-empty-label` (wcag22:1.3.1, 3.3.2) — flags label elements with no visible text content

**Keyboard**
- `keyboard/accesskey-duplicate` (wcag22:2.1.1) — flags multiple elements sharing an accesskey value
- `keyboard/character-shortcuts` (wcag22:2.1.4) — flags single-character keyboard shortcuts without a remapping mechanism
- `keyboard/handler-missing` (wcag22:2.1.1) — flags clickable elements without a keyboard handler

**Layout**
- `layout/orientation-lock` (wcag22:1.3.4) — flags CSS that locks display to a single orientation
- `layout/reflow-hardcoded-width` (wcag22:1.4.10) — flags hardcoded pixel widths that break reflow at 320px
- `layout/text-spacing` (wcag22:1.4.12) — flags CSS declarations that would override text-spacing overrides

**Media**
- `media/alt-text-missing` (wcag22:1.1.1) — flags images without a text alternative
- `media/autoplay-sound` (wcag22:1.4.2) — flags audio/video autoplay without muted or controls
- `media/video-captions-missing` (wcag22:1.2.2) — flags `<video>` without a `<track kind="captions">`

**Motion**
- `motion/pause-stop-hide` (wcag22:2.2.2) — flags animated content without a mechanism to pause, stop, or hide

**Navigation**
- `navigation/link-descriptive-text` (wcag22:2.4.4) — flags link text like "click here" or "read more"
- `navigation/link-no-href` (wcag22:2.1.1, 4.1.2) — flags `<a onClick>` without an href
- `navigation/skip-link` (wcag22:2.4.1) — flags pages without a skip-navigation link

**Parsing**
- `parsing/duplicate-id` (wcag22:4.1.1) — flags duplicate `id` attributes in a document
- `parsing/html-has-lang` (wcag22:3.1.2) — flags syntactically invalid BCP 47 lang values

**Pointer**
- `pointer/cancellation` (wcag22:2.5.3) — flags pointer event handlers that fire on down-event without an up-event abort path
- `pointer/drag-alternative` (wcag22:2.5.7) — flags drag-only interactions without a single-pointer alternative
- `pointer/target-size` (wcag22:2.5.8) — flags interactive targets below the minimum 24×24px target size

**Semantics**
- `semantics/button-name` (wcag22:4.1.2) — flags buttons without an accessible name
- `semantics/empty-heading` (wcag22:1.3.1, 2.4.6) — flags heading elements with no text content
- `semantics/heading-hierarchy` (wcag22:1.3.1) — flags skipped heading levels and missing `<h1>`
- `semantics/label-in-name` (wcag22:2.5.3) — flags components where the accessible name does not contain the visible label text
- `semantics/landmark-main` (wcag22:1.3.6, 2.4.1) — flags pages without a `<main>` landmark
- `semantics/list-structure` (wcag22:1.3.1) — flags `<li>` outside a list container and lists with non-`<li>` children
- `semantics/nested-interactive` (wcag22:4.1.2) — flags interactive elements nested inside other interactive elements
- `semantics/table-headers` (wcag22:1.3.1) — flags data tables without `<th>` header cells

**Tooltip**
- `tooltip/dismissable` (wcag22:1.4.13) — flags tooltips that cannot be dismissed without moving focus or pointer

#### Parsers (zero-dep, in-house)
- TSX/JSX parser — character-driven, preserves PascalCase components, recognizes HTML5 void elements; fuzz-tested.
- HTML parser — HTML5-quirks-aware, explicit progress guarantees to prevent hangs on malformed input; fuzz-tested.
- CSS parser — rules, at-rules, nested `@media`/`@supports`/`@keyframes`, `!important`, comments, function calls.
- Tailwind class extractor — extracts utility class strings and resolves Tailwind tokens to CSS declarations for contrast checking.

#### Output formatters (7)
- `terminal` — colored output, snippet rendering, coverage scorecard.
- `plain` — color-free terminal output for piping.
- `json` — machine-readable ScanResult + ReportData.
- `sarif` — SARIF 2.1.0 for GitHub code scanning integration.
- `junit` — JUnit XML for CI test-result UIs.
- `markdown` — PR-comment-friendly markdown report.
- `agent` — compact format optimized for AI coding agent consumption.

#### MCP server
- In-house Model Context Protocol server for AI agent integration (`ra11y mcp`).
- Tools: `scan_file`, `scan_project`, `get_checklist` — each returning structured violation data, coverage ratios, and next-step hints.
- Git-aware scanning, per-rule severity overrides, `nativeWrappers` allowlist, `.gitignore` respect.

#### CLI
- `scan` command with `--standard`, `--level`, `--exclude`, `--fail-on`, `--format`, `--no-color`, `--verbose`, `--quiet`, `--debug`.
- `--changed` — scan only git-staged files (precommit-friendly).
- `--since <ref>` — scan only files changed since a git ref.
- `--baseline=create|check|update` — baseline mode with sha1 fingerprinting (line-number-independent).
- `--baseline-file=<path>` — override the default `.ra11y-baseline.json` path.
- `--list-rules`, `--list-standards`, `--explain <ruleId>` — introspection commands.
- `--coverage`, `--checklist`, `--vpat`, `--certification` — structured report commands.
- `init` and `doctor` commands for project setup and diagnostics.
- Exit codes: 0 clean, 1 violations, 2 errors, 3 new baseline violations.

#### Configuration
- `ra11y.config.ts`, `.js`, `.mjs`, `.json` — config loader walks up from cwd, stops at `.git`.
- `--config <path>` / `RA11Y_CONFIG` environment variable to override auto-discovery.
- Per-rule severity overrides (`"error" | "warning" | "info" | "off"`).
- Per-directory `overrides` array with last-match-wins precedence.
- `nativeWrappers` allowlist to suppress `keyboard/handler-missing` on custom components.
- Inline disable pragmas: `ra11y-disable-next-line`, `ra11y-disable`/`ra11y-enable`.
- Supported comment styles: `//`, `/* */`, `<!-- -->`, `{/* */}`.

#### Plugin API
- `defineRule()`, `defineStandard()`, `defineFormatter()`, `defineConfig()` — typed identity helpers exported from `@ra11y/core/plugin`.
- Plugin rule example: [`examples/plugin-rule/`](./examples/plugin-rule/).
- Plugin standard example: [`examples/plugin-standard/`](./examples/plugin-standard/).

#### Developer experience
- Precommit git hook: `.githooks/pre-commit` + `.githooks/commit-msg` (installed via `bun run setup`).
- Conventional-commit enforcement via `scripts/check-commit.ts`.
- Claude Code autonomous infrastructure: hooks, 15 subagents, 12 skills, persistent backlog.
- In-house utilities: ANSI coloring, contrast math, args parser, logger, gitignore-style glob matcher, string width.

#### Documentation
- [`docs/getting-started.md`](./docs/getting-started.md) — install, first scan, interpreting output, fixing a violation.
- [`docs/cli.md`](./docs/cli.md) — full flag reference and exit-code table.
- [`docs/configuration.md`](./docs/configuration.md) — config file spec, rule settings, per-directory overrides, precedence.
- [`docs/architecture.md`](./docs/architecture.md) — three-layer model, equivalence closure, rule execution lifecycle, plugin boundaries.
- 5 ADRs covering zero-dep invariant, three-layer model, TypeScript peer, Bun test runner, and in-house MCP server.
- `docs/kb/` agent-retrieval knowledge base: rules, standards, architecture concepts, gotchas, patterns.
