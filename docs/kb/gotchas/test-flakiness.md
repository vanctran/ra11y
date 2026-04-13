---
title: "Test flakiness"
topic: gotcha
audience: contributors
---

# Test flakiness

Sources of flakiness we've hit in ra11y's test suite, and the fixes.

## Config loader tests leak `RA11Y_CONFIG`

`tests/unit/config/loader.test.ts` mutates `process.env.RA11Y_CONFIG`. If teardown is skipped (uncaught throw, runner killed mid-test), subsequent tests inherit the leaked env var and fail inconsistently.

Fix: always wrap mutations in `beforeEach` / `afterEach` with explicit restoration. See the existing loader test for the pattern.

## tempDir path collision

Tests that write to `mkdtempSync(join(tmpdir(), "ra11y-foo-"))` race each other under parallel runs when they use the same prefix. Add enough entropy — bun's `mkdtempSync` does by default; don't fight it.

## Source-position comparisons flake across platforms

Line endings differ between macOS/Linux (`\n`) and Windows (`\r\n`). Tests that assert on column values should normalize source input or use `\n` explicitly.

## Snapshot tests capture system state

A snapshot that includes a timestamp, a hostname, or `process.version` breaks on every CI run. Scrub these before snapshotting:

```ts
const scrubbed = out.replace(/durationMs":\s*\d+/, "durationMs\":0");
expect(scrubbed).toMatchSnapshot();
```

## MCP integration tests spawn subprocesses

`tests/integration/mcp-session.test.ts` spawns `bun src/cli.ts --mcp` as a subprocess, speaks JSON-RPC over its stdio, then kills it. Two flakiness sources:
1. The subprocess's stderr can mix with its stdout if the test doesn't separate streams.
2. Kill signaling races the final response — always drain stdout before terminating.

Current tests handle both; watch for regressions when adding new MCP tests.

## Fuzz tests

Parser fuzz tests generate random input and assert "no crash, no infinite loop." They're usefully aggressive but occasionally regression-fail on a seed that hits a new code path. When they do, capture the seed, add it as a golden-case test, fix the bug.

## `await` missed on async expectation

```ts
expect(async () => { ... }).toThrow();  // wrong — missing await
await expect(async () => { ... }).rejects.toThrow();  // right
```

Bun's `toThrow` doesn't flag the missing await; the test passes because nothing awaited the promise. Code review catches this; linters don't.

## CI runs in parallel; local runs don't (by default)

`bun test` runs tests serially by default. CI parallelizes across shards. A test that works locally but flakes in CI often has hidden order dependencies — a shared fixture, a monotonic counter, a singleton cache.

## See also

- `scripts/verify.ts` — parallel checks in verify (not tests).
- `.github/workflows/ci.yml` — CI matrix.
