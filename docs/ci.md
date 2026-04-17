# CI integration

ra11y is designed to run in CI without configuration. The binary exits with a code the pipeline can act on, writes structured output to stdout, and never talks to the network.

## Exit codes

| Code | Meaning |
|-----:|---------|
| `0` | Clean scan — no violations at or above the `--fail-on` threshold, or `--fail-on never` was set, or `--baseline check` found no new violations |
| `1` | Violations found at or above the `--fail-on` threshold (default: `error`) |
| `2` | Scanner error — bad config, unknown standard ID, unreadable file, missing baseline file, or an unexpected runtime exception |
| `3` | `--baseline check` found violations not in the baseline |

`--fail-on` controls which severities count as failures:

| `--fail-on` value | Exits non-zero when |
|-------------------|---------------------|
| `error` (default) | Any `error`-severity violation |
| `warning` | Any `error` or `warning` violation |
| `any` | Any violation regardless of severity |
| `never` | Never — useful for reporting-only jobs that must not block deploys |

## GitHub Actions

### Block PRs on new violations

The minimal workflow: scan changed files on every push and pull request, fail the build if any error-severity violation appears.

```yaml
name: Accessibility

on: [push, pull_request]

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun add -D @ra11y/core
      - run: bunx ra11y src/ --fail-on error
```

### Upload to GitHub Security tab

`github/codeql-action/upload-sarif` ingests the SARIF 2.1.0 file ra11y emits and surfaces violations as persistent Code Scanning alerts in the GitHub Security tab. Alerts are deduplicated across pushes using the `partialFingerprints.primary` field ra11y sets on every result.

```yaml
name: Accessibility

on:
  push:
    branches: [main]
  pull_request:

jobs:
  scan:
    runs-on: ubuntu-latest
    permissions:
      security-events: write   # required by upload-sarif
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun add -D @ra11y/core

      - name: Run ra11y
        run: bunx ra11y src/ --format sarif > ra11y.sarif
        continue-on-error: true  # upload even when violations are found

      - name: Upload to GitHub Security tab
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: ra11y.sarif
          category: ra11y
```

`continue-on-error: true` on the scan step prevents a failed exit code from skipping the upload step. The upload step reports the real status to GitHub Code Scanning; the overall job still shows red when violations are present.

`permissions: security-events: write` is required. Without it, the upload step fails with a 403.

### Adopt on a messy codebase with a baseline

If your codebase has existing violations, grandfather them on day one and block only regressions:

```yaml
- name: Create baseline (first run only — commit the result)
  run: bunx ra11y src/ --baseline create

- name: Check for regressions
  run: bunx ra11y src/ --baseline check
```

`--baseline create` writes `.ra11y-baseline.json`. Commit that file. From then on, `--baseline check` exits `3` only when a violation appears that was not in the baseline; the grandfathered backlog is ignored.

Commit the baseline file alongside the workflow change:

```sh
bunx ra11y src/ --baseline create
git add .ra11y-baseline.json
git commit -m "chore: add ra11y baseline"
```

## GitLab CI

```yaml
a11y:
  image: oven/bun:latest
  script:
    - bun add -D @ra11y/core
    - bunx ra11y src/ --fail-on error
  artifacts:
    when: always
    paths:
      - ra11y.sarif
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

To generate the SARIF artifact alongside the blocking check:

```yaml
script:
  - bun add -D @ra11y/core
  - bunx ra11y src/ --format sarif > ra11y.sarif || true
  - bunx ra11y src/ --fail-on error
```

The `|| true` on the SARIF-generation step ensures the file is written even when violations exist, so the artifact is always available for download regardless of the job's exit status.

## Precommit integration

For blocking violations before they reach CI at all, see the precommit examples in [`getting-started.md`](./getting-started.md#precommit-integration).

## Further reading

- [CLI reference](./cli.md) — every flag with examples, including `--format sarif` details
- [Baseline mode](./cli.md#baseline-mode) — full flag reference for `--baseline create/check/update`
- [Configuration](./configuration.md) — config file spec for per-path rule overrides
