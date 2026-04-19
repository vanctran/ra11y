---
title: "End-to-end conformance guide"
audience: agents, users
---

# End-to-end conformance guide

This guide is for an agent (MCP consumer) handed a codebase and a mandate such as "make this conformant to WCAG 2.2 AA." It walks the full path from a cold-start scan to an emitted conformance statement and explains what to do when the statement refuses. CLI equivalents are noted where relevant, but the canonical workflow is the MCP tool sequence.

## Prerequisites

- A ra11y config (`ra11y.config.ts`) that pins the target standard and level. The `conformance_statement` tool derives its scope from the active config; a missing config means the tool defaults to `wcag22` + `AA`.
- The project must be a git repository. The conformance statement records the HEAD commit hash in its scope block. A non-git tree produces a statement with `scope.commitHash: ""` and a `no_commit_hash` warning in `meta.warnings`.
- Session `allowWrite: true` is required for `attest`. Call `sessionConfigure` with `{ allowWrite: true }` before the attestation step.

## The 5-step pipeline

### Step 1 — Scan

Run `scan_project` to collect static findings. The response shape is:

```jsonc
{
  "plan": { "totalFindings": number, "summary": string },
  "files": [
    {
      "filePath": string,
      "findings": [
        {
          "ruleId": string,
          "severity": "error" | "warning" | "info",
          "line": number,
          "column": number,
          "message": string,
          "suggestion": string,
          "criteria": ["wcag22:1.4.3", ...]
        }
      ]
    }
  ],
  "meta": { "filesScanned": number, "configSource": string, "rulesEvaluated": string[], ... }
}
```

Pass `profile` to pin scope to a named conformance profile (`wcag22-aa`, `wcag21-aa`, `section508`, `en301549`). A profile overrides any `standard` + `level` passed in the same call:

```jsonc
{ "name": "scan_project", "arguments": { "profile": "wcag22-aa" } }
```

CLI equivalent: `ra11y src/ --profile wcag22-aa`.

Fix every finding before moving to Step 2. Use `suggest_fix` on individual findings; use `apply_fix` when the fix is deterministic. A finding that remains after fixes is a conformance blocker — it appears as `reason: "failing"` in Step 5.

### Step 2 — Checklist

Call `checklist` to get the manual-review half. WCAG has criteria that static analysis can never verify — keyboard order, focus management, meaningful sequence, live regions. The checklist surfaces those as grounded review candidates with file:line locations:

```jsonc
{ "name": "checklist", "arguments": { "standard": "wcag22", "level": "AA" } }
```

Response shape (abbreviated):

```jsonc
{
  "sections": [
    {
      "criterionId": "wcag22:2.4.3",
      "title": "Focus Order",
      "needsReview": true,
      "candidates": [
        {
          "path": "src/components/Modal.tsx",
          "line": 47,
          "reason": "Modal opens on interaction but focus trap not detected",
          "confidence": "high"
        }
      ],
      "attestation": null
    }
  ],
  "meta": { ... }
}
```

Each section carries an `attestation` field when a durable attestation already exists for that criterion. A `stale: true` flag appears when the attestation's commit anchor predates files that have changed since — those resurface automatically and need re-verification.

Read each candidate by path:line. Form a verdict. Proceed to Step 3 for each criterion you have investigated.

### Step 3 — Attest

Record each manual verdict with `attest`. This appends a record to `.ra11y/attestations.jsonl`. Commit that file — it is the persistent audit trail.

```jsonc
{
  "name": "attest",
  "arguments": {
    "criterionId": "wcag22:2.4.3",
    "reason": "Keyboard traversal of Modal.tsx confirmed: focus traps on open, releases on Escape and close button. Tested with keyboard-only navigation 2026-04-18.",
    "verdict": "pass",
    "by": "agent"
  }
}
```

Response includes a `coveredRules` array and a `coverage` summary that tells you whether the attestation covers the full criterion or only a subset:

