---
title: "ADR 0005: In-house MCP server, sampling over API-key agent"
status: Accepted
date: 2026-04-12
supersedes: handoff-mcp-and-agent.md §Part 2
---

# ADR 0005: In-house MCP server, sampling over API-key agent

## Status

Accepted. Shipped in v0.1.0.

## Context

ra11y's differentiator in the accessibility space isn't a specific rule or a specific output — every tool will bolt on "LLM-assisted fixes" in 2026. The differentiator is depth of agent integration: tools that use the scanner's strengths (review candidates with evaluation prompts, native-wrapper detection, criterion-aware coverage) so an agent can resolve what static analysis cannot.

Two shipping questions followed:

1. What transport? Model Context Protocol (MCP) is the obvious bet — it's the de facto standard across Claude Code, Cursor, Zed, Continue. Alternatives (OpenAI function calling, LangChain) lock us to one ecosystem.
2. How does ra11y reach the LLM when source-reading is needed? The original handoff proposed a `ra11y --fix` CLI with its own Anthropic API key + prompt library. That was dropped.

## Decision

Two decisions bundled:

**(a) In-house JSON-RPC 2.0 MCP server.** `src/mcp/server.ts` is ~200 lines. No `@modelcontextprotocol/sdk` dependency — that would break ADR 0001. The server advertises 12 tools covering scan, scan_project, scan_file, explain_rule, explain_standard, suggest_fix, coverage, checklist, review_candidates, detect_native_wrappers, list_rules, configure.

**(b) MCP sampling for all LLM-backed features — no API key in ra11y.** When a tool needs a model to read a component source, verdict a review candidate, or draft VPAT narrative text, the server calls `sampling/createMessage` on the host. The host (Claude Code, Cursor, …) supplies the model and the key; ra11y never sees a secret. Planned sampling-backed tools: `resolve_component`, `verdict_candidate`, `draft_vpat_narrative`.

## Consequences

**Benefits**
- Zero-dep invariant (ADR 0001) holds through the entire MCP surface.
- "src/ never touches the network" (part of our trust pitch) holds — sampling requests go out through the host, not through ra11y. `scripts/check-network-isolation.ts` stays clean with no carve-outs.
- Works with any MCP host that implements sampling. No Anthropic-specific code, no "bring your own SDK" documentation.
- We don't compete with agent hosts on UX. Claude Code's interactive model selection, prompt caching, and retry logic is better than anything we'd write.
- Users don't manage another API key. The host they're already using is the one paying for the LLM calls.

**Costs**
- Sampling is a newer MCP capability and not universally supported. Claude Code shipped it; Cursor is still rolling it out. Tools that need sampling degrade gracefully to "return the prompt for the agent to run" on hosts without support.
- CI-only teams with no agent host attached cannot use LLM-assisted features. That's a real gap — but it's a gap the right pattern is to close *later*, based on actual user demand, not by shipping a parallel prompt library that bit-rots.
- In-house JSON-RPC is ~200 lines we maintain. Breakages in the protocol spec are on us to track. The protocol is stable; this has been a non-issue so far.

## Alternatives considered

**`@modelcontextprotocol/sdk` runtime dep.** Rejected — breaks ADR 0001. Also ties us to a specific library version, not the protocol.

**`ra11y --fix` with a bundled Anthropic client.** Rejected. Reasons, in order:
1. Carves a hole in `src/` network isolation.
2. Duplicates surface every agent host already runs (cache, retry, rate limit, key management).
3. Ages badly — the prompt library has to track model releases.
4. Loses the UX fight against native agent hosts.

The historical handoff doc (`.claude/handoff-mcp-and-agent.md` §Part 2) is kept for context but its Part 2 is superseded by this ADR.

**Wait for OpenAI / LangChain to ship equivalents.** Rejected. MCP is where the agent industry is converging.

## Follow-up work (Phase 20 in backlog)

- `src/mcp/sampling.ts` — client helper for `sampling/createMessage` with budget + timeout enforcement.
- Three sampling-backed tools: `tool-resolve-component.ts`, `tool-verdict-candidate.ts`, `tool-draft-vpat-narrative.ts`.
- Versioned prompt library under `src/mcp/prompts/` — pure strings, checksum registry, lazy-loaded.

## See also

- [`docs/kb/architecture/mcp-server.md`](../kb/architecture/mcp-server.md) — the runtime walkthrough of the in-house server.
- [`.claude/notes/mcp-iteration.md`](../../.claude/notes/mcp-iteration.md) — the ~25 rounds of agent iteration that produced the shipped toolset, plus the pivot-from-`--fix` rationale.
- [`docs/kb/patterns/using-mcp-from-agents.md`](../kb/patterns/using-mcp-from-agents.md) — the other side: how an agent should call these tools.
