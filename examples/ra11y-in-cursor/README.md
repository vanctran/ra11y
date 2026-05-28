# Example: ra11y in Cursor

A minimal reference for wiring the ra11y MCP server into a Cursor workspace and teaching the agent how to use it. Copy the `.cursor/mcp.json` file into the root of any project you want Cursor to audit for accessibility.

## What's here

| File | Purpose |
|---|---|
| [`.cursor/mcp.json`](./.cursor/mcp.json) | Registers the ra11y MCP server with Cursor at the workspace scope. Uses the explicit `npx -y --package=@ra11y/core ra11y --mcp` form so no global install is required. |

Cursor reads per-project MCP servers from `.cursor/mcp.json` at the workspace root, or globally from `~/.cursor/mcp.json`. See https://docs.cursor.com/context/model-context-protocol for the host-side reference.

## Install

From the root of the project you want Cursor to audit:

```sh
mkdir -p .cursor
cp path/to/this/example/.cursor/mcp.json .cursor/mcp.json
```

Restart Cursor (or reconnect the MCP server from Settings → Features → MCP). The ra11y tools will appear in Composer / Agent mode. Try:

> Run `scan_project` on this repo and walk me through what needs fixing.

## Host capabilities

Cursor's MCP client supports Tools, Prompts, Resources, Roots, and Elicitation (as of April 2026) but does **not** yet support MCP sampling (tracked at forum.cursor.com/t/mcp-sampling-support/149604). ra11y's surface was designed to stay deterministic end-to-end without sampling — every step grounds on a real file:line or a concrete fix proposal. Two tools in the flow (`verdict_candidate`, `draft_vpat_narrative`) *use* sampling when a host offers it, but gracefully degrade via `SamplingNotSupportedError` when it doesn't: they return a `promptForAgent` / `verdictPromptForAgent` string that Cursor can run against its own model and record the verdict or narrative inline. Nothing blocks on host sampling.

## The deterministic workflow

This is the inner loop Cursor's agent should walk for any "audit this codebase" or "fix the a11y issues in this file" request. All tool calls work on hosts that only implement MCP Tools (Cursor included). The sampling-backed steps degrade to inline prompts on Cursor; the workflow itself is identical to what a sampling-capable host would run.

1. **Scan.** Call `scan_project` with the project root. Pass `autoDetectWrappers: true` on the first call — this registers PascalCase design-system wrappers as native-element stand-ins for the scan, silencing the opaque-component false-positive tail without mutating session state. If the response's `warnings` array contains `scanned_zero_files`, `no_config_found`, `tailwind_detected_css_undercounted`, or `template_files_parsed_as_literal`, stop and read the message — the scan did not have teeth. Otherwise, the response gives you a rule-grouped summary plus the per-lane `plan.fixesByClass: { mechanical, guidance, runtimeOnly, verifyInSource }` tally (one key per remediation lane) and the `plan.actionableManualItems` / `plan.untargetedCriteria` split counters — each is an honest one-kind-per-key field.

2. **Triage the manual half.** Call `checklist`. The response's `actionableManualItems` array holds grounded candidates with `location.filePath` + `location.line` + `snippet`; `untargetedCriteria` holds bare criterion prompts where the scanner has no locator. Walk the actionable items first — each already ships with the question text in `reason`.

3. **Propose fixes.** For every violation you plan to act on, call `suggest_fix` with the violation's `findingId`. Response is either `kind: "edit"` (mechanical — `oldText` / `newText` pair ready for `apply_fix` or Cursor's Edit tool) or `kind: "guidance"` (authorial judgment required, optionally with a speculative `editCandidate` to verify in source).

4. **Probe opaque wrappers.** Call `detect_native_wrappers` once per project to see which PascalCase design-system components are native-element stand-ins — paste the `confirmed` list into `ra11y.config.ts` under `nativeWrappers` to keep them silenced across future scans without the per-call `autoDetectWrappers` flag.

5. **Explain the rule or criterion.** Use `explain_rule` for ra11y rule metadata (spec citation, rationale, fix template) and `explain_standard` for the normative criterion text. Both are deterministic reference lookups — no sampling involved.

