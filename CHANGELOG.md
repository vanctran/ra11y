# Changelog

All notable changes to ra11y are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) — see `CLAUDE.md` section 14 for the ra11y-specific semver policy.

## [Unreleased]

## [1.0.0] - YYYY-MM-DD

Migration guide (v0.2 → v1.0): [`docs/migrations/0.2-to-1.0.md`](./docs/migrations/0.2-to-1.0.md)

Public API stability freeze: [ADR 0019](./docs/adr/0019-v1-api-stability.md)

Deferred decisions: [ADR 0018](./docs/adr/0018-v1-deferred-decisions.md)

### Breaking Changes

#### Exit-code table frozen as semver-major surface

The `ExitCode` enum in `src/cli/exit-codes.ts` is now the canonical source of truth for all CLI exit codes. Changes to these values are a semver-major change.

| Code | Constant | Meaning |
|------|----------|---------|
| `0` | `ExitCode.OK` | Success; no action required |
| `1` | `ExitCode.VIOLATIONS` | Violations found, or command-specific failures |
| `2` | `ExitCode.USER_ERROR` | Invalid arguments, unknown rule/profile, malformed input |
| `3` | `ExitCode.NEW_VIOLATIONS` | `--diff` / `scan_diff` mode only: new violations absent from baseline |

The observable behavior is unchanged from v0.2.0; the freeze makes the table a semver guarantee going forward. CI scripts that branch on `$?` should verify against the table, in particular that exit code 3 is only reachable via `--diff` (CLI) or `scan_diff` (MCP baseline mode). See [`docs/migrations/0.2-to-1.0.md`](./docs/migrations/0.2-to-1.0.md) for step-by-step migration guidance.

### Added

#### MCP server — new tools

- **`scan_diff` tool** — per-scan baseline delta. Returns only violations new since a baseline snapshot; supports `hunksOnly` mode for PR-review agents. (Commit: 2690406, ff21fa5.)
- **`baseline` tool** — create/check/update baseline within an MCP session, mirroring the CLI `--baseline` modes. Uses SHA-1 fingerprinting (line-number-independent). (Commit: aef0e0d.)
- **`apply_fix` tool** — write-gated fix-verify loop. Accepts a structured fix instruction, applies it to the source file, and re-scans to confirm the violation is resolved. Disabled by default; requires `allowWrite: true` in session config. (Commit: 65f349e.)
- **`audit` meta-tool** — one-call shorthand that runs `scan`, `coverage`, and `checklist` and merges results into a single response for cold-start onboarding. Partial failures surface as warning codes via `Promise.allSettled`. (Commit: c41832b.)
- **`bootstrap` meta-tool** — single-call onboarding composing `detect_native_wrappers`, `propose_config`, `scan_project`, and opt-in `baseline create`, plus a copy-pasteable GitHub Actions snippet. `writeBaseline: true` grandfathers current violations into `.ra11y-baseline.json`. Partial-failure tolerant. (Commit: 9337cc4.)
- **`scan_process` tool** — multi-page process scope; threads process-scoped page sets through `runScan` and per-page finders. (Commit: 9f23018.)
- **`conformance_statement` tool** — gates a WCAG conformance claim against the evidence ledger; emits a signed conformance bundle with a SHA-256 digest. Refuses or emits per ledger state. (Commit: 4c7ea4d.)
- **`list_attestations` tool** — lists file-backed attestations with staleness detection. (Commit: 2ad0108.)
- **`list_suppressions` tool** — pragma audit; lists all inline `ra11y-disable` suppressions across the scanned tree. (Commit: d0a017c.)
- **`attest` tool** — writes durable attestations to the evidence ledger; accepts `ruleIds` for partial attestations and surfaces missing rules on the conformance report. (Commit: 6e0f9e5.)
- **`suppress` tool** — adds an inline pragma at a specified location. (Commit: b72eb90.)
- **`propose_config` tool** — proposes a `ra11y.config.ts` starter based on detected wrappers, framework, and scan findings. (Commit: f043fa5.)
- **`propose_baseline` tool** — classifies current violations and proposes a baseline snapshot with reason codes. (Commit: 5fb68bd.)
- **`wrapper_introspect` tool** — AST-based wrapper classification and introspection cache. (Commit: 5bf4c00.)
- **`autoDetectWrappers` and `additionalPaths`** parameters on `scan` and `scan_project` — `autoDetectWrappers: true` runs the wrapper detector inline; `additionalPaths` includes built CSS/HTML files alongside the source tree. Wrapper provenance annotated per-entry as `source: "config" | "autoDetect" | "session"`. (Commits: 941c54a, 8af966a.)
- **`skipCriterion` parameter** on `checklist` and `scan_project`. (Commit: ef8062f.)
- **`includeRuleDetails` parameter** on `scan` and `scan_project`. (Commit: fd045b9.)

