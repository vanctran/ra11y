---
name: standards-audit
description: Audits every loaded standard module for criterion counts, URL validity, level distribution, and equivalentTo reciprocal consistency. Catches silent drift between a standard's published version and our in-tree module.
allowed-tools: Bash(bun *) Bash(git *)
---

# /standards-audit

Deep audit of `src/standards/` correctness.

## Checks

1. **Criterion counts** match each standard's published total (wcag22: 86, wcag21: 78, section508 2017: the Chapter 5/6 counts, en301549 v3.2.1: the IT-specific counts).
2. **Level distribution** matches the spec (e.g., WCAG 2.2 has 30 A, 20 AA, 28 AAA — if these drift, our module is stale).
3. **URL validity**: every `criterion.url` resolves. Run `scripts/check-docs-links.ts` over the union.
4. **equivalentTo reciprocal consistency**: for every `A.equivalentTo: [B]`, verify `B` exists in its standard. A reference to a removed criterion is a silent bug.
5. **No duplicate local IDs** within a standard.
6. **No orphan criteria**: every criterion is reachable from the standard's `criteria` array (guards against typos in the barrel).

## Workflow

1. `bun scripts/validate-standards.ts` — runs all six checks and emits structured output.
2. If any fail: report specifically which standard, which criterion, and which check. Do not attempt to fix — this skill is read-only; a fix goes through `standard-builder` or `type-smith`.
3. If all pass: report "standards audit clean".

## Return format

```
standards_audited: [wcag22, wcag21, section508, en301549]
checks:
  criterion_counts:      PASS
  level_distribution:    PASS
  url_validity:          PASS (302 URLs checked)
  reciprocal_equivalentTo: PASS
  duplicate_local_ids:   PASS
  orphan_criteria:       PASS
overall: PASS
```
