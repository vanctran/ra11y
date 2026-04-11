---
name: session-state
description: Dumps the current project state — branch, dirty count, phase progress, rule and standard counts, last test status, last commits, last audit entries — so you can quickly orient yourself after resuming.
allowed-tools: Read Grep Glob Bash(git *) Bash(bun *)
---

# /session-state

One-shot snapshot of the ra11y project state. Read-only, fast.

## What it shows

1. Git: current branch, clean/dirty, last 10 commits.
2. Backlog: progress per phase (done/total, next unchecked item).
3. Code: rule count, standard count, formatter count, hook count, agent count, skill count.
4. Tests: last `bun test` status (from `.claude/test-status.json`).
5. Audit: last 20 entries from `.claude/history.jsonl`.
6. Performance: last row of `docs/performance.md`.
7. Drift: `bun scripts/check-kb-drift.ts` (cached if possible).

## Workflow

1. Read and compute each section.
2. Render as a single structured block.
3. Return. No side effects.

## Return format

```
branch: <name> · <N dirty | clean>
phase progress:
  P0: X/Y ✓ .claude infra
  P1: X/Y   guards + scripts
  …
code:
  rules:      N (next: <next unchecked>)
  standards:  N
  formatters: N
tests:       N passing · <timestamp>
performance: <last bench row>
drift:       clean | <files>
recent commits:
  <sha> <subject>
  …
recent audit:
  <ts> <event> <action>
  …
```
