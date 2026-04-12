# ra11y CLI reference

## Usage

```
ra11y [options] [paths...]
```

- `[paths...]` — files or directories to scan. Defaults to the current directory.
- `[options]` — any of the flags below, in any order.

Exit codes:

| Code | Meaning |
|-----:|---------|
| `0` | Clean scan (or `--fail-on never`, or `--baseline check` with no new violations) |
| `1` | Violations found at or above the `--fail-on` threshold |
| `2` | Scanner error (bad config, unknown standard, missing baseline file, etc.) |
| `3` | `--baseline check` detected new violations not in the baseline |

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
