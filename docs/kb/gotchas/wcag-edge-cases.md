---
title: "WCAG edge cases"
topic: gotcha
audience: rule authors
---

# WCAG edge cases

Interpretive edges in WCAG 2.x that have bitten rule authors or will bite the next one.

## 1.1.1 Non-text Content — the "decorative" carve-out

An `<img>` with `alt=""` is decorative. An `<img>` with no `alt` attribute is missing one. These look similar; they are not. Browsers treat a missing `alt` as an unlabeled image and announce the filename. `alt=""` explicitly tells AT "this image is decoration, skip it." Rules MUST distinguish.

Also: `role="presentation"` on an `<img>` does the same thing as `alt=""`. `aria-hidden="true"` removes from the tree entirely. All three are valid decorative markers.

## 1.3.1 Info and Relationships — the over-reaching criterion

1.3.1 is the kitchen-sink criterion. Almost any semantic bug can be framed as a 1.3.1 failure: missing form labels (because the label relationship isn't programmatically available), missing landmarks (because page structure isn't), wrong heading levels (because document outline isn't), incorrect table headers, etc.

ra11y rules that cite 1.3.1 *also* cite the more specific criterion where one exists (3.3.2 for labels, 2.4.6 for headings, etc.). The over-reach is WCAG's, not ours.

## 1.4.1 Use of Color — not a contrast criterion

1.4.1 is often confused with 1.4.3 (Contrast Minimum). They're different. 1.4.1 says "don't use color alone to convey information" — e.g., a form that indicates error by making a field red without any icon, text, or border change. 1.4.3 is the numerical contrast ratio. A page can pass 1.4.3 and fail 1.4.1.

No static rule can fully check 1.4.1 — it requires understanding intent. Surfaced as a manual-review candidate.

## 1.4.3 Contrast — "large text" threshold

"Large text" is 18pt regular OR 14pt bold. 14pt non-bold is NOT large. Teams confusing these ship text that's just under the threshold and fails.

Also: the threshold is 4.5:1 for normal, 3:1 for large. Reversing these (applying 3:1 to everything) is a common authoring mistake.

## 2.1.1 Keyboard — `onClick` without `onKeyDown`

A `<div onClick={...}>` is not keyboard-accessible — Enter/Space don't activate it. The fix is either (a) use a native `<button>` or (b) add `onKeyDown`, `tabindex="0"`, and `role="button"`.

Reality: React idioms bury this behind PascalCase components. `<IconButton onClick>` might wrap a real `<button>` (fine) or might be the `<div>` pattern (not fine). ra11y's `keyboard/handler-missing` rule downgrades to info on PascalCase; the `nativeWrappers` config knob quiets known-good wrappers.

## 2.4.1 Bypass Blocks — when to require a skip link

The criterion says "A mechanism is available to bypass blocks of content that are repeated on multiple Web pages." The skip link is the common implementation but not the only one. Proper landmark structure + AT's landmark navigation arguably satisfies the criterion without a skip link.

ra11y's `navigation/skip-link` rule takes the stricter view: if there's a multi-link nav, require a skip link. It's a warning, not an error — teams that explicitly rely on landmarks can silence it.

## 2.4.4 Link Purpose — "in context"

1.4.4 (Link Purpose in Context) allows surrounding text to supply the context a bare link like "here" needs. "Read the full report [here]" is arguably compliant because the surrounding sentence disambiguates.

The stricter 2.4.9 (Link Purpose AAA) requires the link text alone. Teams targeting AA get the in-context pass; teams targeting AAA don't.

Our `navigation/link-descriptive-text` rule flags "click here" / "read more" / "here" / "this" as warnings. A stricter mode for AAA is future work.

## 4.1.1 Parsing — obsolete in WCAG 2.2

WCAG 2.2 removed 4.1.1 because modern HTML parsers recover from most errors the criterion was meant to catch. Our `wcag22` standard module explicitly does NOT ship 4.1.1. The `wcag21` module does, but most 4.1.1 failures (unique IDs, proper tag nesting) are also 1.3.1 or 4.1.2 failures via a different interpretation, so rules targeting those criteria still catch the underlying bugs.

## See also

- [`accessible-name-computation.md`](../concepts/accessible-name-computation.md) — the most-confused a11y topic.
- [`docs/certification/vpat-mapping.md`](../../certification/vpat-mapping.md) — how ambiguous criteria map to VPAT verdicts.
