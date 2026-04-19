# dialog-modal

Guards the `review/no-keyboard-trap` finder and dialog-role ARIA rule behavior across three variants of a React modal component.

## What this fixture locks in

Commit: synthetic fixture authored 2026-04-19 (V1-FIXTURE-DIALOG).

**Failure mode guarded:** A refactor that (a) removes `"dialog"` from the `no-keyboard-trap` finder's role list, (b) adds `dialog` to `REQUIRED_BY_ROLE` without the correct spec citation, (c) removes `"dialog"` from the valid-role dictionary, or (d) removes the `isBackdropPattern` carve-out from `keyboard/handler-missing` would silently break real-world dialog scanning.

## Key assertions

- `candidate-present { criterionId: "wcag22:2.1.2", reasonIncludes: "role=\"dialog\"" }` — finder fires on every `role="dialog"` element regardless of `aria-labelledby`/`aria-describedby` presence.
- `no-violation { ruleId: "aria/invalid-role" }` — `role="dialog"` is a valid WAI-ARIA 1.2 role.
- `no-violation { ruleId: "aria/required-attrs" }` — `dialog` has no WAI-ARIA 1.2 required states.
- `no-violation { ruleId: "keyboard/handler-missing" }` — the backdrop `<div onClick>` pattern is exempted by `isBackdropPattern`.

## Sanitization

Source names are generic (`VariantA/B/C`, `ConfirmDialog`). No brand names, tickets, or tokens. The `✕` close-button text from the original was replaced with an `<svg>` to test the real SVG-child pattern.

## Divergence from backlog

Backlog mentions `couldBeWrongBecause` on `fixClass:"runtime-only"` findings. No current rule emits that combination for dialog patterns — that field is only used by contrast rules today. Assertions match live scanner output.
