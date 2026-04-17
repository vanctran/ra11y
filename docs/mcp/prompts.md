---
title: "MCP prompt library"
audience: agent authors, users
---

# MCP prompt library

Pre-built accessibility workflows are repetitive: scan the project, read each finding in context, decide pass/fail, optionally write a VPAT paragraph. Encoding that sequence once as a prompt lets any MCP host surface it to an agent without requiring the user to assemble the steps by hand.

ra11y ships a set of these prompt templates. The server advertises them via the standard `prompts/list` / `prompts/get` methods, so any MCP-compatible host — Claude Code, Cursor, Zed, Continue — picks them up automatically without additional configuration.

For how the MCP server is structured, see [`docs/kb/architecture/mcp-server.md`](../kb/architecture/mcp-server.md). For setup, see [`server-setup.md`](./server-setup.md).

## Using prompts from an MCP host

### Discovering prompts

Send a `prompts/list` request after the server handshake:

```jsonc
// Request
{ "jsonrpc": "2.0", "id": 1, "method": "prompts/list" }

// Response
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "prompts": [
      {
        "name": "ra11y/triage",
        "description": "Run a full ra11y triage pass: scan the project, read each finding in context, verdict fail/dismiss per candidate, and return a compact summary.",
        "arguments": [
          { "name": "focus", "description": "...", "required": false }
        ]
      },
      // … remaining prompts
    ]
  }
}
```

The `prompts: { listChanged: false }` capability in the `initialize` response means the server never sends `notifications/prompts/list_changed` — the inventory is compiled in at build time and does not change at runtime.

### Fetching and injecting a prompt

Send a `prompts/get` request with the prompt `name` and any `arguments`:

```jsonc
// Request
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "prompts/get",
  "params": {
    "name": "ra11y/triage",
    "arguments": { "focus": "wcag22:1.4.3" }
  }
}

// Response
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "description": "Run a full ra11y triage pass …",
    "messages": [
      {
        "role": "user",
        "content": {
          "type": "text",
          "text": "You are triaging accessibility findings produced by ra11y. Work in order:\n…"
        }
      }
    ]
  }
}
```

The `messages` array is ready to inject directly into a model conversation. Each message has a `role` (`"user"` or `"assistant"`) and a `content` object of `{ type: "text", text: string }`.

Requesting an unknown prompt name returns a `METHOD_NOT_FOUND` error (`-32601`) — the same code tools use for unknown tool names:

```jsonc
{
  "jsonrpc": "2.0",
  "id": 3,
  "error": { "code": -32601, "message": "Unknown prompt: ra11y/does-not-exist" }
}
```

### Claude Code slash commands

Claude Code exposes prompts retrieved from connected MCP servers as slash commands under the pattern `/mcp__<server-name>__<prompt-name>`. With ra11y connected as `"ra11y"` in `.mcp.json`, the prompts appear as:

- `/mcp__ra11y__ra11y/triage`
- `/mcp__ra11y__ra11y/fix`
- `/mcp__ra11y__ra11y/audit`
- `/mcp__ra11y__ra11y/vpat-narrative`

Invoking a slash command opens an argument-fill UI for any declared arguments, then passes the rendered `messages` to the agent context.

## Prompt inventory

### `ra11y/triage`

Guides an agent through a full scan-to-verdict loop: runs `scan_project`, fetches the `checklist`, reads each finding in file context, emits a `fail`/`dismiss`/`investigate` verdict, and returns a compact summary.

**Arguments:**

| Name | Required | Description |
|------|----------|-------------|
| `focus` | no | Criterion ID (e.g. `wcag22:1.4.3`) or rule ID (e.g. `contrast/minimum`) to restrict triage to. Omit to triage all findings. |

**Rendered output shape (abridged):**

```
You are triaging accessibility findings produced by ra11y. Work in order:

1. Call `scan_project` with the project root. Pass `verboseMeta: true` so you
   see `configSource`, `activeNativeWrappers`, `rulesEvaluated`, and
   `filesByExtension` — those are scan-confidence telemetry; cite them in the
   summary.
2. Call `checklist` to enumerate manual-review criteria grounded in file:line
   candidates.
…
For each finding or candidate:
- Use `Read` on the cited file around the line to see the surrounding JSX/HTML/CSS.
- Emit a verdict: `fail`, `dismiss`, or `investigate`.
- If `dismiss`, propose the source-level pragma …
…
Return this shape as your final message:
- A top-level `summary` with total findings scanned, total verdicted `fail`,
  total `dismiss`, total `investigate`.
- A `verdicts` array of `{ file, line, ruleOrCriterion, verdict, reason }`.
- A `scanConfidence` object echoing the meta you cited.
```

When `focus` is provided, line 4 of the instructions reads "Restrict triage to findings and candidates matching `<focus>`. Skip everything else."

---

### `ra11y/fix`

Guides an agent through a single-finding fix loop: fetches `suggest_fix`, performs a mandatory `dryRun: true` gate, applies the edit with `dryRun: false`, then rescans the file to confirm the violation no longer fires.

**Arguments:**

| Name | Required | Description |
|------|----------|-------------|
| `findingId` | no | Identifier of a specific finding to fix, e.g. `contrast/minimum@src/Button.tsx:42`. Omit and the agent picks the highest-confidence unfixed `error`-severity finding from a fresh scan. |

**Rendered output shape (abridged):**