#### MCP server — prompt templates

- **`ra11y/triage`** — prioritized triage agenda from a scan result.
- **`ra11y/fix`** — fix-path guidance and verification checklist for a single violation.
- **`ra11y/audit`** — project-level WCAG readiness narrative for a technical lead.
- **`ra11y/vpat-narrative`** — per-criterion VPAT remarks from checklist output.

All four prompts are served via `prompts/list` and `prompts/get`. Prompt templates are referenced in `nextStep` guidance on scan responses. `nextStep` guidance on applicable tools now references the canonical prompt template. See [`docs/mcp/prompts.md`](./docs/mcp/prompts.md). (Commits: a332475, 52f97aa.)

#### MCP server — prompt checksum registry

`src/mcp/prompts/checksums.ts` computes a stable 16-hex SHA over each prompt template's canonical serialization. The checksum surfaces as `_meta.checksum` on `prompts/list` and `prompts/get` responses so agents can pin to a specific prompt version and detect drift without re-reading the full content. (Commits: 9cfc547.)

#### MCP server — capabilities and resources

- **`logging` capability** — server declares `logging` in the initialize response; hosts receive structured scan telemetry via `notifications/message`. Level controlled via `logging/setLevel`. (Commit: 4195a11.)
- **`completions` capability** — `completion/complete` dispatch for prompt names and resource URIs. (Commit: c1b4ca8.)
- **`roots` capability** — server reads `params.roots` from `initialize` and `notifications/roots/list_changed` to set the default scan root. (Commit: b11d7ba.)
- **`resources/list` and `resources/read`** — `docs/kb/**` exposed as MCP resources via `ra11y-kb://` URIs; agents retrieve architecture docs, rule entries, and gotchas directly. (Commit: 707dace.)

#### MCP server — structured errors

All error responses across `scan`, `scan_diff`, `scan_file`, `apply_fix`, and `audit` now carry a `structuredContent` envelope with machine-consumable fields (`code`, `message`, optional `details` and `remediation`). Agents can branch on `code` without parsing prose. See [`docs/errors.md`](./docs/errors.md). (Commit: 19333a1.)

#### MCP server — bidirectional outbound rail and sampling

- `src/mcp/outbound.ts` — JSON-RPC rail for server-to-host requests.
- `src/mcp/session.ts` — `hostCapabilities` slot and `sendRequest` for outbound calls.
- `src/mcp/sampling.ts` — `sample()` helper calling `sampling/createMessage`. Raises `SamplingNotSupportedError` / `SamplingTransportUnavailableError`; default timeout 60 s. (Commits: c141440.)

#### MCP server — metaMode and sessionRef delta cache

- `metaMode` parameter on `scan`, `scan_file`, `scan_diff`, `checklist`, `coverage`, and `list_suppressions` — controls verbosity of the `meta` block. (Commits: 608cda7, 4ac1cba.)
- `sessionRef` + meta-delta cache — allows agents to reference a prior scan result to compute a meta diff without retransmitting the full result. (Commit: 14c35a4.)

#### MCP server — additional surface improvements

