# ADR 0019 — v1.0 public API stability

- Status: Accepted (2026-04-19)
- Supersedes: none
- Related: ADR 0018 (v1.0 deferred decisions), Track V backlog item V1-API-STABILITY-AUDIT, `scripts/check-tsdoc.ts`, `scripts/check-api-docs-drift.ts`

## Context

`@ra11y/core` ships two npm entry points — `.` (for programmatic consumers) and `./plugin` (for rule/standard/formatter authors). After v1.0 the semver policy (CLAUDE.md §12) kicks in: removing or renaming a public export is a breaking change; changing a public signature is a breaking change. Before we tag v1.0 we need a written, enumerated list of the public surface so that "what's public" is not an accident of whatever happened to be exported on tag day.

The audit confirmed:

- `scripts/check-tsdoc.ts` already enforces a TSDoc block above every exported declaration in `src/index.ts`, `src/cli.ts`, and `src/api/**`. It passes.
- `scripts/check-api-docs-drift.ts` names the two entry points (`src/index.ts` and `src/api/plugin.ts`) and collects every exported identifier from them. Those identifiers are the authoritative public-surface list.
- No exported name carries an `@experimental` or `@internal` tag. The one `@internal` marker in the tree (`src/output/agent-response/build-finding.ts`) sits on a non-exported symbol inside an internal module.
- `src/api/index.ts` is a within-repo barrel that is not listed in `package.json` `exports`, not imported by any source file, and therefore not part of the public surface. It remains as a convenience for possible future use but contributes no exported names to the `.d.ts` published for `@ra11y/core` or `@ra11y/core/plugin`.
- Several types defined in `src/types/*.ts` are deliberately NOT re-exported through `src/types/index.ts` (e.g. `NativeWrapperMap`, `ConfigPreset`, `FixPath`, `FixPaths`, `PerRuleCoverage`, `ReviewConfidence`, `FixClass`, `PolymorphicResolution`, `ProjectRuleFile`, `SyntheticElementOrigin`, `AttestationRecord`, `CriterionEvidence`, `EvidenceLedger`, `EvidenceSource`, `EvidenceStatus`). They are consumed internally via deep imports and are not reachable through either npm entry point as named exports. They remain free to evolve without a semver-major bump.

## Decision

The public surface for `@ra11y/core` v1.0 is frozen at the exact set of named exports listed below. Post-v1.0, renaming or removing any entry, or making a breaking signature change to one, is a semver-major change. Additions are semver-minor.

### Entry point `@ra11y/core` (resolves to `src/index.ts`)

| Symbol        | Kind      | Source file      | Stability |
|---------------|-----------|------------------|-----------|
| `Criterion`   | type      | `src/index.ts`   | stable    |
| `ReportData`  | type      | `src/index.ts`   | stable    |
| `ScanResult`  | type      | `src/index.ts`   | stable    |
| `Severity`    | type      | `src/index.ts`   | stable    |
| `Standard`    | type      | `src/index.ts`   | stable    |
| `Violation`   | type      | `src/index.ts`   | stable    |
| `scan`        | function  | `src/index.ts`   | stable    |
| `ScanOptions` | interface | `src/index.ts`   | stable    |

Notes on this entry:

- The six type re-exports pass through `./types/index.ts`. Their authoring definitions live in `src/types/standard.ts` (`Criterion`, `Standard`), `src/types/violation.ts` (`ReportData`, `ScanResult`, `Severity`, `Violation`).
- `scan` currently throws `"not implemented yet"` — v1.0 preserves the existing signature so that when the implementation lands post-v1.0 the signature addition is drop-in. The signature (`(options: ScanOptions) => Promise<ScanResult>`) is part of the freeze.
- `ScanOptions` has three fields today (`paths`, `standards?`, `level?`). Adding a new optional field is minor. Removing or renaming any existing field is major.

### Entry point `@ra11y/core/plugin` (resolves to `src/api/plugin.ts`)