6. **Verdict the candidates.** For each entry in `checklist.actionableManualItems`, call `verdict_candidate`. On Cursor (no sampling) the tool returns `status: "cannot_verdict"` with a `verdictPromptForAgent` string — run that prompt against Cursor's model and record the verdict yourself. Walk each `location.filePath` with Read at the cited line either way: the sampled verdict is grounding, not a gate. Propose a source-level pragma (`{/* ra11y-disable wcag22:X.Y.Z */}` for JSX, `<!-- ra11y-disable wcag22:X.Y.Z -->` for HTML, `/* ra11y-disable wcag22:X.Y.Z */` for CSS) for anything you dismiss.

7. **Draft the VPAT narrative.** For each criterion the scan touched, call `explain_standard` to retrieve the normative text, then `draft_vpat_narrative` with a `scanSummary` assembled from the prior responses. On Cursor the tool returns `{ narrative: "", reason: "sampling_unsupported", promptForAgent }` — run `promptForAgent` inline and use its output as the Remarks cell. Never emit conformance language the scan did not support.

## Rules of the road

- **Surface every finding; never post-hoc filter in your own output.** ra11y already prunes by `likelyIrrelevant` + `uniquePerCriterion`. If a candidate looks wrong, read the file at the cited line and dismiss it with a pragma, not by omission.
- **Pass the verbose meta through when you summarize.** `configSource`, `configSearchedFrom`, `activeNativeWrappers`, `rulesEvaluated`, `filesByExtension` are scan-confidence telemetry. They tell the user whether the scan had teeth. Don't trim them because the response feels long.
- **Check `warnings` before claiming "clean."** A response with `filesScanned: 0` is not a clean scan; it is a scan that never reached the codebase.
- **Respect the split counters.** `plan.fixesByClass.mechanical`, `.guidance`, `.runtimeOnly`, and `.verifyInSource` are separate on purpose — each describes categorically different remediation work. Never sum all four into a headline "fixes available" number. For the "apply-fix can batch this" subset, sum only the two editable lanes: `fixesByClass.mechanical + fixesByClass.verifyInSource`.
- **Use `nextStep` / `nextStepStructured` to chain calls.** Each response tells you the canonical next call.

## Configuration (optional)

Project defaults live in `ra11y.config.ts` at the repo root. The server re-reads it on every tool call — edits take effect without reconnecting. Generate a starter with `npx @ra11y/core --init`.

Per-session overrides (without editing the config file) go through `sessionConfigure`:

```json
{
  "name": "sessionConfigure",
  "arguments": {
    "standard": "wcag22",
    "level": "AA",
    "nativeWrappers": ["Button", "Link", "TextField"]
  }
}
```

Session state applies to subsequent tool calls in the same MCP connection and is discarded when the connection closes.

## Why this shape

The workflow above is deterministic end-to-end on any MCP host that implements Tools — including Cursor, which currently declines sampling. Steps 1–5 never touch sampling; steps 6–7 fall through `SamplingNotSupportedError` to an inline prompt Cursor runs against its own model. The degraded path is the hot path on Cursor today; when Cursor ships sampling, the same tool calls upgrade in place without workflow changes.

If you want a bigger tool surface (ecosystem bootstrap, baseline, attestations), the full canonical inventory is discoverable via `tools/list` on the server. The tools called out above are the v1 inner loop — start there.

## Related

- [`docs/mcp/server-setup.md`](../../docs/mcp/server-setup.md) — host-matrix setup (Claude Code, Cursor, Zed)
- [`docs/mcp/tool-reference.md`](../../docs/mcp/tool-reference.md) — every tool, its inputs, its outputs
- [`docs/kb/architecture/mcp-server.md`](../../docs/kb/architecture/mcp-server.md) — how the server is built internally
- [`docs/kb/architecture/ai-first-consumer.md`](../../docs/kb/architecture/ai-first-consumer.md) — the doctrine the tool responses are shaped against
- [`examples/ra11y-in-claude-code/`](../ra11y-in-claude-code/) — sibling example for Claude Code (`.mcp.json` + project-level `CLAUDE.md`)
