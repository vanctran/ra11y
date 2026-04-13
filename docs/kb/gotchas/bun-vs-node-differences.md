---
title: "Bun vs Node differences that have bitten us"
topic: gotcha
audience: contributors
---

# Bun vs Node differences that have bitten us

ra11y's dev toolchain is Bun-first; the shipped artifact is Node-compatible. Keeping both paths working means watching for divergence.

## `src/` must run on Node LTS 22+

- No `Bun.file`, `Bun.serve`, `Bun.SQL`, `Bun.fetch`, `Bun.$`, `Bun.spawn`, `Bun.write`.
- Prefer `node:fs/promises`, `node:child_process`, `node:path`, `node:url`.
- `import.meta.dir` is Bun-specific; use `new URL(".", import.meta.url).pathname` if portability matters. (In practice `import.meta.dir` is tolerated in `scripts/` because the scripts only run under bun.)
- `Bun.env` and `Bun.version` only exist under Bun.

The `check-bun-in-src.ts` script (if we add one) would enforce this. Today it's code review.

## `scripts/` and `tests/` run under Bun

Freely use `Bun.spawn`, `Bun.file`, `import.meta.dir`, etc. The verify gate that runs these checks is itself a bun script.

## `process.env` typing is stricter under TypeScript's `noPropertyAccessFromIndexSignature`

Bun and Node both populate `process.env`, but TypeScript treats its type as `Record<string, string | undefined>`. With `noPropertyAccessFromIndexSignature: true` (our tsconfig), `process.env.FOO` fails typecheck. Use `process.env["FOO"]` or a typed helper.

## `readline` behavior diverges slightly on EOF

Our MCP server uses `readline` over stdin. Under Bun, a clean EOF closes the readline instance and the loop exits normally. Under Node, the same happens but the timing of the `close` event fires a tick later. If your test spawns the server and sends stdin.end(), expect a small timing difference.

## JSON-RPC framing: newline-delimited vs length-prefixed

MCP uses newline-delimited JSON-RPC over stdio. Both runtimes support this via `readline`. If the protocol ever adds `Content-Length`-prefixed framing (LSP-style), we'd need to parse it manually — `readline` won't help.

## Test-runner quirks

- `bun:test` generally matches Vitest's API but occasionally diverges (e.g. `toThrow` matching behavior pre-1.3).
- `bun test --coverage` output format is different from `c8` or `vitest`. CI consumers pin on `bun:test`'s format.

## Install speed

`bun install` is faster than `npm install` by a significant margin. This matters for the precommit-hook story — a contributor's `.husky/pre-commit` that runs `bun install` before `ra11y` is still fast. Don't switch to `npm install` in `scripts/setup.ts` for uniformity — we'd lose the speed advantage.

## See also

- [Bun's Node compatibility table](https://bun.sh/docs/runtime/nodejs-apis) — which APIs work under both.
- `CLAUDE.md` §3 — the invariant that `src/` stays Node-compatible.
