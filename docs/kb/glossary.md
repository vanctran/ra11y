---
title: "Glossary"
topic: reference
audience: agents, contributors, users
---

# Glossary

ra11y and accessibility terms that come up in the code and docs. Alphabetical.

## Accessible name

The name a screen reader announces for an element. Computed from (in priority order) `aria-labelledby` → `aria-label` → associated `<label>` → element contents → `title` attribute → fallback. An empty accessible name is the single most common accessibility bug; most WCAG 4.1.2 failures are accessible-name failures.

## Candidate finder

The structural parallel of a rule for assisted manual review. Lives in `src/review/finders/`. A finder walks an AST and emits `ReviewCandidate` records — locations a human reviewer should examine for a specific manual-review criterion. Distinguished from rules by emitting candidates (no pass/fail claim) instead of violations.

## Criterion

A single conformance requirement in a standard — e.g. `wcag22:1.4.3`. Standards declare criteria; rules cite the criteria they satisfy. See [three-layer-model.md](./architecture/three-layer-model.md).

## `equivalentTo`

A criterion's list of semantically equivalent criterion IDs in other loaded standards. `wcag22:1.1.1` and `section508:1194.22.a` are equivalent; the `section508` criterion declares `equivalentTo: ["wcag22:1.1.1"]`, and ra11y's engine fans rule coverage across the equivalence class automatically. See [ADR 0002](../adr/0002-three-layer-standards-criteria-rules.md).

## Landmark

An HTML5 / WAI-ARIA element that exposes page structure to assistive tech: `<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>`, `<section>` (with a label), `<form>` (with a label). Screen-reader users navigate by jumping between landmarks.

## Manual review

A conformance criterion that static analysis cannot fully evaluate. Examples: "audio description is provided for prerecorded video content" (requires watching the video). ra11y surfaces these through the `checklist` report and the `review_candidates` MCP tool with the candidate's source location and review prompt.

## MCP

Model Context Protocol — the JSON-RPC-over-stdio standard that agent hosts (Claude Code, Cursor, Zed, …) use to expose tools to agents. ra11y ships an MCP server at `src/mcp/` that exposes 12 accessibility tools. See [`docs/kb/architecture/mcp-server.md`](./architecture/mcp-server.md).

## `nativeWrappers`

A config knob. PascalCase React components that are thin wrappers around a native interactive element (`<Button>` wrapping `<button>`, `<Link>` wrapping `<a>`). Listing them here quiets false positives in rules like `keyboard/handler-missing` that would otherwise flag `<Button onClick>` as a div with a click handler.

## Rule

A pure function over a single file's AST that emits zero or more violations. Lives in `src/rules/<domain>/<name>.ts`. A rule declares the criterion IDs it satisfies; it never knows about standards.

## Sampling (MCP)

The MCP capability where a server asks the host to run an LLM completion on its behalf. The host supplies the model and the key; the server supplies the prompt. ra11y uses sampling for LLM-assisted features (Phase 20) so it never needs to hold an API key. See [ADR 0005](../adr/0005-in-house-mcp-server.md).

## Satisfies

A rule's declaration of which criteria it covers: `satisfies: ["wcag22:1.1.1", "wcag21:1.1.1"]`. The engine plus the `equivalentTo` closure fan this out across every loaded standard.

## Severity

`error` (must-fix), `warning` (should-fix), `info` (observation worth source-reading to verify). Info is **not** ignorable — it's the layer where source-reading from a human or agent resolves what static analysis can't.

## Standard

A conformance framework — WCAG 2.2, Section 508, EN 301 549, etc. Declared as pure data in `src/standards/<id>/`. Contains metadata (id, name, version, URL, levels) plus a list of criteria.

## VPAT

Voluntary Product Accessibility Template. The federal-procurement artifact teams generate to claim WCAG / Section 508 conformance when selling software to government agencies. ra11y's `vpat` report produces one; `ra11y --vpat` is the CLI entry point.

## Zero-dep

ra11y's install invariant: `package.json.dependencies` is empty. Every primitive (colors, parsers, glob, arg parsing) is implemented in-house. See [ADR 0001](../adr/0001-zero-runtime-dependencies.md).
