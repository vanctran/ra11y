---
title: "ADR 0001: Zero runtime dependencies"
status: Accepted
date: 2026-04-11
---

# ADR 0001: Zero runtime dependencies

## Status

Accepted — enforced by `scripts/check-zero-deps.ts` in CI.

## Context

ra11y is pitched as a trust-first tool: users run it against proprietary source and expect it to stay offline, not phone home, not pull in transitive code they haven't reviewed. We also want the install to be fast so precommit hooks using ra11y don't add seconds to every `git commit`.

The accessibility-tooling space has a cautionary tale. `axe-core` itself is clean, but several popular CLI wrappers pull 200+ transitive packages, many of which have had supply-chain incidents (`event-stream`, `colors.js`, `ua-parser-js`). The install footprint becomes a liability — not because ra11y maintainers can't review it, but because *users* can't.

## Decision

`package.json.dependencies` is permanently empty. `peerDependencies` is limited to `typescript` (optional, for TSX parsing via the compiler API). `devDependencies` is limited to TypeScript, Bun types, and Biome. Nothing else.

When we need a primitive that would otherwise come from npm, we implement it in `src/utils/` — ANSI colors, argument parsing, glob matching, string width, contrast calculation, etc. Each is tested, narrow, and ~50–300 lines.

Enforced by:
- `scripts/check-zero-deps.ts` — fails CI if `dependencies` grows.
- `scripts/check-network-isolation.ts` — fails CI if anything in `src/` references `fetch`, `node:http`, `node:https`, `node:net`, `node:dns`, or `Bun.fetch`.
- Dependabot config scoped to `devDependencies` only.

## Consequences

**Benefits**
- `npm install @ra11y/core` pulls one package. Resolution is deterministic and fast.
- Supply-chain audit is tractable — the full attack surface is our code plus TypeScript.
- The "offline by contract" promise is a grep, not a vibe.

**Costs**
- We've written a ~300-line argument parser, a ~200-line globber, a ~150-line color parser, and so on. Each is code we own.
- When a mature npm package solves the problem well (e.g. a PEG parser generator), we either reimplement a narrow slice of it or redesign around not needing it.
- We can't pull in `@modelcontextprotocol/sdk`, so the MCP server is in-house JSON-RPC. That's ~200 lines in `src/mcp/server.ts`.
- Performance budget discipline is stricter — we don't get to blame third-party hotspots.

## Alternatives considered

**Allow "trusted" devDependencies to move into runtime.** Rejected — "trusted" is vibe-based and any single compromise retroactively breaks the promise.

**Scope the rule to production code only, allow dev tooling in runtime.** Rejected — the distinction is meaningless from a user's perspective; the install artifact is what they run.

**Rely on lockfile auditing instead of a total ban.** Rejected — lockfile audits are reactive; the ban is proactive and the enforcement cost is low.

## Notes

The single carve-out briefly considered was `src/agent/` for an Anthropic API client in a proposed `ra11y --fix` command. That path was dropped (see ADR 0005) in favor of MCP sampling, which delegates LLM work to the host and requires no network code in `src/`. The invariant stands unbroken.
