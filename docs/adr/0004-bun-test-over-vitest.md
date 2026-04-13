---
title: "ADR 0004: Bun's built-in test runner over Vitest"
status: Accepted
date: 2026-04-11
---

# ADR 0004: Bun's built-in test runner over Vitest

## Status

Accepted.

## Context

ra11y's build and script layer is Bun-first (ADR not yet written; it's in `CLAUDE.md` §3). Every file in `scripts/`, `.claude/hooks/`, and `tests/` runs under `bun`. The project never claims to be Node-only at the tooling layer — the shipped artifact is Node-compatible, but the dev-time experience assumes Bun.

We needed a test runner. The obvious choices were Vitest (mature, TypeScript-first, good watch mode), Jest (baseline, but slow and retiring ESM support), and Bun's built-in `bun:test` (zero-config, extremely fast, Vitest-compatible API).

## Decision

Use `bun:test`.

```ts
import { describe, expect, it } from "bun:test";
```

- Test files match `*.test.ts` or `*.spec.ts` and live in `tests/`.
- `bun test` runs everything. `bun test path/to/file.test.ts` runs one file. `bun test --watch` watches.
- Coverage via `bun test --coverage`.

## Consequences

**Benefits**
- Zero config. No `vitest.config.ts`, no test-runner peer dep in `devDependencies`, no version-pinning maintenance.
- Fast. The full suite (1000+ tests) runs in ~500ms on an M-series Mac. `verify` completes under 1s in total when parallelized.
- API-compatible with Vitest (describe / it / expect). If we ever swap, the test files don't change.
- Built-in snapshot support via `toMatchSnapshot`, covering the formatters' golden tests.

**Costs**
- Users running the test suite must have Bun installed. For our contributor audience (internal team + OSS contributors running `scripts/setup.ts`) this is acceptable; the README's contributor section documents the bun install step.
- The shipped library artifact does not depend on Bun. Consumers of `@ra11y/core` can be pure Node — the test-runner choice is purely internal.
- `bun:test` is still evolving. Occasionally a matcher has a rough edge (e.g. the `toThrow` error matcher had stricter matching than Vitest before 1.3). We work around these case-by-case rather than switching runners.

## Alternatives considered

**Vitest.** Solid choice. Rejected because we'd need it in `devDependencies` and a `vitest.config.ts`, and `bun:test` is faster and API-compatible.

**Jest.** Rejected — slow, ESM support is grudging, and Jest's ecosystem assumptions don't match our Bun-first setup.

**Node's built-in test runner (`node:test`).** Rejected — API diverges from Jest/Vitest/Bun norms (no `describe` / `it`, different assertion library). Would create ongoing friction.

## Notes

The Bun-vs-Node distinction matters for `src/` — that code must run on Node LTS 22+ and cannot use Bun-specific APIs (`Bun.file`, `Bun.serve`, `Bun.fetch`, etc.). The tooling layer (tests, scripts, hooks) uses Bun freely. Enforcement is by code review + occasional `bun build --target=node` dry runs against the `src/` tree; we haven't felt the need for a linter rule yet.
