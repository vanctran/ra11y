---
title: "MCP tool reference"
audience: users, agents
---

# MCP tool reference

Every tool the ra11y MCP server exposes, with inputs, outputs, and when to reach for it.

For setup: [`server-setup.md`](./server-setup.md). For architecture: [`docs/kb/architecture/mcp-server.md`](../kb/architecture/mcp-server.md).

## Discovery

### `list_rules`

Returns the full rule catalog with metadata.

**Use when:** the agent needs to know what ra11y can check for, or the user asks "what rules does ra11y ship?"

### `explain_rule`

Takes a `ruleId`. Returns the rule's full metadata: WCAG normative quote, rationale, good/bad examples, references.

**Use when:** resolving a violation and the agent needs the spec context to write a good fix.

### `explain_standard`

Takes a `standardId` (e.g. `wcag22`) and optional `level`. Returns the standard's metadata and criterion list, filtered to that level.

**Use when:** drafting a VPAT, comparing coverage across standards, or picking criteria for a manual-review pass.

## Scanning

### `scan`

Scans explicit paths. Required: `paths: string[]`. Optional: `standard`, `level`, `minSeverity`, `cwd`.

**Use when:** the agent has a specific set of files to check (e.g. the ones it just edited).

**Mixed files and directories:** each entry in `paths` can be a file path or a directory path, and a single call can mix both. The scanner resolves directories recursively and merges them with any explicit file entries before scanning.

```jsonc
// Mix a changed file with a directory in one call:
{ "paths": ["src/components/Button.tsx", "src/forms/"] }
```

**Default `minSeverity`:** `info` — keep it. Info findings are exactly where the agent adds value by reading source code; filtering to `warning` ships false negatives.

### `scan_project`

Scans the whole project. `paths` optional — omit and the server auto-promotes to the git root. `changedOnly: true` or `since: "<git-ref>"` scope to diffs for CI-on-diff workflows.

**Use when:** first-pass triage of a new repo, or a CI check on a PR.

### `scan_file`

Single-file re-scan using the cached AST. Fast — skips parsing when mtime is unchanged.

**Use when:** the fix-verify loop after editing one file.

## Triage

### `detect_native_wrappers`

Heuristic tool for onboarding. Scans the codebase for PascalCase React components frequently paired with `onClick` — the candidates for `nativeWrappers` in `ra11y.config.ts`. Each candidate comes with a confidence score and example locations.

**Use when:** first-time setup on a React codebase. Populates the config knob that quiets false positives from `keyboard/handler-missing` on design-system wrappers.

### `suggest_fix`

Takes a finding; returns a structured fix where one exists. Confidence is `"high"` when the rule has a deterministic fix (e.g. adding a missing `alt=""` on a decorative image) and `"low"` when the fix is prose guidance (the agent has to tailor it).

**Use when:** about to edit a file to resolve a violation.

## Coverage & review

### `coverage`

Per-standard summary: automated, total, passing, failing, manual-review count. Level-filterable.

**Use when:** producing a status readout or deciding where to focus the next manual-review session.

### `checklist`

Manual-review criteria grouped by section, with review prompts and candidate locations. Items flagged `likelyRelevant: false` when the supporting elements don't exist in the codebase (e.g. media criteria on a repo with no `<video>`).

**Use when:** driving a human- or LLM-led manual review pass.

### `review_candidates`

The programmatic counterpart to `checklist`. Returns tier-1 candidates as a flat list with source snippets and the finder's exact `reviewPrompt`.

**Use when:** the agent wants to iterate candidates one-by-one, reading source + answering pass/fail per item.

### `suppress`

Writes a source-level `ra11y-disable-next-line` pragma above a target line so a specific finding stops firing on subsequent scans. Required inputs: `file`, `line` (1-based), `ruleId` (rule ID like `keyboard/handler-missing` or criterion ID like `wcag22:2.4.5`), `reason` (non-empty justification).

Like `apply_fix`, this is a mutating tool — the session must have `allowWrite: true` (set via `sessionConfigure`) or the call rejects with `allow-write-disabled`. Reason text is REQUIRED; a missing or whitespace-only reason rejects with `reason-required` rather than silently writing a bare pragma.

Comment shape per extension:

- `.tsx` / `.jsx` → `{/* ra11y-disable-next-line <id>: <reason> */}`
- `.ts` / `.js` → `// ra11y-disable-next-line <id>: <reason>`
- `.html` / `.htm` → `<!-- ra11y-disable-next-line <id>: <reason> -->`
- `.css` → `/* ra11y-disable-next-line <id>: <reason> */`

The pragma is inserted on its own line directly above the target, with indentation matching the target line so the comment stays visually grouped with the code it suppresses. Error envelopes: `file-not-found`, `line-out-of-range`, `file-unsupported`, `path-escapes-cwd`, `allow-write-disabled`, `reason-required`.

**Use when:** an agent has read the finding, determined it's a false positive or intentional exception, and wants a durable source-level dismissal (so the next scan passes without the agent re-justifying it).

## Session

### `configure`

Sets session-level config: `standard`, `level`, `exclude`, `rules` (per-rule severity overrides), `nativeWrappers`.

**Use when:** the user adjusts scope mid-session ("also run Section 508", "downgrade `contrast/enhanced` to info").

## Reading the output

Every tool returns `{ content: [{ type: "text", text: "<json>" }] }` where the JSON is the structured payload. Parse and inspect. For the `scan` family the top-level shape is:

```jsonc
{
  // No top-level pass boolean — see plan.summary and plan.totalFindings.
  "plan": { "totalFindings": number, "summary": string },
  "files": [
    {
      "filePath": string,
      "findings": [
        { "ruleId", "severity", "line", "column", "message", "suggestion", "criteria": [...] }
      ]
    }
  ],
  "meta": { "filesScanned", "configSource", "scannedRoot", ... }
}
```

## See also

- [`server-setup.md`](./server-setup.md) — how to wire this into your agent host.
- [`docs/kb/architecture/mcp-server.md`](../kb/architecture/mcp-server.md) — internal architecture.
- [`.claude/notes/mcp-iteration.md`](../../.claude/notes/mcp-iteration.md) — the decisions that produced this specific toolset.
