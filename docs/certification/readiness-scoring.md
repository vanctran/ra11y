---
title: "Certification readiness scoring"
audience: certification leads, compliance engineers
---

# Certification readiness scoring

The `certification` report is a scorecard: are you ready to claim WCAG conformance? It is **not** a conformance claim itself — that's what the VPAT is for. The readiness scorecard tells you whether you should start drafting the VPAT or whether you have work to do first.

## What the score means

The scorecard emits one traffic-light per criterion in the target standard at the target level:

- 🟢 **Green** — Automated checks pass. If the criterion is fully automatable, you can claim Supports in a VPAT. If it's partially automatable, you need a manual audit of the remaining aspects but the automated half is clean.
- 🟡 **Yellow** — The criterion is manual-review-required, or partially automatable with no automated violations but outstanding manual work.
- 🔴 **Red** — Automated checks caught at least one violation. Fix before certifying.

Plus a top-line **readiness percentage**: `green / (green + yellow + red)`. Yellow counts against readiness because manual review is real work.

## Running the report

```sh
ra11y --certification src/ --standard wcag22 --level AA
```

Output (truncated):

```
ra11y certification readiness — WCAG 2.2 AA

  74% ready (23 / 31 criteria)

  🟢 Automated clean       18
  🟡 Manual review needed   5
  🔴 Active violations      8

  Action items:
    🔴 1.1.1  Non-text Content        — 12 violations (media/alt-text-missing)
    🔴 1.4.3  Contrast (Minimum)      —  3 violations (contrast/minimum)
    🟡 1.2.1  Audio-only and Video-only — manual audit required
```

## How to use it

- **Before scheduling a certification audit.** A 100% readiness score means the automated work is done and the manual audit will focus on actual judgment calls, not catching bugs an auditor shouldn't have to.
- **As a quarterly a11y readout.** The scorecard pastes cleanly into a board report; the percentage is a single trend line.
- **As a CI gate on main.** `ra11y --certification --fail-on red` exits non-zero if any criterion has active violations.

## What it won't tell you

- **Whether a third-party library you use is accessible.** The rule engine scans your source; it can't verify whether `@acme/date-picker` meets 4.1.2.
- **Whether your runtime (live regions, focus management after route changes, focus traps in modals) passes.** Those need runtime testing — axe-core in a Playwright suite. ra11y's scope is source-time.
- **Whether the accessibility tree you intend is the one browsers construct.** Close, but not quite — ra11y infers the tree from source; the browser computes it at runtime and can diverge (CSS display rules, ARIA inheritance).

## Relationship to the VPAT

```
certification scorecard    →    "should I start the VPAT?"
VPAT report                →    "here is the conformance claim"
```

The scorecard is a readiness gate. The VPAT is the artifact you ship to the agency. Both are produced deterministically from the same scan data.

## See also

- [`vpat-mapping.md`](./vpat-mapping.md) — how the four VPAT verdicts are derived.
- [`wcag-certification-guide.md`](./wcag-certification-guide.md) — end-to-end workflow.
- [`docs/kb/architecture/reports.md`](../kb/architecture/reports.md) — all four report kinds.
