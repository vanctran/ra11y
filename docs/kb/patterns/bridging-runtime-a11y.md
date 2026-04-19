---
title: "Bridging runtime accessibility evidence into the attest ledger"
topic: pattern
audience: agents
---

# Bridging runtime accessibility evidence into the attest ledger

Static analysis covers what can be verified from source alone — missing alt text, unlabeled
form inputs, focusable elements without handlers. A significant slice of WCAG 2.2 AA cannot
be checked statically: live color contrast after CSS-in-JS applies, focus management inside
a modal, keyboard tab order in a rendered page. Runtime tools — axe-core, Lighthouse — close
that gap by running checks against a live browser.

ra11y does not ingest vendor runtime formats. The correct channel is the `attest` MCP tool:
the agent reads the runtime output, maps findings to WCAG criteria, and calls `attest` with
the verdict and reason. This keeps ra11y zero-dependency and vendor-neutral; the attestation
record carries the provenance (which tool, which run, which timestamp) in the `reason` field.

## Why no ingest adapter

A vendor-specific adapter would:
- Couple ra11y to the vendor's JSON schema (fragile on version bumps).
- Re-bucket findings in ways the consuming agent can't re-audit.
- Duplicate capability the agent already has via its own CI test harness.

The agent reads the report file with its existing Read tool and calls `attest`. The reason
text is the evidence; the attestation ledger is the durable, vendor-neutral channel.

## Prerequisites

Session `allowWrite: true` is required before `attest` will write to disk:

```jsonc
{ "name": "sessionConfigure", "arguments": { "allowWrite": true } }
```

## Step-by-step: axe-core → attest

### 1. Run axe-core in CI and save the JSON report

```bash
# Example with Playwright + axe-core; adapt to your runner.
npx playwright test --reporter=json | tee axe-report.json
```

Or directly via the axe-core Node API:

```ts
import { run } from "axe-core";
const results = await run(document);
writeFileSync("axe-report.json", JSON.stringify(results, null, 2));
```

### 2. Map axe rule IDs to WCAG criteria

axe-core rule IDs map to WCAG criteria via the `tags` field on each result. The table below
covers the most common rules; extend as needed.

| axe rule ID              | WCAG criterion  |
|--------------------------|-----------------|
| `color-contrast`         | wcag22:1.4.3    |
| `color-contrast-enhanced`| wcag22:1.4.6    |
| `image-alt`              | wcag22:1.1.1    |
| `label`                  | wcag22:4.1.2    |
| `link-name`              | wcag22:2.4.4    |
| `button-name`            | wcag22:4.1.2    |
| `document-title`         | wcag22:2.4.2    |
| `html-has-lang`          | wcag22:3.1.1    |
| `video-caption`          | wcag22:1.2.2    |
| `audio-caption`          | wcag22:1.2.4    |

### 3. Call `attest` for each finding

For each violation:

```jsonc
{
  "name": "attest",
  "arguments": {
    "criterionId": "wcag22:1.4.3",
    "verdict": "fail",
    "reason": "axe-core 2026-04-19: rule \"color-contrast\" failed on 1 node. Element has insufficient color contrast of 2.5 (foreground: #999999, background: #ffffff, font size: 10.4pt).",
    "by": "axe-core+ci",
    "attestedAt": "2026-04-19T10:00:00.000Z"
  }
}
```

For each passing check:

```jsonc
{
  "name": "attest",
  "arguments": {
    "criterionId": "wcag22:2.4.2",
    "verdict": "pass",
    "reason": "axe-core 2026-04-19: rule \"document-title\" passed on 1 node. Ensures each HTML document contains a non-empty <title> element.",
    "by": "axe-core+ci",
    "attestedAt": "2026-04-19T10:00:00.000Z"
  }
}
```

### 4. Bridge TypeScript pattern

The full implementation is in the executable fixture:

`tests/fixtures/real-world/attest-axe/source/agent-bridge.ts`

Key excerpt — building payloads from the axe JSON:

```ts
function bridgeViolations(report: AxeReport, by: string) {
  for (const violation of report.violations) {
    const criterionId = AXE_RULE_TO_CRITERION[violation.id];
    if (criterionId === undefined) continue; // unknown rule — skip
    const summary = violation.nodes.slice(0, 3)
      .map(n => n.failureSummary ?? n.html).join("; ");
    payloads.push({
      criterionId,
      verdict: "fail",
      reason: `axe-core ${report.timestamp}: rule "${violation.id}" failed. ${summary}`,
      by,
      attestedAt: report.timestamp,
    });
  }
}
```

## Step-by-step: Lighthouse → attest

### 1. Run Lighthouse in CI and save the JSON report

```bash
npx lighthouse http://localhost:3000 --output json --output-path lighthouse-report.json
```

### 2. Map Lighthouse audit IDs to WCAG criteria

Lighthouse audit IDs match axe-core rule IDs for most checks. The table in the axe-core
section above applies. Additional Lighthouse-specific audits:

| Lighthouse audit ID      | WCAG criterion  |
|--------------------------|-----------------|
| `aria-allowed-attr`      | wcag22:4.1.2    |
| `aria-required-attr`     | wcag22:4.1.2    |
| `focus-traps`            | wcag22:2.1.2    |
| `logical-tab-order`      | wcag22:2.4.3    |
| `managed-focus`          | wcag22:3.2.2    |
| `use-landmarks`          | wcag22:1.3.6    |

### 3. Walk `categories.accessibility.auditRefs`

Only bridge `scoreDisplayMode === "binary"` audits. Informational audits (`score === null`)
carry no pass/fail verdict; skip them to avoid false claims.

```jsonc
{
  "name": "attest",
  "arguments": {
    "criterionId": "wcag22:1.4.3",
    "verdict": "fail",
    "reason": "Lighthouse 11.4.0 (2026-04-19T10:00:00.000Z): audit \"color-contrast\" failed. 1 failing node(s). Background and foreground colors have a sufficient contrast ratio.",
    "by": "lighthouse+ci",
    "attestedAt": "2026-04-19T10:00:00.000Z"
  }
}
```

### 4. Bridge TypeScript pattern

The full implementation is in the executable fixture:

`tests/fixtures/real-world/attest-lighthouse/source/agent-bridge.ts`

Key excerpt — walking the accessibility category:

```ts
for (const ref of a11yCategory.auditRefs) {
  const audit = report.audits[ref.id];
  if (audit?.scoreDisplayMode !== "binary" || audit.score === null) continue;
  const criterionId = LIGHTHOUSE_AUDIT_TO_CRITERION[ref.id];
  if (!criterionId) continue;
  payloads.push({
    criterionId,
    verdict: audit.score === 1 ? "pass" : "fail",
    reason: `Lighthouse ${report.lighthouseVersion} (${report.fetchTime}): audit "${ref.id}" ${audit.score === 1 ? "passed" : "failed"}. ${audit.title}`,
    by,
    attestedAt: report.fetchTime,
  });
}
```

## After bridging

Once `attest` calls have been dispatched, run `conformance_statement` (or `coverage`) to
see the attested verdicts reflected on the evidence ledger. Each attested criterion will
show an `attested` evidence source with the `by` and `reason` fields you supplied.

Commit `.ra11y/attestations.jsonl` so the audit trail persists across developers and CI.

## Executable proofs

These fixtures verify the bridge TypeScript compiles cleanly and the scanner accepts it
without spurious violations:

- `tests/fixtures/real-world/attest-axe/` — axe-core bridge
- `tests/fixtures/real-world/attest-lighthouse/` — Lighthouse bridge

## See also

- `docs/conformance.md` — end-to-end guide: scan → checklist → attest → coverage → statement.
- `src/mcp/tool-attest.ts` — `attest` tool input schema and validation.
- `docs/adr/0011-evidence-as-first-class-primitive.md` — why there is no `"runtime"` source kind.
