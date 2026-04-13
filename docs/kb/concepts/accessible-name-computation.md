---
title: "Accessible-name computation"
topic: concept
audience: agents, contributors
---

# Accessible-name computation

The **accessible name** is the string a screen reader announces when an element receives focus. Computing it is the most common a11y task — most WCAG 4.1.2 failures are accessible-name failures.

## The priority order

For a given element, browsers compute the accessible name by walking this list and stopping at the first source that yields a non-empty string:

1. `aria-labelledby` — whitespace-joined text content of the referenced element(s), each resolved recursively. Wins over everything else.
2. `aria-label` — the literal string value.
3. **Native markup source** (varies by element):
   - `<img alt="...">` — the alt attribute.
   - `<input>`, `<textarea>`, `<select>` — the associated `<label>` (via `for=` or by wrapping), or the `title` attribute, or `placeholder` as a last resort.
   - `<button>`, `<a>` — the text content of the element and its descendants.
   - `<fieldset>` — the `<legend>` child.
   - `<table>` — the `<caption>` child.
4. `title` attribute — the literal value. Weak source; screen-reader support is inconsistent.
5. **Subtree text** — the concatenated text content of descendants (for elements like `<summary>` or custom widgets where native markup doesn't apply).
6. Nothing — accessible name is the empty string. Screen readers announce "button, unlabeled" or similar.

## What "non-empty" means

An `aria-label=""` does not count as a valid name — it's treated as absent. Same for `aria-labelledby` pointing at elements whose recursive name resolution yields empty. This is why `<button aria-label="">×</button>` ships as unnamed: the author intended an icon-only button but accidentally emptied the label.

## ra11y's loose resolver

`looseAccessibleNameJsx(element)` in `src/engine/ast-helpers.ts` computes a best-effort name from static source. It handles:
- `aria-labelledby` when it references an id present in the same file
- `aria-label` with a string literal (expressions like `aria-label={t("key")}` return undefined)
- Text content of descendants
- `title` as a last resort

It returns `undefined` when resolution is ambiguous. Rules that rely on the accessible name (`aria/label-in-name`, `semantics/button-name`, `navigation/link-descriptive-text`) should treat `undefined` as "cannot verify, stay quiet or downgrade to info" rather than "name is empty, emit an error."

## Cross-file resolution

`aria-labelledby="page-heading"` resolves if `<h1 id="page-heading">` is in the same file. Our static analysis doesn't follow imports, so cross-file labeling produces an info-severity finding rather than an error. An agent reading source can resolve what static analysis can't — that's the design intent.

## Common bugs

- **Empty `alt` on content images.** `<img alt="">` is the correct marker for decorative images; `<img>` with no alt at all is the bug. But `<img alt=""/>` on a chart is also a bug — the image carries information and should be labeled.
- **`aria-label` that duplicates visible text.** `<button aria-label="Close dialog"><span>Close dialog</span></button>` causes screen readers to announce "Close dialog Close dialog." Either drop the aria-label or hide the visible text from the AT.
- **`aria-labelledby` pointing at an empty element.** If the target is hidden via `display: none` or has been emptied, the name resolves to empty. AT falls through to the element's other name sources; usually there aren't any, so the name is empty.
- **`title` as the only label.** Mobile browsers don't show tooltips. Keyboard users can't trigger them. Screen readers may or may not announce them. Never rely on `title` as the primary label.

## WCAG criteria this affects

- 1.1.1 Non-text Content — all non-text content has a text alternative
- 1.3.1 Info and Relationships — programmatically determined labels
- 2.5.3 Label in Name — visible label text must appear in the accessible name
- 3.3.2 Labels or Instructions — form controls must be labeled
- 4.1.2 Name, Role, Value — controls have a name

## See also

- `src/engine/ast-helpers.ts` — `looseAccessibleNameJsx`, `looseAccessibleNameHtml`.
- [W3C Accessible Name and Description Computation](https://www.w3.org/TR/accname-1.2/) — the normative algorithm.
- [`interactive-elements.md`](./interactive-elements.md) — which elements need a name (spoiler: almost all of them).