- Scan responses carry `warnings: string[]` for silent-failure modes (`scanned_zero_files`, `root_source_defaulted`, `no_config_found`, `storybook_preset_active`, `bootstrap_<leg>_failed`, and others).
- `scan_project` returns a ranked `top-N opaque components` list in `verboseMeta`, ordered by interactive call-site count.
- `scan_project` includes Tailwind-aware CSS coverage hints when Tailwind utilities are detected.
- `scan_project` surfaces `wrapper provenance` per active native wrapper (`source: "config" | "autoDetect" | "session"`; `confirmed` flag for `autoDetect` entries set by one-hop AST probe).
- `checklist` summary leads with a plain-English headline before the structured counts; items carry WCAG principle name (Perceivable / Operable / Understandable / Robust).
- Per-finding suppression placement guidance: each violation includes a `suppressionHint` with the exact pragma and placement.
- `coverage`: `manualUntargeted` list gated behind `showUntargeted: true`; the count is always present. Gated list emitted as `untargetedCriteriaList`.
- `scan dir-mode` nextStep parity — directory-mode scans return the same `nextStep` structure as file-mode scans. (Commit: fbe6c56.)
- Brace-balance snippet walker — `scan` response snippets widen to the enclosing block boundary. (Commit: b0e26cc.)
- `detect_native_wrappers` now includes `suggestedConfigSnippet` and `definitionFile` on candidates. (Commits: e2d4a2f, 6930fce.)
- `suggest_fix` returns `verifyCommand` + `verifyCommandStructured` alongside `fixPaths`. (Commit: 100a0fa.)
- `suggest_fix` suppresses the prose nudge when inline fixes are mechanical. (Commit: 14e3d9a.)
- `scan_diff` surfaces resolved findings in baseline mode. (Commit: 9d85885.)
- `scan_project` paginates files with findings via `limit`/`offset`. (Commit: ab23bd5.)
- `checklist` is paginated with `limit`/`offset`/`perCriterion` caps. (Commit: df8946c.)

#### Engine

- **Evidence primitive and ledger** — `src/engine/evidence.ts` and `src/engine/ledger.ts` establish per-criterion evidence records that aggregate static scan results, file-backed attestations, and pragma-resolved attestations. Coverage and conformance reports consume the ledger. (Commits: e87347f, 6b2778c.)
- **Rule-scoped attestations** — `attest` accepts `ruleIds` for partial criterion coverage; `conformance_statement` surfaces missing rules. (Commit: f9e2f33.)
- **`afterProject` hook for finders** — `Finder` objects may implement `afterProject({ files, enabledStandards })` to emit cross-file review candidates after all per-file passes. (Commit: 1c20455.)
- **Inherited findings** — `Violation.confidence: "inherited"` + `Violation.sourceOfFinding` propagate wrapper-definition findings to call sites. Post-scan synthesizer in `src/engine/inherited-findings.ts`; SARIF maps `sourceOfFinding` to `relatedLocations[0]` with role `"origin"`. (Commit: 2eae9ea.)
- **Criterion IDs in inline disable pragmas** — `ra11y-disable wcag22:2.4.5` works alongside rule IDs. (Commit: 9b9a2f9.)
- **Bare pragma attestations** — `@ra11y-intentional` pragma-reason → attestation resolver wires pragma evidence into the ledger. (Commits: 93619b4, 701f452.)
- **Conformance level gate** — rules and finders skipped end-to-end when their criterion level exceeds the active scan level. (Commit: 347e59e.)
- **`wrapperTreatsAsElement` opt-in** — rules may declare element-mapping semantics to skip false positives on wrapper components. (Commits: 3f7a07f, 7c7e43b.)
- **Polymorphic `as`/`asChild` resolution** — rules may opt in to resolving the rendered element from `as` or `asChild` props. (Commits: 0b130dd, b07455b.)
- **`Violation.groupKey`** — stable SHA derived from rule + AST shape for grouping duplicate findings in PR comments. (Commit: 9184f6d.)
- **`Violation.findingId`** — stable per-finding ID, line-number-independent. (Commit: 49f9227.)
- **`Violation.fixClass`** — inline discriminator (`"mechanical"` | `"guidance"` | `"none"`) on every violation. (Commit: bbbecf1.)
- **`Violation.couldBeWrongBecause`** — additive context for findings that may have lower confidence due to framework-specific patterns (e.g. Tailwind class on consumer). (Commits: 2df787a.)
- **Per-rule coverage confidence** — scanner tracks per-rule file evaluation counts to derive coverage confidence ratios. (Commit: 93dfb72.)

#### Configuration