| Symbol                   | Kind      | Source file           | Stability |
|--------------------------|-----------|-----------------------|-----------|
| `defineRule`             | function  | `src/api/plugin.ts`   | stable    |
| `defineStandard`         | function  | `src/api/plugin.ts`   | stable    |
| `defineFormatter`        | function  | `src/api/plugin.ts`   | stable    |
| `defineConfig`           | function  | `src/api/plugin.ts`   | stable    |
| `defineCandidateFinder`  | function  | `src/api/plugin.ts`   | stable    |
| `FormatterFn`            | type      | `src/api/plugin.ts`   | stable    |
| `Formatter`              | interface | `src/api/plugin.ts`   | stable    |

Notes on this entry:

- Each `define*` helper is a generic identity function: `<T extends X>(value: T): T`. The generic bound (`Rule`, `Standard`, `Formatter`, `Config`, `CandidateFinder`) is part of the signature, so widening the bound is non-breaking but narrowing it is major. The types themselves live in `src/types/` — they are reachable only via the helpers' generic constraints in the published `.d.ts`; plugin authors import them via the same `./plugin` entry through structural inference or via the canonical `@ra11y/core` re-exports when those types are listed there.
- The `Formatter` / `FormatterFn` pair is owned by `src/api/plugin.ts` (not `src/types/`) because the formatter shape is defined at the plugin boundary, not inside the engine.

### Escape hatch: `experimental`

None of the v1.0 exports are marked experimental. The column stays in the tables above so a future minor can add a new export and label it `experimental` without widening the schema — an `experimental` entry is not covered by the semver freeze until a subsequent release promotes it to `stable`. Mechanically this will be a doc-only convention: source code uses a TSDoc `@experimental` tag on the new export, and the entry lands here with `stability: experimental` at introduction.

### Internal-only, not frozen

The following are frequently asked about and are explicitly **not** part of the public surface for v1.0:

- Every type under `src/types/` that is not re-exported through `src/types/index.ts` (see Context). Deep-importing from `@ra11y/core/types/*.js` is unsupported; the paths may move without notice.
- `src/api/index.ts`. Dead internal barrel; not in `package.json` `exports`.
- All `src/engine/**`, `src/mcp/**`, `src/output/**`, `src/reports/**`, `src/review/**`, `src/cli/**`, `src/config/**`, `src/utils/**`, `src/input/**` modules. Internal, free to refactor.
- `src/cli.ts`. Binary entry — the shipped CLI surface (flag names, exit codes, stdout shape) is covered by the CLI stability policy in CLAUDE.md §12, not by this ADR.

### Shape-owning types referenced through public exports

`Violation`, `ScanResult`, `ReportData`, `Standard`, `Criterion`, and the `Rule` / `CandidateFinder` / `Config` / `Formatter` generic bounds reference additional types by name (e.g. `Location` inside `Violation.location`, `Fix` inside `Violation.fix`, `FixPaths` inside `Violation.fixPaths`, `Automatability` inside `Criterion.automatable`). Those referenced-but-not-named-exported types are structurally stable under the freeze — consumers who write `typeof violation.location` get the same shape across v1.x minors — but they are not reachable as named imports. If a consumer needs one as a named type, the fix is an additive re-export in a future minor, which is semver-non-breaking.

## Consequences

- Backlog item V1-API-STABILITY-AUDIT closes.
- Post-v1.0 PRs that touch `src/index.ts` or `src/api/plugin.ts` must check this ADR first: any entry in the tables above cannot be renamed or removed without a semver-major release and a documented deprecation window.
- `scripts/check-tsdoc.ts` stays the mechanical guard for TSDoc presence; it runs in `verify:precommit`.
- `scripts/check-api-docs-drift.ts` stays the mechanical guard against the public-symbol list drifting out of sync with `docs/api/`. Any addition to the tables above requires a matching `docs/api/<symbol>.md` page.
- Types deliberately held internal (`NativeWrapperMap`, `FixClass`, `ReviewConfidence`, `PolymorphicResolution`, etc.) remain free to evolve. Elevating one of them to the public surface is a semver-minor addition, not a breaking change — it only adds a named export.
- The `scan` stub in `src/index.ts` is now officially part of the v1.0 contract at the signature level. The throwing body is replaceable without a breaking change; the signature is not.