```jsonc
{
  "applied": true,
  "record": { "criterionId": "wcag22:2.4.3", "verdict": "pass", ... },
  "coveredRules": ["focus/order-meaningful", "keyboard/trap-present"],
  "coverage": {
    "kind": "criterion-wide",
    "message": "Criterion-wide attestation. You just claimed coverage for 2 rules under 'wcag22:2.4.3'."
  },
  "nextStep": "Attestation appended. Re-run conformance_statement ..."
}
```

**Scoping an attestation to specific rules.** When a criterion has many satisfying rules (WCAG 4.1.2 has over a dozen), you can attest coverage rule-by-rule. Omitting `ruleIds` claims all of them — the response's fan-out disclosure makes that explicit. Supplying `ruleIds` scopes the claim; the criterion flips to `pass` only once the union of all rule-scoped attestations covers every satisfying rule. A partially-covered criterion surfaces as `reason: "partially-attested"` in Step 5.

**Runtime tool results.** ra11y does not ingest axe-core or Lighthouse JSON directly. Run your runtime tool in CI, read its output, and call `attest` with a reason describing the finding. For example:

```jsonc
{
  "name": "attest",
  "arguments": {
    "criterionId": "wcag22:1.4.11",
    "reason": "axe-core 4.9 run 2026-04-18 against production build: zero violations reported for non-text-contrast rule.",
    "verdict": "pass",
    "by": "ci-bot"
  }
}
```

**N/A declarations.** Use `verdict: "n/a"` for criteria that do not apply to this project:

```jsonc
{
  "name": "attest",
  "arguments": {
    "criterionId": "wcag22:1.2.1",
    "reason": "Application renders no time-based media (audio or video).",
    "verdict": "n/a",
    "by": "agent"
  }
}
```

### Step 4 — Coverage

Re-run `coverage` after attestations land to see the merged per-criterion state:

```jsonc
{ "name": "coverage", "arguments": { "standard": "wcag22", "level": "AA" } }
```

Before attestations, a manual criterion appears as `status: "unknown"`. After a passing attestation, it shows `status: "pass"`. After a rule-scoped partial attestation, it shows `status: "partial"`.

Before:

```jsonc
{ "criterionId": "wcag22:2.4.3", "status": "unknown", "automatable": "manual", "sources": [] }
```

After:

```jsonc
{
  "criterionId": "wcag22:2.4.3",
  "status": "pass",
  "automatable": "manual",
  "sources": [
    { "kind": "attested", "by": "agent", "verdict": "pass", "reason": "Keyboard traversal..." }
  ]
}
```

When every criterion in the profile reaches `pass` or `n/a`, the conformance statement is ready to emit.

### Step 5 — Conformance statement

Call `conformance_statement` with the target profile:

```jsonc
{
  "name": "conformance_statement",
  "arguments": { "standard": "wcag22", "level": "AA" }
}
```

A successful response:

```jsonc
{
  "conformant": true,
  "date": "2026-04-18",
  "guidelinesTitle": "Web Content Accessibility Guidelines 2.2",
  "guidelinesUri": "https://www.w3.org/TR/WCAG22/",
  "guidelinesVersion": "2.2",
  "conformanceLevel": "AA",
  "scope": {
    "files": ["src/components/Button.tsx", "src/pages/checkout.tsx", ...],
    "commitHash": "a3f9c2d",
    "configSnapshot": { "standard": "wcag22", "level": "AA", ... }
  },
  "technologiesReliedUpon": ["HTML (React-derived)", "CSS", "JavaScript", "ARIA"],
  "evidence": {
    "findingIds": [...],
    "attestationIds": [...]
  },
  "signature": {
    "algorithm": "sha256",
    "digest": "e3b0c44298fc1c149afb...",
    "signedAt": "2026-04-18T14:22:00Z",
    "inputFingerprint": { ... }
  },
  "markdown": "## WCAG 2.2 AA Conformance Statement\n...",
  "nextStep": "Conformant. Drop the markdown block into your release notes or audit bundle; commit .ra11y/attestations.jsonl so the evidence trail persists."
}
```

Drop the `markdown` field into a release note or audit bundle. Commit `.ra11y/attestations.jsonl`.

## The refusal flow

When the statement cannot be issued, `conformance_statement` returns `conformant: false` and a `blockers` list. Each blocker names a criterion and a `reason` that routes the agent to the next tool:

```jsonc
{
  "conformant": false,
  "blockers": [
    {
      "criterionId": "wcag22:1.4.3",
      "reason": "failing",
      "details": "2 active violations in src/components/Badge.tsx"
    },
    {
      "criterionId": "wcag22:2.4.5",
      "reason": "missing_process_config",
      "details": "Criterion requires a processes config (ADR 0016). Add processes to ra11y.config.ts."
    },
    {
      "criterionId": "wcag22:2.1.1",
      "reason": "no-evidence",
      "details": "No static findings, attestations, or verdicted review candidates found."
    },
    {
      "criterionId": "wcag22:4.1.2",
      "reason": "partially-attested",
      "details": "3 of 13 satisfying rules are attested; 10 remain uncovered."
    }
  ],
  "nextStep": "Not conformant — read blockers[]. failing → suggest_fix; candidate-only or no-evidence → attest (or checklist); partially-attested → attest with the missing ruleIds."
}
```

Route by `reason`:

| `reason` | Action |
|---|---|
| `"failing"` | Call `suggest_fix` on the cited findings; fix the code; re-scan. |
| `"candidate-only"` | Investigate the review candidates; call `attest` with your verdict, or write a source pragma. |
| `"no-evidence"` | Call `checklist`, investigate, then `attest`. Or declare `n/a` if the criterion doesn't apply. |
| `"partially-attested"` | Call `attest` with the missing `ruleIds` under the same criterion. |
| `"missing_process_config"` | Add `processes` config to `ra11y.config.ts` (see ADR 0016); re-run. |
| `"stale_attestation"` | The attestation's commit anchor is too old; re-investigate and re-attest. |

After addressing each blocker, re-call `conformance_statement`. Repeat until `conformant: true`.

## Signature verification

A previously-emitted statement carries a `signature` block — a SHA-256 digest over the commit hash, attestation ledger, in-scope criteria, and config fingerprint. Use `verifyConformanceBundle` (programmatic API) to check it:

```ts
import { verifyConformanceBundle } from "@ra11y/core";

const result = verifyConformanceBundle(statement.signature, currentInput);
// { valid: true } or { valid: false, reason: "commit-drift" | "attestation-set-mismatch" | ... }
```

Drift reasons and what they mean:

| `reason` | Cause |
|---|---|
| `"commit-drift"` | HEAD has moved since the statement was emitted. Re-run `conformance_statement`. |
| `"attestation-set-mismatch"` | Attestations were added or removed. Re-run to pick up the new ledger. |
| `"in-scope-criterion-mismatch"` | The profile's criterion set changed (standard update or config change). Re-run. |
| `"config-standards-mismatch"` / `"config-level-mismatch"` | The active config differs from the stamped fingerprint. Re-run. |
| `"digest-mismatch"` | The signature JSON was tampered with or corrupted. Treat as invalid. |

To re-emit a statement after drift, call `conformance_statement` again. The new statement receives a fresh signature over the current inputs.

## Attestation pruning

When files are deleted, their associated file- or line-scoped attestations become stale. Run:

```sh
ra11y attestations prune
```

This rewrites `.ra11y/attestations.jsonl` dropping records whose `location.filePath` no longer exists. Use `--dry-run` to preview without writing.

Project-scoped attestations (no `location`) are never pruned — they assert something about the project as a whole, not a specific file. When a scoped file changes (rather than being deleted), the attestation's `stale: true` flag surfaces on the next `checklist` call automatically. The agent re-investigates and re-attests; the old record remains in the ledger as historical provenance.

## What this guide does not cover

Runtime accessibility checks — live regions, focus traps, ARIA state changes, post-render contrast — are outside ra11y's scope. Run those in your Playwright or Vitest suite via axe-core. Once you have runtime results, feed them back through `attest` with a `reason` describing the run. That's the bridging pattern: ra11y handles static evidence and attestation provenance; your CI harness handles runtime execution.

## Example end-to-end transcript

A fictitious but realistic agent session targeting WCAG 2.2 AA.

**Step 1 — Initial scan**