- **`profiles` primitive** — eight built-in scan profiles (`wcag21-a`, `wcag21-aa`, `wcag22-a`, `wcag22-aa`, `section508`, `en301549`, `strict`, `lenient`). `--profile` CLI flag and `scan_project` parameter. (Commits: 4d217e3, bd73f3d.)
- **`processes` primitive** — multi-page process scope for page-set finders and conformance claims; enables consistent-navigation and consistent-identification finders to operate cross-page. (Commit: 1893410.)
- **`preset: "storybook"` option** — opt-in framework preset: story files reach the scanner, Storybook primitives (`Meta`, `StoryObj`, `StoryFn`, `Story`) render transparent in opaque-component telemetry. `storybook_preset_active` warning code emitted on scan responses. (Commit: 6dfa231.)
- **`@ra11y-intentional` JSDoc tag** — scoped disable recognized as pragma evidence. (Commit: 5b1d54f.)
- **Inline disable reason annotation** — `ra11y-disable wcag22:1.4.5 -- confirmed logotype` or `: reviewed` suffix; reason captured in `meta.suppressions`. (Commit: d820186.)
- **Glob patterns on `nativeWrappers`** — wrapper names may include glob patterns. (Commit: 560d015.)
- **Object-form `nativeWrappers`** — compound component support with per-member element mapping. (Commits: 4e40f10, e1ca368.)
- **`pruneAttestations` / `rewriteAttestations` config primitives**. (Commit: 45b754a.)
- **`attestations prune` CLI subcommand**. (Commit: 0489ba5.)
- **`baseline prune` CLI subcommand**. (Commit: ebbe753.)

#### Rules

- **`aria/conflicting-role`** (wcag22:4.1.2) — flags elements where an explicit ARIA role contradicts the host element's implicit role. Requires the implicit-roles table added to the engine. (Commits: 6937cf3, bddbd40.)
- **`wrapper/drift`** (wcag22:4.1.2) — flags wrapper components that re-implement interactive behavior already present in the wrapped element, creating two parallel interaction models. (Commit: b645b81.)
- **`forms/required-indicator-missing`** (wcag22:3.3.2) — flags form controls marked required without a visible required indicator. (Commit: 2b48123.)

#### Review finders (new since v0.1.0)

Finders produce grounded manual-review candidates (file + line + reason); they do not emit automated violations. All finders respect the active standard, level, and `processes` config.

- `use-of-color` — wcag22:1.4.1
- `images-of-text` — wcag22:1.4.5, 1.4.9 (1.4.9 candidates annotated separately)
- `media-variants` — wcag22:1.2.1 through 1.2.6
- `timing` — wcag22:2.2.1, 2.2.2, 2.2.3, 2.2.4, 2.2.6; literal duration in reason text
- `pointer-input` — wcag22:2.5.1, 2.5.6
- `motion-actuation` — wcag22:2.5.4
- `identify-purpose` — wcag22:1.3.6
- `section-headings` — wcag22:2.4.10
- `multiple-ways` — wcag22:2.4.5; SPA index-shell route annotation
- `error-suggestion` — wcag22:3.3.3
- `error-prevention` — wcag22:3.3.4
- `redundant-entry` — wcag22:3.3.7
- `error-identification` — wcag22:3.3.1
- `server-error-untied` — wcag22:3.3.1; server-side error messages not tied to form fields
- `captcha` — wcag22:3.3.8, 3.3.9
- `on-input-change` — wcag22:3.2.1, 3.2.2; confidence tiers based on detectable handler body shape
- `headings-and-labels` — wcag22:2.4.6
- `consistent-navigation` — wcag22:3.2.3; cross-file `afterProject` finder
- `consistent-identification` — wcag22:3.2.4; cross-file `afterProject` finder
- `flashing-content` — wcag22:2.3.1
- `suppression/no-reason` — surfaces bare `@ra11y-disable` pragmas without a reason annotation
- `validation-timing` — wcag22:3.3.3, 3.3.4; validation event timing relative to submission
- `sensory-characteristics`, `meaningful-sequence`, `no-keyboard-trap`, `media-alternatives` — additional finders covering remaining WCAG A criteria

**Tailwind focus-ring cross-reference for `focus/outline-visible`**: when a CSS rule suppresses the outline and the same element carries a `focus-visible:ring-*`, `focus-visible:outline-*`, or `focus-visible:shadow-*` Tailwind utility class, the finding resolves to info-level. Deterministic literal class-token prefix match only. (Commit: ddaada4.)

