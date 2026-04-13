---
title: "Reports: coverage, checklist, VPAT, certification"
topic: architecture
audience: agents, contributors
---

# Reports

ra11y ships four **report** kinds that sit alongside the raw scan result. They transform findings + rule metadata + standard data into the artifacts a compliance program actually needs: a coverage table, a manual-review checklist, a VPAT, and a certification-readiness scorecard.

Reports are pure functions over `ScanResult` and the loaded registries. They never scan files themselves.

## The four reports

### `coverage` (`src/reports/coverage.ts`)

Per-standard summary: `{ standardId, automated, total, passing, failing, manualReviewRequired }`.

- `automated` — criteria the rule engine can fully check.
- `total` — criteria in the standard at the requested level.
- `passing` — criteria with zero active violations.
- `failing` — criteria with at least one active violation.
- `manualReviewRequired` — criteria whose `automatable: "manual"` or `"partial"` metadata says "a human has to look."

Drives:
- `--coverage` CLI output
- The top of `markdown` / `html` formatter output
- The MCP `coverage` tool

### `checklist` (`src/reports/checklist.ts`)

The manual-review half of the scan. Groups criteria needing human judgment into sections with their review prompts and candidate source locations.

The tricky part is the relevance hint: a criterion like `1.2.2 Captions (Prerecorded)` is irrelevant on a codebase with no `<video>` elements. The report runs element-presence detection and marks items `likelyRelevant: false` when the supporting elements aren't present. Agents driving a manual-review loop use this hint to triage.

Drives:
- `--checklist` CLI output
- The MCP `checklist` and `review_candidates` tools

### `vpat` (`src/reports/vpat.ts`)

Voluntary Product Accessibility Template — the federal-procurement artifact teams generate when selling software to government agencies. Produces one row per criterion in the target standard with a conformance verdict (`Supports`, `Partially Supports`, `Does Not Support`, `Not Applicable`) and a remarks cell.

The verdict is derived deterministically from scan state:
- No violations + fully automatable → `Supports`.
- At least one error + fully automatable → `Does Not Support`.
- Partially automatable → `Partially Supports` unless the automated half is clean.
- Not applicable (element-presence check says the codebase doesn't use the feature) → `Not Applicable`.

The remarks cell is bare today; Phase 21 adds an optional sampling-backed `draft_vpat_narrative` tool that lets an agent fill that in.

### `certification` (`src/reports/certification.ts`)

A readiness scorecard: percentage of criteria that pass, number that need manual review, number that are failing, plus a traffic-light per criterion. Output is designed to be pasted into a quarterly a11y readout — not to be a conformance claim itself, but to show whether you're *ready* to make one.

## Wire shape

Every report exports two things:

```ts
export function buildXReport(result, report, standards, level): XReport;
export function renderXMarkdown(report): string;
```

`buildXReport` is the structural form (consumable by formatters, tests, and MCP tool handlers). `renderXMarkdown` is the human-readable form used by the CLI commands and by the `markdown` formatter when the user passes `--vpat`, `--checklist`, etc.

## Invariants

- **Reports are pure.** No I/O, no scanning, no rule execution.
- **Reports depend on standards metadata, not just scan results.** Which criteria need manual review is a property of the standard, not the scan.
- **Reports filter by level.** A user asking for `--level AA` doesn't want AAA criteria in the coverage table.
- **Reports never invent verdicts beyond the data.** If the scanner didn't check a criterion (because no rule satisfies it), the report says so. It doesn't guess.

## See also

- `src/cli/commands/coverage.ts`, `checklist.ts`, `vpat.ts`, `certification.ts` — the CLI wiring.
- `src/mcp/tool-checklist.ts`, `tool-review-candidates.ts` — the MCP wiring.
- [`docs/certification/vpat-mapping.md`](../../certification/vpat-mapping.md) — how criteria map to VPAT verdicts in detail.
