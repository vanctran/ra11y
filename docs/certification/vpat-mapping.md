---
title: "VPAT conformance mapping"
audience: certification leads, compliance engineers
---

# VPAT conformance mapping

The Voluntary Product Accessibility Template (VPAT) is a federal-procurement artifact. Agencies use it to evaluate whether a product meets their a11y requirements before purchasing. ra11y's `vpat` report produces one deterministically from scan state.

This page documents how ra11y maps its internal data (violations, coverage, rule metadata) to VPAT verdicts.

## The four VPAT verdicts

Every criterion in the target standard is assigned exactly one of:

| Verdict | When it's emitted |
|---------|-------------------|
| **Supports** | The criterion is fully automatable AND no rule satisfying it has produced a violation. |
| **Partially Supports** | The criterion is partially automatable AND the automated half has no violations. Remarks cell notes which aspects need manual review. |
| **Does Not Support** | The criterion is automatable (full or partial) AND at least one rule satisfying it has produced an active violation. |
| **Not Applicable** | Element-presence detection says the codebase doesn't use the feature (e.g. no `<video>` elements → media criteria not applicable). |

Criteria whose `automatable: "manual"` metadata says no static check is possible do not get a deterministic verdict. The `vpat` report emits "Needs manual review — see remarks" and leaves the remarks cell ready for human authoring (or Phase 20's `draft_vpat_narrative` sampling tool).

## Mapping in detail

### The `automatable` metadata

Every criterion in ra11y's standard modules declares `automatable: "full" | "partial" | "manual"`:

- **full** — the rule engine can catch every conformance failure mechanically. Example: WCAG 1.1.1 for `<img>` alt text.
- **partial** — the engine catches a meaningful subset; the rest requires manual audit. Example: WCAG 1.4.3 contrast — the engine catches in-file CSS pairs but can't resolve Tailwind utility classes or inherited styles.
- **manual** — no static check is possible. Example: WCAG 1.2.2 — "captions are provided for prerecorded audio content."

### Conformance derivation

```
criterion automatable = "full"
  - no violations → Supports
  - any violation → Does Not Support

criterion automatable = "partial"
  - no violations → Partially Supports (remarks: "Automated checks pass; manual audit required for <specific aspects>")
  - any violation → Does Not Support

criterion automatable = "manual"
  - always → "Needs manual review" (not one of the four verdicts; VPAT templates accommodate this)

Element-presence override:
  - any criterion that depends on element X, where X is absent from the codebase → Not Applicable
```

### Element-presence detection

The `src/reports/checklist.ts` helper runs an element-presence scan alongside the rule scan. Results feed both `checklist` (to mark `likelyRelevant: false`) and `vpat` (to emit `Not Applicable`). Presence checks cover:

- `<video>`, `<audio>` — media criteria (1.2.*)
- `<canvas>`, `<svg>` — non-text alternatives (1.1.1 edges)
- `<form>`, `<input>`, `<select>`, `<textarea>` — form criteria (3.3.*)
- `<table>` — table semantics (1.3.1 tabular)
- `<iframe>`, `<object>`, `<embed>` — embedded content criteria
- Page-level landmarks — bypass-blocks criteria (2.4.1)

## Running the report

```sh
ra11y --vpat src/ --standard wcag22 --level AA > vpat.md
```

Or from MCP:

```
Call the `coverage` tool with level AA, then iterate criteria.
```

The future `draft_vpat_narrative` tool (Phase 20) takes this a step further — for each criterion, samples the host for a remarks cell that references the specific rules that passed and any partial-automation caveats.

## See also

- [`docs/kb/architecture/reports.md`](../kb/architecture/reports.md) — all four report kinds.
- [`docs/certification/readiness-scoring.md`](./readiness-scoring.md) — the readiness-scorecard report (sibling).
- [`docs/certification/wcag-certification-guide.md`](./wcag-certification-guide.md) — end-to-end guide to using ra11y to prepare for a certification audit.
