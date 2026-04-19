# Performance history

Append-only history of `scripts/bench.ts` runs. Budgets are defined in CLAUDE.md § 11 (cold start, 10-file, 100-file, 1000-file scenarios); this file records actual measurements so regressions are visible over time and the `benchmark-tuner` agent has a paper trail of past fixes.

The `/bench` skill automates the workflow:

1. Run `scripts/bench.ts`. It fails if any scenario exceeds its budget.
2. On success, append a row to the table below via `chore(perf): record <shortsha> results`.
3. On regression, delegate to `benchmark-tuner` which profiles the hot path, closes the gap, and appends a row explaining the fix.

## Runs

| date | commit | scenario | ms | budget | margin | notes |
|------|--------|----------|----|--------|--------|-------|
| 2026-04-19 | 343bd30 | cold-start | 41.0 | 200 | -79.5% | v1.0 baseline (median of 11 iterations, bun scripts/bench.ts --json) |
| 2026-04-19 | 343bd30 | 10-files-1k-loc | 5.2 | 100 | -94.8% | v1.0 baseline |
| 2026-04-19 | 343bd30 | 100-files-10k-loc | 28.5 | 500 | -94.3% | v1.0 baseline |
| 2026-04-19 | 343bd30 | 1000-files-100k-loc | 272.3 | 3000 | -90.9% | v1.0 baseline |

Scenarios mirror the budget table in CLAUDE.md § 11 (`cold-start`, `10-files-1k-loc`, `100-files-10k-loc`, `1000-files-100k-loc`). `ms` is the median sample; `margin` is median-minus-budget as a percentage of budget (negative = headroom). The v1.0 baseline row anchors regressions — future `/bench` runs append rows here so deltas are visible over time.

## Regressions and fixes

When a run causes a budget fail and `benchmark-tuner` closes the regression, record it under a new dated subsection here — what regressed, the cause, and the fix — so patterns can be spotted across runs.