#### Parser

- TSX parser correctly disambiguates TypeScript generic syntax (`<T>`, `<T extends U>`) from JSX open tags. A generic in expression position previously corrupted subsequent parse state. (Commit: 2968d87.)
- `JsxElement` AST node preserves `hasSpreadProps` flag; rules use this to suppress false positives on spread-prop primitives. (Commit: e480644.)
- StoryObj `args` synthesis pass — TSX parser synthesizes JSX elements from `StoryObj` story argument bindings for Storybook story files when the `storybook` preset is active. (Commits: 55ba1f7, 0fa523d.)

#### Reports

- **Conformance statement report** — `src/reports/conformance-statement.ts` gates a WCAG conformance claim by evidence level; emits a signed bundle with SHA-256 digest. (Commits: 6dd297e, 68f5b6d.)
- **Profile-scoped coverage report** — coverage report accepts a `profile` argument and filters criteria accordingly. (Commit: 96275bb.)
- **Per-criterion attestation on checklist items** — checklist items carry their evidence status from the ledger. (Commit: 70a5e4e.)
- **VPAT location injection** — `scan`-level candidate locations injected into VPAT manual remarks. (Commit: e612435.)

#### CLI

- **`--profile` flag** — profile-scoped scans against one of the eight built-in profiles. (Commit: bd73f3d.)
- **`attestations prune` subcommand** — removes stale attestation records. (Commit: 0489ba5.)
- **`baseline prune` subcommand** — removes stale baseline entries. (Commit: ebbe753.)
- Per-command reference section in [`docs/cli.md`](./docs/cli.md). (Commit: 192cf0d.)

#### Scripts and developer tooling

- **`scripts/scaffold-rule.ts`** — generates a complete rule skeleton: source file, unit test, fixture directories, and alphabetically-inserted registry entry. Run: `bun scripts/scaffold-rule.ts <domain>/<slug> --satisfies wcag22:X.Y.Z`. (Commit: f1226ed.)
- **400-LOC reviewable-size cap** in `scripts/check-commit.ts` — staged diffs exceeding 400 net lines (excluding generated KB, fixtures, lockfiles) fail `bun run verify:precommit`. `chore(kb):` prefix is exempt. (Commit: c9016c4.)
- **Scope-filtered precommit mode** — `verify:precommit` filters checks to staged files only. (Commit: a2c5816.)
- **Tests typecheck gated in `verify`** — `tests/` directory is typechecked as part of the full verify sequence. (Commit: 20631f6.)

#### CI

- Windows (`windows-latest`) added to the verify matrix. (Commit: b0b07cc.)
- Self-scan SARIF uploaded to GitHub Security tab on every push. (Commit: 6315a06.)
- Dependency-review soft gate on PRs. (Commit: 914d4f1.)
- Performance baseline locked for v1.0; bench budget enforced in CI. (Commit: 8e8a564.)

#### Real-world fixture corpus

- `tests/integration/real-world-fixtures.test.ts` — harness that discovers every subdirectory under `tests/fixtures/real-world/`, loads its `assertions.ts`, and verifies scanner output against declared invariants. Fixtures survive internal API refactors.
- Sanitized fixtures added since v0.1.0: `tsx-generics`, `spa-shell-vite`, `tailwind-coverage`, `logotype-annotation`, `timing-role-hints`, `template-directives`, `opaque-components-top`, `suppression-reason-slot`, `autodetect-attribution`, `storybook-args-binding`, `dialog-modal`, `data-tables`, `nav-landmarks`, `forms-validation`, `attest-lighthouse-bridge`.

ADR: [`docs/adr/0006-real-world-fixture-harness.md`](./docs/adr/0006-real-world-fixture-harness.md).

#### Prompt evaluations

- `tests/evals/` — scripted-host harness replaying prompt templates against a deterministic host stub and asserting on rendered output. See `tests/evals/README.md`.

#### VS Code extension scaffold

- `integrations/vscode/` — extension skeleton wrapping the ra11y MCP server as a subprocess; registered with the VS Code language server client. No runtime dependency on `@ra11y/core` in the extension host process.

