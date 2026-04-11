---
name: verify
description: Universal preflight — runs typecheck, lint, tests, zero-dep check, cycle check, network isolation check, and build in sequence. Returns PASS or a focused list of failures. Use before every commit and before handing off to another agent.
allowed-tools: Bash(bun *) Bash(bunx *) Bash(git *)
---

# /verify

Runs the full verification suite on the current working tree.

## Gates (in order, stops on first failure for fast feedback)

1. `bun run typecheck` — `tsc --noEmit`
2. `bun run lint` — `biome check .`
3. `bun run check-deps` — zero-dependency invariant
4. `bun run check-network-isolation` — no fetch/http/dns from src/
5. `bun run check-cycles` — no circular imports
6. `bun run check-limits` — function/file size, complexity, nesting
7. `bun test` — full test suite (unit + integration + snapshot + cli)
8. `bun run check-kb-drift` — `docs/kb/` in sync with rule/standard metadata
9. `bun run docs:check` — TSDoc + Mermaid + links + API docs drift
10. `bun run build` — artifact still compiles

## Behavior

- Each gate is gated on whether its preconditions exist. A fresh repo without `node_modules` or `src/` skips the TypeScript gates and prints a note instead of a failure.
- On first failure: print the gate name, the failing command, and the output. Stop. Do not run subsequent gates.
- On success: print a one-line PASS summary with durations per gate.

## Why this ordering

Fast gates first, slow gates last. Typecheck catches most issues in seconds; the build is last because it's expensive. The first failing gate tells you where to look without waiting on downstream gates.

## Exit status

- `0` on success.
- non-zero on any gate failure, with the failing gate's exit code propagated where possible.
