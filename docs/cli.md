# ra11y CLI reference

## Usage

```
ra11y [command] [options] [paths...]
```

- `[command]` — one of the named commands below. Omitting a command runs `scan` by default.
- `[paths...]` — files or directories to scan. Defaults to the current directory.
- `[options]` — any of the flags below, in any order.

Exit codes are emitted by every command and defined centrally in `src/cli/exit-codes.ts`. They are considered stable at v1.0 — changes become semver-major surface.

| Code | Meaning |
|-----:|---------|
| `0` | Clean scan (or `--fail-on never`, or `--baseline check` with no new violations) |
| `1` | Violations found at or above the `--fail-on` threshold, or command-specific failures (doctor probe errors, init refusing to overwrite) |
| `2` | Invalid arguments, unknown rule/standard/profile, missing required input, or read failures (bad config, missing baseline file, etc.) |
| `3` | `--baseline check` detected new violations not in the baseline |

For the canonical error index (MCP structured errors + CLI exit codes), see [`docs/errors.md`](./errors.md).

## Commands

When no command is given, ra11y runs `scan`. Commands that accept `[paths...]` fall back to the current directory when no paths are given.

Global flags (`--standard`, `--level`, `--exclude`, `--format`, `--verbose`, `--quiet`, `--debug`, `--no-color`) apply to all commands that run a scan. They are documented in the sections below; per-command flags document only what is specific to that command.

### ra11y scan

Discovers files, parses them, and runs accessibility rules against the enabled standards. Violations are written to stdout in the requested format. Exit code follows `--fail-on`.

```bash
ra11y src/ --standard wcag22,section508 --level AA --format sarif > ra11y.sarif
```

Key flags:

- `--changed` — scan only files staged in git (`git diff --cached --name-only`). Overrides positional paths.
- `--since <ref>` — scan files changed since the given git ref (branch, tag, or commit SHA).
- `--fail-on <level>` — exit non-zero on: `error` (default), `warning`, `any`, or `never`.
- `--profile <name>` — pin the scan to a named conformance profile defined in `ra11y.config.ts`. Overrides `--standard` and `--level` when both are given; a warning is printed on stderr.
- `--baseline <mode>` — `create`, `check`, or `update`. See [Baseline mode](#baseline-mode).

### ra11y coverage

Runs a scan and prints a per-standard automation-coverage table: how many automatable criteria pass, how many need manual review, and which criteria are failing.

```bash
ra11y src/ --standard wcag22,en301549 --coverage
```

Exit code is always `0` — this is a reporting command, not a gate.

### ra11y checklist

Runs a scan and produces a Markdown manual-review worksheet. The worksheet groups every criterion marked `automatable: "manual"` by standard, includes grounded review candidates with `file:line` locations where the scanner found relevant code, and appends automated violation output above the worksheet boundary.

```bash
ra11y src/ --checklist > checklist.md
```

Exit code is always `0`.

### ra11y vpat

Runs a scan and produces a VPAT 2.4-shaped Markdown conformance table. Pipe to a file for your compliance documentation.

```bash
ra11y src/ --vpat > compliance/vpat.md
```

The output format is described in [docs/certification/vpat-mapping.md](certification/vpat-mapping.md). Exit code is always `0`.

### ra11y certification

Runs a scan and produces a 0–100 certification readiness scorecard. Reads `.ra11y-manual.json` from the current directory (if present) to factor human-reviewed manual criteria into the score; without that file, manual criteria count as pending.

```bash
ra11y src/ --certification
```

Exit code is always `0`. See [docs/certification/readiness-scoring.md](certification/readiness-scoring.md) for score methodology.

### ra11y list-rules

Prints every loaded rule with its ID, severity, and the criteria it satisfies.

```bash
ra11y list-rules
```

No flags beyond global meta flags. Use `ra11y explain <rule-id>` for full rule documentation.

### ra11y list-standards

Prints every loaded standard with its version, publisher, URL, and criterion counts broken down by level.

```bash
ra11y list-standards
```

### ra11y explain

Prints detailed metadata for a single rule: normative WCAG quote, rationale, good and bad code examples, and spec references.

```bash
ra11y explain contrast/minimum
```

Returns exit code `2` when the rule ID is not found.

### ra11y init

Writes a starter `ra11y.config.ts` into the current directory. Idempotent — if the file already exists, it refuses to overwrite and exits `1`.

```bash
ra11y init
```

The generated config covers `standards`, `level`, `exclude`, and the `nativeWrappers` array for projects that wrap native interactive elements in PascalCase components.

### ra11y doctor

Checks the environment and project configuration: Node version, whether `ra11y.config.ts` is present, how many standards and rules are loaded, and common gotchas (missing `tsconfig.json`, not in a git repo). Prints a summary to stdout.

```bash
ra11y doctor
```

Warnings (non-blocking) print as `!`. Hard errors exit non-zero so CI can gate on `ra11y doctor` if desired.

### ra11y baseline

Subcommand namespace for managing the on-disk baseline file (`.ra11y-baseline.json`). The `create`, `check`, and `update` modes run via the `--baseline` flag on `scan`; this subcommand provides `prune`, which removes entries whose files no longer exist.

```bash
ra11y baseline prune           # drop dead entries and rewrite the file
ra11y baseline prune --dry-run # report without mutating
```

Key flags:

- `--baseline-file <path>` — use a baseline file at a non-default path.
- `--dry-run` — report what would be removed without writing.

See [Baseline mode](#baseline-mode) for the `create`/`check`/`update` workflow.

### ra11y attestations

Subcommand namespace for managing the attestation ledger (`.ra11y/attestations.jsonl`). Currently exposes `prune`, which drops records pinned to files that no longer exist.

```bash
ra11y attestations prune           # drop dead records and rewrite the ledger
ra11y attestations prune --dry-run # report without mutating
```

Key flags:

- `--dry-run` — report what would be dropped without writing.

Attestation records are created by the `attest` MCP tool or by writing to `.ra11y/attestations.jsonl` directly. See [docs/mcp/tool-reference.md](mcp/tool-reference.md) for the `attest` tool shape.

## Input

| Flag | Argument | Description |
|------|----------|-------------|
| `<paths>` | positional | Files or directories to scan. Default: current directory. |
| `--changed` | — | Scan only files currently staged in git (`git diff --cached --name-only`). Ignores positional paths. |
| `--since` | `<ref>` | Scan files changed since the given git ref (branch, tag, commit). Also includes uncommitted changes vs HEAD. |
| `--exclude` | `<pattern>` | Substring to exclude from file discovery. Repeatable. |
| `--ignore` | `<pattern>` | Alias for `--exclude`. Repeatable. |

File discovery auto-skips `node_modules`, `.git`, `dist`, `build`, `out`, `.next`, `.nuxt`, `.svelte-kit`, `coverage`, `.turbo`, and `.cache`. Dotfiles are ignored by default. Supported extensions: `.tsx`, `.jsx`, `.ts`, `.js`, `.html`, `.htm`, `.css`.

## Output

| Flag | Argument | Description |
|------|----------|-------------|
| `-f`, `--format` | `<type>` | `terminal` (default), `plain`, `json`, `sarif`, `junit`, `markdown` |
| `--no-color` | — | Disable ANSI colors regardless of TTY |
| `--verbose` | — | Show all violations with full context |
| `--quiet` | — | Errors only, suppress summary |

Format details:

- `terminal` — box-drawn file groups, severity glyphs, WCAG citations, context-aware fix suggestions. Auto-detects TTY and strips colors for pipes.
- `plain` — one violation per line, `<file>:<line>:<col>  <severity>  <ruleId>  <message>`. Screen-reader friendly; auto-selected when `VOICE_OVER=1`, `NVDA=1`, `ORCA=1`, or `TERM=dumb`.
- `json` — machine-readable envelope with result + report blocks. Deterministic ordering.
- `sarif` — SARIF 2.1.0 for GitHub code scanning (`upload-sarif` action).
- `junit` — JUnit XML consumed by CI test runners and IDE test panels.
- `markdown` — PR-comment-ready Markdown with emoji severity, summary counts, and collapsible details sections when >10 violations.

## SARIF output

SARIF (Static Analysis Results Interchange Format) is a JSON schema that GitHub Code Scanning, Azure DevOps, and other CI platforms consume natively. Use `--format sarif` when you want violations to appear as persistent annotations in the GitHub Security tab or a similar code-scanning UI rather than transient build-log lines.

```sh
ra11y src/ --format sarif > ra11y.sarif
```

The output is a [SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/) log with a single run. Every violation maps to one `result` object:

| SARIF field | Source |
|-------------|--------|
| `ruleId` | `violation.ruleId` (e.g. `contrast/minimum`) |
| `level` | `error` / `warning` / `note` — mapped from ra11y severity (`error` → `error`, `warning` → `warning`, `info` → `note`) |
| `message.text` | The violation's human-readable message, including the context-aware fix suggestion |
| `locations[0].physicalLocation.artifactLocation.uri` | Relative file path |
| `locations[0].physicalLocation.region` | `startLine`, `startColumn`; `endLine`/`endColumn` when the rule supplies them |
| `partialFingerprints.primary` | A stable `findingId` hash of rule ID + surrounding source context (±3 lines). GitHub uses this to deduplicate the same violation across pushes even when unrelated edits shift the line number. |

The `tool.driver.rules` array contains one entry per rule ID that fired in the scan (rules with zero findings are omitted). Each rule entry carries:

- `shortDescription.text` — rule ID rendered as words (e.g. `contrast minimum`)
- `fullDescription.text` — the message from the first matching violation
- `properties.tags` — `["accessibility", "<criterion-id>", …]` for every criterion the rule satisfies
- `properties.criteriaTitles` — human titles for the criterion IDs in `tags`, aligned by index, when available

See `docs/ci.md` for a complete GitHub Actions workflow that uploads the SARIF file to the GitHub Security tab.

## Standards

| Flag | Argument | Description |
|------|----------|-------------|
| `--standard` | `<list>` | Comma-separated standard IDs. Default: `wcag22`. Built-in: `wcag22`, `wcag21`, `section508`, `en301549`. |
| `--level` | `<level>` | Conformance level: `A`, `AA` (default), `AAA`. |
| `--list-standards` | — | Print all loaded standards with criterion counts and URLs. |

```sh
ra11y src/ --standard wcag22,section508,en301549 --level AA
ra11y --list-standards
```

## Rules

| Flag | Argument | Description |
|------|----------|-------------|
| `--list-rules` | — | Print all loaded rules with severity and satisfies lists |
| `--explain` | `<rule-id>` | Print detailed metadata for a single rule (WCAG quote, rationale, good/bad examples, references) |

```sh
ra11y --list-rules
ra11y --explain contrast/minimum
```

## Behavior

| Flag | Argument | Description |
|------|----------|-------------|
| `--fail-on` | `<level>` | Exit non-zero on: `error` (default), `warning`, `any`, or `never` |

## Reports

| Flag | Description |
|------|-------------|
| `--coverage` | Per-standard automatable coverage summary |
| `--checklist` | Generate a Markdown manual-review worksheet for every criterion marked `automatable: "manual"` |
| `--vpat` | Generate a VPAT 2.4 Markdown conformance table |
| `--certification` | Generate a 0–100 certification readiness scorecard |

`--certification` reads `.ra11y-manual.json` from the cwd (if present) to factor human-reviewed manual criteria into the score. Without that file, manual criteria count as pending.

```sh
ra11y src/ --coverage
ra11y src/ --checklist > checklist.md
ra11y src/ --vpat > vpat.md
ra11y src/ --certification
```

## Baseline mode

For adopting ra11y on an existing codebase with many violations.

| Flag | Argument | Description |
|------|----------|-------------|
| `--baseline` | `<mode>` | `create`, `check`, or `update` |
| `--baseline-file` | `<path>` | Path to the baseline file. Default: `.ra11y-baseline.json` in cwd. |

```sh
ra11y src/ --baseline create        # snapshot current violations
ra11y src/ --baseline check         # fail only on new violations (exit 3)
ra11y src/ --baseline update        # rewrite baseline, dropping resolved violations
```

Violations are fingerprinted by `sha1(ruleId + filePath + message)`. Line numbers are deliberately NOT in the fingerprint, so unrelated edits in the same file don't invalidate the baseline.

## Meta

| Flag | Description |
|------|-------------|
| `-h`, `--help` | Print this help text |
| `-v`, `--version` | Print the ra11y version |
| `--debug` | Enable debug logger (set via `RA11Y_DEBUG=1` too) |

## Environment variables

| Variable | Purpose |
|----------|---------|
| `NO_COLOR` | Disable ANSI colors (https://no-color.org) |
| `FORCE_COLOR` | Force ANSI colors on; `0` forces off |
| `RA11Y_DEBUG` | Set to `1` or `true` for debug-level logging |
| `RA11Y_CONFIG` | Explicit config file path (overrides the upward walk) |
| `RA11Y_STANDARD` | Default standard list when `--standard` is not given |
| `RA11Y_LEVEL` | Default level when `--level` is not given |

## Examples

```sh
# Sub-second precommit scan
ra11y --changed --fail-on error

# Full project scan with all four standards
ra11y src/ --standard wcag22,wcag21,section508,en301549

# Generate VPAT-ready report
ra11y src/ --vpat > compliance/vpat.md

# Check for regressions on a legacy codebase
ra11y src/ --baseline check

# GitHub code scanning integration
ra11y src/ --format sarif > ra11y.sarif
# Then upload via github/codeql-action/upload-sarif@v3

# PR comment
ra11y --changed --format markdown > report.md
gh pr comment --body-file report.md
```