#### Docs and knowledge base

- [`docs/migrations/0.1-to-0.2.md`](./docs/migrations/0.1-to-0.2.md) — MCP shape migration guide for the v0.2.0 breaking changes.
- [`docs/migrations/0.2-to-1.0.md`](./docs/migrations/0.2-to-1.0.md) — v1.0 upgrade guide.
- [`docs/mcp/prompts.md`](./docs/mcp/prompts.md) — prompt library user guide.
- [`docs/errors.md`](./docs/errors.md) — canonical error + exit-code index.
- [`docs/conformance.md`](./docs/conformance.md) — end-to-end conformance guide.
- [`docs/kb/architecture/mcp-sampling.md`](./docs/kb/architecture/mcp-sampling.md) — bidirectional outbound rail and sampling client.
- [`docs/kb/standards/coverage.md`](./docs/kb/standards/coverage.md) — authoritative per-criterion automatability coverage matrix.
- [`docs/kb/patterns/suggest-fix-ranking.md`](./docs/kb/patterns/suggest-fix-ranking.md) — `suggest_fix` ranking and `fixClass` semantics.
- [`benchmarks/a11y-tool-comparison.md`](./benchmarks/a11y-tool-comparison.md) — benchmark comparison scaffold.
- ADR 0006 (real-world fixture harness), ADR 0008 (groupKey), ADR 0010 (coverage vs checklist boundary), ADR 0011 (Evidence primitive), ADR 0012 (wrapper introspection), ADR 0013 (rule-scoped attestations), ADR 0014 (inherited findings), ADR 0016 (process-level scope), ADR 0017 (conformance-statement output), ADR 0018 (v1.0 deferred decisions), ADR 0019 (v1.0 public API stability).

### Changed

- **MCP response shape:** `checklist.summary.automatedCoverage` trimmed to a one-field gloss `{ standardId, automatedCriteriaPassRate }` per ADR 0010. The previous per-standard block (`criteriaAutomatable`, `criteriaAutomatablePassing`) is canonical on `coverage` only. `coverage` and `checklist` cross-point via `nextStep` + `nextStepStructured` pairs.
- **MCP response shape:** `activeNativeWrappers` unified into a tagged list `Array<{ name: string; source: "config" | "autoDetect" | "session"; confirmed?: boolean }>`. The former `sessionNativeWrappers` string list is removed; filter by `source === "session"`. Affects `scan`, `scan_project`, `scan_file`, `scan_diff`, `list_suppressions`, and other tools emitting wrapper meta.
- **MCP response shape:** Canonical untargeted-criteria count renamed to `untargetedCriteria` across all tools. Previous names `untargeted` and `manualUntargetedCount` removed.
- `suggest_fix` response shape changed from `{ suggestion: string }` to `{ fixPaths: { primary: FixPath, alternatives: FixPath[] } }`. The `suggestion` prose field was removed in v0.2.0.
- `checklist`: `reviewNeeded` field replaced by a structured array with `priority` and `wcagPrinciple` per item.
- Pre-commit hook scoped to staged files only; the previous behavior ran on the full working tree.
- `list-structure` rule: bare `<li>` outside a list container is now `info` severity (down from `warning`). The element is still surfaced.
- `scan_process` and process-aware finders thread the `processes` config through the project-scoped finder context.
- `scan_project` response includes `baselineStatus` and opaque-component auto-detect disclosure.
- `scan_project` response includes `plan.limitations` on every response for runtime-only checks the static scanner cannot perform.
- `coverage` now includes per-criterion attestation evidence status when the evidence ledger has entries.

### Deprecated

- **`configure` → `sessionConfigure`**: the `configure` MCP tool name was renamed in v0.2.0. In v1.0 the `configure` alias remains but emits `{ "warnings": ["deprecated_tool_name_configure"] }`. Migrate to `sessionConfigure`; parameters are identical.
- **`filePath` → `file` on `suggest_fix` and `apply_fix`**: the canonical parameter name is `file`. `filePath` is accepted as an alias and emits `{ "warnings": ["deprecated_param_filePath: use 'file' instead"] }`. Passing both returns a `conflicting-file-params` structured error.

### Fixed