```
You are applying a single ra11y fix. Work in order; do not skip the dry-run.

1. <select target — either the explicit findingId or highest-confidence error>
2. Call `suggest_fix` with `{ ruleId, file, line }`. Inspect the response:
   - `kind: "edit"` → proceed to step 3.
   - `kind: "guidance"` → compose from `sourceContext` + `explanation`, or
     return `{ status: "manual-only", guidance }`.
   - `kind: "none"` → the finding has moved; rescan and pick a new target.
3. Call `configure` with `allowWrite: true` before any disk write.
4. Call `apply_fix` with `dryRun: true`. Read back `preview`. Do not proceed
   if preview touches code outside the reported line range, or if `newText`
   is empty.
5. Call `apply_fix` with `dryRun: false`. Confirm `applied: true`.
6. Call `scan_file` on the edited path. Confirm the original ruleId no longer
   fires on that line.

Return: `{ status, finding, edit?, rescan? }`.
```

---

### `ra11y/audit`

Runs a full conformance audit for a standard: calls `audit` (the one-shot meta-tool), walks the `checklist` per criterion, reads each candidate, and emits a coverage summary with VPAT-ready notes suitable as seed input for `ra11y/vpat-narrative`.

**Arguments:**

| Name | Required | Description |
|------|----------|-------------|
| `standard` | no | Standard ID to audit against: `wcag22`, `wcag21`, `section508`, `en301549`. Defaults to `wcag22`. |

**Rendered output shape (abridged):**

```
You are running a conformance audit against `wcag22`. Work in order:

1. Call `configure` with `{ standard: "wcag22" }`.
2. Call `audit` with the project root. Read its response end to end.
3. For each criterion flagged `manualReviewRequired` or `partial`, fetch
   detail via `checklist` filtered to that criterion.
4. Walk every file:line candidate. Use `Read` to verify or dismiss.
5. For each criterion, classify status as one of: `supports`,
   `partially-supports`, `does-not-support`, `not-applicable`,
   `not-evaluated`.

Return:
- `standard`: echo back.
- `coverage`: `{ automatedCriteriaEvaluated, manualCriteriaReviewed,
  runtimeOnlyCriteria }`.
- `criteria`: array of `{ criterionId, level, status, evidence }`.
- `vpatNotes`: array of `{ criterionId, remark }` — first-draft VPAT cell
  text, one paragraph each.
```

---

### `ra11y/vpat-narrative`

Drafts the VPAT "Remarks and explanations" cell for a single criterion, grounded in scan and checklist output. The cell is a prose paragraph (no bullets), leading with the conformance verdict and citing specific `file:line` locations for any non-`Supports` finding.

**Arguments:**

| Name | Required | Description |
|------|----------|-------------|
| `criterionId` | **yes** | Criterion ID to draft the Remarks cell for, e.g. `wcag22:1.4.3` or `section508:1194.22.c`. |
| `tone` | no | Register for the narrative: `professional` (standard VPAT phrasing), `plain` (short sentences, no jargon), `technical` (spec language permitted). Defaults to `professional`. |

**Rendered output shape (abridged):**

```
You are drafting the VPAT `Remarks and explanations` cell for criterion
`wcag22:1.4.3`. Tone: `professional`.

Work in order:
1. Call `explain_standard` with `{ criterionId: "wcag22:1.4.3" }` …
2. Call `coverage` with `{ criterionId: "wcag22:1.4.3" }` …
3. Call `checklist` filtered to `wcag22:1.4.3` …
4. Synthesize automated result + manual-review verdicts into one paragraph.
   Cite specific `file:line` locations. Do not hedge with `may`/`might`
   when the scanner produced a concrete verdict.

Paragraph rules:
- One paragraph, 2–5 sentences. No bullet lists.
- Lead with the conformance verdict.
- No marketing language. Factual, auditor-ready.

Return: `{ criterionId, verdict, remark, citations }`.
```

`ra11y/audit` produces `vpatNotes` first drafts; pass them into `ra11y/vpat-narrative` per criterion to produce polished, grounded VPAT cell text.

## Argument coercion

All prompt argument values must be strings per the MCP spec. If a host passes a `boolean` or `number` (e.g. `{ "dryRun": true, "count": 3 }`), `coercePromptArgs` in `src/mcp/server.ts` silently converts them via `String()`. Object and array values are dropped. To avoid surprises, hosts should pass string values directly — `"true"` instead of `true`, `"3"` instead of `3`.

## Extending the library

The prompt shape is defined in `src/mcp/prompts/types.ts`. Each prompt implements a `render(args: Record<string, string>) => PromptMessage[]` function that returns the final message array. `BUILTIN_PROMPTS` in `src/mcp/prompts/index.ts` is the single registration point — adding a prompt means exporting it from a new file and appending it to that array.

ra11y does not currently support user-defined prompts loaded at runtime (no config key, no plugin hook). That surface is planned for a future release (v0.3.0+). Until then, the escape hatch is a fork or a wrapper server that extends `BUILTIN_PROMPTS` before starting.

## See also

- [`tool-reference.md`](./tool-reference.md) — the tools these prompts orchestrate.
- [`server-setup.md`](./server-setup.md) — connecting a host to the ra11y MCP server.
- [`docs/kb/architecture/mcp-server.md`](../kb/architecture/mcp-server.md) — internal server architecture, capability negotiation, and the stdio loop.
- [`docs/kb/architecture/mcp-sampling.md`](../kb/architecture/mcp-sampling.md) — how ra11y requests host-side model calls via `sampling/createMessage`, which these prompts are designed to pair with.
- [`docs/adr/0005-in-house-mcp-server.md`](../adr/0005-in-house-mcp-server.md) — the decision to ship ra11y's own MCP server rather than use a framework.
