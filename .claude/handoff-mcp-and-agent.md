# Handoff: MCP Server + Agent Workflow for ra11y

> **Historical. Part 2 superseded 2026-04-12.** Phase 1 (the MCP server) shipped. Part 2 proposed a standalone `ra11y --fix` command with its own Anthropic API key and prompt library; that path was dropped in favor of **MCP sampling** — the server delegates LLM work to the host (Claude Code / Cursor / …), which owns the model and the key. See `.claude/notes/mcp-iteration.md` ("Pivot" section) and Phase 20 in `.claude/backlog.md` for the current plan. Read Part 2 below only for historical context.

## Context

ra11y is a multi-standard accessibility scanner (WCAG 2.2/2.1, Section 508, EN 301 549) with 36 rules, zero runtime dependencies, and an agent-optimized output format (`--format agent`). It runs as a CLI tool at `/Users/van/dev/ra11y`.

The static scanner works well for codebases with obvious violations (`<div onClick>`, missing alt text, no labels). But on well-maintained React codebases with component abstractions, it produces false positives because it can't see through JSX component boundaries. An agent CAN — it reads the component source and resolves what the scanner can't.

**The scanner is the eyes. The agent is the hands and brain. Build both integration paths.**

## What exists today

- 36 rules across 16 domains (aria, contrast, document, focus, forms, keyboard, layout, media, motion, navigation, parsing, pointer, semantics)
- `--format agent` outputs compact JSON with plan summary, file-grouped findings with fix confidence, and 88 review candidates with tier-1/2/3 evaluation prompts
- 5 candidate finders for assisted manual review (media-alternatives, meaningful-sequence, sensory-characteristics, no-keyboard-trap, on-input-change)
- Severity tiers: error (definitely wrong), warning (probably wrong), info/note (can't verify — check it)
- 843 tests, zero runtime deps, all invariants enforced

Key files to read first:
- `CLAUDE.md` — project invariants, architecture, conventions
- `src/engine/scanner.ts` — the scan engine
- `src/output/formatters/agent.ts` — the agent-optimized JSON format
- `src/review/evaluation-prompts.ts` — tier-1/2/3 evaluation prompts for manual criteria
- `src/types/review.ts` — ReviewCandidate, CandidateFinder types
- `src/cli/args.ts` — CLI flag definitions
- `docs/architecture.md` — three-layer model overview

## Part 1: MCP Server

### What to build

An MCP server bundled with the CLI, activated via `ra11y --mcp` or `ra11y mcp`. Uses stdio transport (simplest, works with Claude Code and Cursor out of the box).

### Research summary (already completed)

The research agent recommended 8 tools. Here's the refined spec:

**Tool 1: `scan`**
```
Input:  { paths: string[], standard?: string, level?: "A"|"AA"|"AAA" }
Output: { plan: { totalFindings, autoFixable, reviewNeeded, summary }, 
          files: [{ path, findings: [{ ruleId, severity, line, column, message, fix }] }],
          meta: { filesScanned, durationMs } }
```
The workhorse. Returns the same shape as `--format agent` but scoped to the requested paths. Keep the scanner warm between calls — parse once, cache ASTs, reuse on re-scan.

**Tool 2: `scan_file`**
```
Input:  { path: string, standard?: string, level?: string }
Output: { findings: [...], reviewCandidates: [...] }
```
Single-file scan for the iterative fix loop. Sub-10ms latency with cached ASTs.

**Tool 3: `explain_rule`**
```
Input:  { ruleId: string }
Output: { id, description, rationale, normativeQuote, goodExample, badExample, references[], satisfies[] }
```
Full context for a rule. The agent calls this when it encounters a finding it doesn't understand.

**Tool 4: `suggest_fix`**
```
Input:  { ruleId: string, file: string, line: number, sourceContext: string }
Output: { oldText: string, newText: string, explanation: string, confidence: "high"|"medium"|"low" }
```
Given the source context around a violation, returns a concrete search-and-replace fix. This is the key tool that makes the agent workflow fast — the agent doesn't have to figure out the fix itself.

**Tool 5: `coverage`**
```
Input:  { paths: string[], standard?: string, level?: string }
Output: { score: number, criteriaTotal, criteriaCovered, criteriaPassing, gaps: [...] }
```
"Are we done?" The agent calls this after fixing violations to check overall compliance.

**Tool 6: `checklist`**
```
Input:  { paths: string[], standard?: string, level?: string }
Output: { items: [{ criterionId, title, level, tier, question?, passCriteria?, candidates: [...] }] }
```
Returns the manual review checklist with evaluation prompts and candidate locations. The agent works through tier-1 items autonomously, flags tier-2 for human review.

**Tool 7: `list_rules`**
```
Input:  { standard?: string }
Output: { rules: [{ id, description, severity, satisfies }] }
```
Discovery tool. Agent calls once to understand what ra11y checks.

**Tool 8: `configure`**
```
Input:  { standard?: string, level?: string, exclude?: string[] }
Output: { active: { standard, level, ruleCount } }
```
Sets session defaults so subsequent calls don't repeat params.

### Architecture

```
src/mcp/
  server.ts          — MCP server entry point, JSON-RPC over stdio
  tools.ts           — tool definitions (name, description, inputSchema, handler)
  session.ts         — session state (config, cached ASTs, warm scanner)
```

**Key design decisions:**
- Zero new dependencies. Implement JSON-RPC over stdio in-house (it's ~100 lines — read line, parse JSON, dispatch, write response). Do NOT use `@modelcontextprotocol/sdk`.
- Keep the scanner warm. On first `scan`, parse all files and cache the ASTs in the session. Subsequent `scan_file` calls reuse cached ASTs. This makes the fix-verify loop sub-10ms.
- Tool descriptions are the UX. Each tool needs a 2-3 sentence description that tells the agent what it does, when to use it, and one key constraint. These descriptions cost tokens on every tool-list call.
- Annotations on every tool: `readOnlyHint: true` on scan/explain/list/coverage/checklist. `idempotentHint: true` on everything. This lets Claude Code auto-approve read-only calls.
- Server instructions at init: "Start with `scan` to find violations. Use `explain_rule` if the fix is unclear. Use `suggest_fix` to get a code patch. Re-scan to verify. Use `coverage` to check overall compliance."

**CLI wiring:**
- `ra11y --mcp` or `ra11y mcp` starts the server on stdio
- Add `"mcp"` to the command union in `src/cli/args.ts`
- Entry in `src/cli/run.ts` dispatches to `src/mcp/server.ts`

**Configuration for Claude Code** (`.mcp.json` at project root):
```json
{
  "mcpServers": {
    "ra11y": {
      "command": "npx",
      "args": ["@ra11y/core", "--mcp"],
      "type": "stdio"
    }
  }
}
```

### Tests

- `tests/unit/mcp/server.test.ts` — test JSON-RPC message parsing, tool dispatch, error handling
- `tests/unit/mcp/tools.test.ts` — test each tool handler with synthetic inputs
- `tests/integration/mcp-session.test.ts` — spawn the server as a subprocess, send scan + explain + suggest_fix + re-scan sequence, verify the full loop

## Part 2: Built-in Agent Workflow (`ra11y --fix`)

### What to build

A command that runs the scan, then uses an LLM to resolve findings:

```sh
ra11y --fix src/ --standard wcag21 --level AA
```

The workflow:
1. Run the scan → get findings + review candidates
2. For each error/warning finding:
   a. Read the source file around the violation
   b. If the finding is on a PascalCase component, read the component source to verify
   c. If the finding is real, apply the fix
   d. If the finding is a false positive (component wraps native element), skip and note why
3. For each tier-1 review candidate:
   a. Read the source context
   b. Answer the evaluation question using the pass/fail criteria
   c. Report pass/fail with reasoning
4. Re-scan to verify fixes didn't introduce new issues
5. Output a summary: N findings fixed, M false positives skipped, K manual items evaluated

### Architecture

```
src/agent/
  workflow.ts        — orchestrates the fix workflow
  llm.ts             — LLM client abstraction (Claude API, configurable)
  verifier.ts        — re-scans after fixes to confirm
  reporter.ts        — produces the summary report
```

**Key design decisions:**
- The LLM client is a thin abstraction over the Anthropic API. Users provide their API key via `RA11Y_API_KEY` or `ANTHROPIC_API_KEY` env var.
- The workflow is deterministic: scan → triage → fix → verify → report. No agentic loops or retries.
- Component verification: when a finding is on a PascalCase component, the workflow reads the component file (following the import) and checks if it renders a native interactive element. This is the key capability that static analysis lacks.
- The `--fix` flag is opt-in. Default `ra11y src/` still does static analysis only.
- The LLM is used ONLY for: (a) reading component sources to verify findings, (b) evaluating tier-1 manual criteria, (c) generating fix suggestions when the rule's built-in suggestion isn't sufficient. It is NOT used for scanning — the scanner is always the deterministic rule engine.

**This is a v0.2.0 feature.** The MCP server should ship first (v0.1.0) because it enables the workflow without ra11y owning the LLM integration. `--fix` is the turnkey version for teams that want one command.

## Build order

### Phase 1: MCP Server (ship in v0.1.0)
1. `src/mcp/server.ts` — JSON-RPC stdio transport
2. `src/mcp/session.ts` — session state + AST cache
3. `src/mcp/tools.ts` — 8 tool handlers
4. CLI wiring (`args.ts`, `run.ts`)
5. Tests (unit + integration)
6. `.mcp.json` example in project root
7. README section on MCP setup

### Phase 2: Agent Workflow (ship in v0.2.0)
1. `src/agent/llm.ts` — Anthropic API client
2. `src/agent/workflow.ts` — scan → triage → fix → verify → report
3. `src/agent/verifier.ts` — re-scan after fixes
4. `src/agent/reporter.ts` — summary output
5. CLI wiring for `--fix`
6. Tests
7. Docs

## Constraints (non-negotiable)

- `dependencies: {}` stays empty. The MCP server uses in-house JSON-RPC. The agent workflow's LLM client is a thin fetch wrapper (allowed as a dynamic import, not a runtime dep).
- Actually wait — `src/` cannot use `fetch` per the network isolation invariant. The agent workflow's LLM client must live in `src/agent/` which needs a carve-out in `scripts/check-network-isolation.ts` for `src/agent/` only, documented as "agent mode requires network access to call the LLM API."
- Every MCP tool handler is a pure function over the scanner's output. No MCP-specific logic in `src/engine/`.
- Tests must cover the MCP JSON-RPC protocol (initialize, tools/list, tools/call, error handling).
- Biome complexity max 15, file max 500 lines, zero circular deps.
- Conventional commits. One logical change per commit.

## Current state to be aware of

- 843 tests passing across 57 files
- `bun run verify` runs: typecheck + lint + test + check-deps + check-limits + check-cycles
- The pre-commit hook runs the full verify suite
- Build pipeline: `scripts/build.ts` (Bun.build + tsc declarations)
- Performance: 1000 files in ~112ms, cold start ~25ms

## What success looks like

After Phase 1, a developer adds this to their project:
```json
// .mcp.json
{ "mcpServers": { "ra11y": { "command": "npx", "args": ["@ra11y/core", "--mcp"] } } }
```

Then in Claude Code:
```
User: "Check this file for accessibility issues"
Claude: [calls ra11y.scan_file({ path: "src/Button.tsx" })]
        [reads the 2 findings]
        [calls ra11y.explain_rule({ ruleId: "semantics/button-name" })]
        [reads the component source to verify]
        "Found 1 real issue: the icon-only button needs aria-label. The other finding 
         is fine — ActionButton wraps a native <button>."
        [applies the fix]
        [calls ra11y.scan_file({ path: "src/Button.tsx" })]
        "Fixed. The file is now clean."
```

That's the product. The scanner finds patterns. The agent resolves them. Zero false positives in the final output because the agent verified each one.