- `scan_project`: manual-review count was inconsistent between `scan`, `checklist`, and `coverage` when the active level filter excluded some finders. All three surfaces now use the same filtered count. (Commit: df26f17.)
- `scan_project`: empty `snippet` field was emitted alongside a populated `sourceContext` on some `suggest_fix` paths. The field is now conditionally spread and omitted when empty. (Commit: 406a28f.)
- `scan_file`: `reviewCandidates` was not populated. (Commit: 9d8a274.)
- `audit`: sub-handler rejections now caught via `allSettled`; a failing sub-leg surfaces as a warning code without sinking the response. (Commit: 048dfcc.)
- `checklist`: empty-candidate items (criteria with no grounded candidates) were mixed into the primary list; they are now separated and only included when explicitly requested.
- Engine: conformance level filter was not applied to finders, allowing AA-only finders to fire during A-only scans. (Commit: 347e59e.)
- Engine: `.js` and `.ts` files were excluded from the JSX rule filter even when they contained JSX syntax. (Commit: 2558bea.)
- Engine: inline `ra11y-disable` was not applied to review candidates, only to automated violations. (Commit: 1beda8a.)
- Review: `3.2.1`/`3.2.2` finders emitted candidates for all focus/input handlers regardless of detectable context-change signals; they now gate on those signals. (Commit: 9cac116.)
- Review: `use-of-color` finder treated `aria-hidden` colored elements as active color signals; they are now excluded. (Commit: 54d9552.)
- Review: `1.3.3` finder matched polysemous words ("view", "press") in noun phrases without directional instruction. Instructional context is now required. (Commit: 983d3f2.)
- Review: page-set finders (`multiple-ways`, `skip-link`) emitted duplicate candidates across root layouts in Next.js / Remix app directories; deduplication applied after `afterProject`. (Commit: e59af58.)
- Review: timing finder emitted filename-based role hints in user-facing reason text; removed. (Commit: adb3976.)
- Rules: `nested-interactive` flagged the native `<details>`/`<summary>` nesting pattern, which is spec-correct; both elements are now allowlisted. (Commits: 0e7a2ce, 99e2616.)
- Rules: `button-name`, `fieldset-legend`, `labels-required`, `non-empty-label`, `empty-heading` emitted false positives when the element carried a JSX spread (`{...props}`); `hasSpreadProps` detection suppresses the finding with an info-level note. (Commits: 864a590, c864710.)
- Parser: TSX generic disambiguation — a bare `<T>` in expression position was parsed as a JSX open tag, corrupting parse state. (Commit: 2968d87.)
- MCP wrapper detection: usage scan for `autoDetectWrappers` was not reaching default-excluded paths; wrappers used only in test or stories directories were missed. Detection now widens to include those paths. (Commit: 18ec904.)
- MCP `as-unknown-as` casts in the dispatcher replaced with guards, eliminating a category of unsafe casts. (Commit: 1ac89a1.)
- Errors: actionable messages on sampling/attestation/fix-internal error paths; previously returned generic "internal error" prose. (Commit: 7979ef8.)
- Input: root `.gitignore` was not honored on subpath scans. (Commit: 389ba58.)
- MCP `changedOnly`: previously returned a silent full-scan when nothing was staged; now returns an explicit warning. (Commit: 7824f81.)
- Standards: hardcoded criterion count in WCAG 2.2 source comment removed to prevent rot. (Commit: 456158d.)

### Deferred (not in v1.0)

These four items were evaluated for v1.0 and explicitly deferred. They are listed here so readers know what is NOT changing at this release. See [ADR 0018](./docs/adr/0018-v1-deferred-decisions.md) for the revisit signals that would revive each.

- **Rule-catalog renames** — the overlap between `parsing/` and `document/` families, and between `semantics/label-in-name` and `forms/labels-required`, is acknowledged but not resolved. No rule IDs change at v1.0.
- **Coverage + checklist merge** — ADR 0010 boundary is preserved. `coverage` and `checklist` remain separate tools.
- **`@ra11y/parser-typescript` subpackage** — TSX parsing stays in `@ra11y/core`; the optional `typescript` peer is unchanged.
- **Sampling-backed speculative tools** (`resolve-component`, `verdict-candidate`, `draft-vpat-narrative`) — blocked on first-user sampling-host evidence.

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
