# live-region-status

Guards V1-FIXTURE-LIVE-REGION. Exercises `aria/live-region-valid`
(wcag22:4.1.3) on a polite status container + dynamic update pattern.

## Failure mode

A refactor that silences any of the five structural-fault detections
(invalid token, role contradiction, invalid aria-atomic, hidden region)
would produce a silent regression against a live-region pattern in
real-world React codebases.

## Files

- `source/StatusBanner.tsx` — correct `role="status"` pattern (no
  violation) plus three broken variants: `aria-live="bogus"`,
  `role="status"` + `aria-live="assertive"` contradiction, and
  `aria-atomic="maybe"`.
- `source/ToastRegion.tsx` — correct `role="alert"` pattern (no
  violation) plus two broken variants: `role="alert"` +
  `aria-live="polite"` contradiction, and `aria-live="polite"` +
  `aria-hidden="true"`.
- `source/Page.tsx` — mounts all variants; parse-only, no additional
  violations.

## Locked assertions

| Target | Kind | Reason substring |
|---|---|---|
| `aria/live-region-valid` | violation-present | `aria-live="bogus"` |
| `aria/live-region-valid` | violation-present | `role="status"` |
| `aria/live-region-valid` | violation-present | `aria-atomic="maybe"` |
| `aria/live-region-valid` | violation-present | `role="alert"` |
| `aria/live-region-valid` | violation-present | `also has aria-hidden` |

## Drift from backlog

The backlog item mentioned asserting
`couldBeWrongBecause: ["runtime_behavior_required"]` where the scanner
cannot prove content actually updates at runtime. That reason code does
not exist in the codebase — the rule fires only on declarative faults.
Assertions reflect live scanner output (probe run 2026-04-19).

## Sanitization

Brand names replaced with generic equivalents ("Widget"). No private
package imports, no business copy, no personal paths.
