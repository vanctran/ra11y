# data-tables fixture

Guards `semantics/table-headers` (wcag22:1.3.1) across three structural table variants.

## What this fixture guards

| File | Structure | Expected outcome |
|---|---|---|
| `SimpleTable.tsx` | `<td>`-only rows, no `<th>` anywhere | violation fires |
| `ScopedHeaderTable.tsx` | `<th scope="col">` + `<th scope="row">` | no violation |
| `ComplexHeaderTable.tsx` | `<th scope="colgroup">` spans + `headers` attr refs | no violation |

## Commit guarded

Synthetic fixture authored 2026-04-19. Guards the `semantics/table-headers` rule against silent regression after engine refactors. No single source commit — covers the combined table-header detection surface.

## Failure mode locked in

Rule fires when a `<table>` has one or more `<td>` cells but zero `<th>` cells. Must stay silent when any `<th>` is present, regardless of `scope` complexity.

## Assertion anchoring

The `reasonIncludes` substring `"no <th> header cells"` anchors the violation to the missing-header case. The substring `"screen readers will announce each value with no column or row context"` is in the full violation message and ties the assertion to `SimpleTable.tsx` specifically.

## Gaps / Track R

No table-specific review finder exists. Candidates for wcag22:1.3.1 (e.g. tables with `headers` IDs that reference non-existent `id` values, or tables where `scope` value is invalid) would require a new finder. Flagged for Track R.

## Sanitization

All data is neutral placeholder content (region names, widget labels, sales figures). No brand names, URLs, or identifying strings.