```jsonc
→ scan_project({ "profile": "wcag22-aa" })
← {
    "plan": { "totalFindings": 4, "summary": "4 findings across 3 files" },
    "files": [
      {
        "filePath": "src/components/Badge.tsx",
        "findings": [
          { "ruleId": "contrast/minimum", "severity": "error", "line": 12,
            "message": ".badge-label contrast ratio 2.9:1 against background",
            "suggestion": "Darken foreground to #595959 for 7:1",
            "criteria": ["wcag22:1.4.3"] }
        ]
      }
    ],
    "meta": { "filesScanned": 47, "rulesEvaluated": ["contrast/minimum", ...] }
  }
```

**Step 2 — Fix and re-scan**

Agent applies the contrast fix to `Badge.tsx`. Calls `scan_project` again — 0 findings.

**Step 3 — Checklist**

```jsonc
→ checklist({ "standard": "wcag22", "level": "AA" })
← {
    "sections": [
      {
        "criterionId": "wcag22:2.4.3",
        "title": "Focus Order",
        "needsReview": true,
        "candidates": [
          { "path": "src/components/Modal.tsx", "line": 47,
            "reason": "Modal opens on click but focus trap not detected" }
        ],
        "attestation": null
      },
      {
        "criterionId": "wcag22:1.2.1",
        "title": "Audio-only and Video-only",
        "needsReview": false,
        "candidates": [],
        "attestation": null
      }
    ]
  }
```

Agent reads `Modal.tsx:47`, confirms focus management is implemented correctly.

**Step 4 — Attest**

```jsonc
→ attest({
    "criterionId": "wcag22:2.4.3",
    "reason": "Focus trap verified in Modal.tsx: focus moves to first interactive element on open, releases on Escape. Keyboard-only test 2026-04-18.",
    "verdict": "pass"
  })
← { "applied": true, "coveredRules": ["focus/order-meaningful", "keyboard/trap-present"],
    "nextStep": "Attestation appended. Re-run conformance_statement..." }

→ attest({
    "criterionId": "wcag22:1.2.1",
    "reason": "No audio-only or video-only content present in this application.",
    "verdict": "n/a"
  })
← { "applied": true, "coveredRules": [], ... }
```

**Step 5 — Conformance statement**

```jsonc
→ conformance_statement({ "standard": "wcag22", "level": "AA" })
← {
    "conformant": true,
    "date": "2026-04-18",
    "conformanceLevel": "AA",
    "scope": { "commitHash": "a3f9c2d", "files": [...] },
    "technologiesReliedUpon": ["HTML (React-derived)", "CSS", "JavaScript", "ARIA"],
    "signature": { "algorithm": "sha256", "digest": "e3b0c4...", ... },
    "markdown": "## WCAG 2.2 AA Conformance Statement\n...",
    "nextStep": "Conformant. Drop the markdown block into your release notes..."
  }
```

Agent commits `.ra11y/attestations.jsonl` and drops `statement.markdown` into the release notes.

## Cross-references

- [ADR 0011 — Evidence as a first-class primitive](./adr/0011-evidence-as-first-class-primitive.md) — the `EvidenceLedger` shape and status derivation rules.
- [ADR 0013 — Rule-scoped attestations](./adr/0013-rule-scoped-attestations.md) — rule-level coverage checks, `partially-attested` blocker, and the pragma resolver.
- [ADR 0016 — Process-level scope](./adr/0016-process-level-scope.md) — `processes` config for WCAG 3.2.3, 3.2.4, and 2.4.5; `missing_process_config` refusal.
- [ADR 0017 — Conformance statement output](./adr/0017-conformance-statement-output.md) — the `ConformanceStatement` shape, refusal semantics, and VPAT vs. conformance statement distinction.
- [MCP tool reference](./mcp/tool-reference.md) — all tools with inputs, outputs, and when to use them.
- [CLI reference](./cli.md) — `ra11y --profile`, `ra11y attestations prune`, `ra11y scan`.
- [AI-first consumer model](./kb/architecture/ai-first-consumer.md) — doctrine for why the statement refuses rather than degrades, and why attestations surface rather than suppress.
