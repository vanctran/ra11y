---
name: bench
description: Runs scripts/bench.ts against the performance budget and reports the result. Fails if any scenario exceeds budget. Appends a row to docs/performance.md on success.
allowed-tools: Bash(bun *) Bash(git *)
---

# /bench

Runs the benchmark harness and checks against the budget in `CLAUDE.md` section 13.

## Workflow

1. `bun run build` — bench runs against the built artifact, not source.
2. `bun scripts/bench.ts --json` — capture structured results.
3. Compare each scenario against its budget:
   - cold start: ≤ 200 ms
   - 10 files × 1 KLOC: ≤ 100 ms
   - 100 files × 10 KLOC: ≤ 500 ms
   - 1000 files × 100 KLOC: ≤ 3 s
4. If all pass: append a row to `docs/performance.md` with `date | commit | scenario | ms | budget | margin`, stage, and commit: `perf(bench): record <shortsha> results`.
5. If any fail: dispatch `benchmark-tuner` with the failing scenario and its measurement.

## Return format

```
scenarios:
  cold_start:  <n>ms (budget 200ms, margin +<x>ms)
  10_files:    <n>ms (budget 100ms)
  100_files:   <n>ms (budget 500ms)
  1000_files:  <n>ms (budget 3000ms)
decision: PASS | FAIL
recorded: docs/performance.md:<line>
```
