---
title: "Interactive elements"
topic: concept
audience: agents, contributors
---

# Interactive elements

An **interactive element** is anything a user can activate with a pointer or the keyboard — links, buttons, form controls, anchors with href, elements with `onClick`, elements with `tabindex="0"`, etc. Accessibility rules about keyboard, focus, and names apply to every interactive element; knowing which elements count is foundational.

## The native set

These are interactive by default, with a focus ring, keyboard activation, and assistive-tech role out of the box:

- `<a href="...">` — link
- `<button>` — button (`type="submit" | "reset" | "button"`)
- `<input>` of any type — various
- `<select>` — combobox / listbox
- `<textarea>` — textbox
- `<details>` / `<summary>` — disclosure
- `<audio controls>`, `<video controls>` — player controls

Use these whenever you can. They come with the focus ring, keyboard behavior, and accessibility tree role built in — no ARIA required.

## The ARIA set

When a native element doesn't fit the pattern, author a custom widget with an ARIA role + keyboard behavior + focus management:

- `role="button"` + `tabindex="0"` + keydown handler for Enter/Space
- `role="link"` + `tabindex="0"` + keydown for Enter
- `role="menuitem"`, `"tab"`, `"option"`, etc. — composite widgets

This is the "ARIA is a promise" pattern. Adding `role="button"` claims the element behaves like a button; rules check that you've kept the promise (tabindex, keydown handler, accessible name).

## React / JSX complications

PascalCase components are opaque to static analysis. `<Button onClick={…}>` could be:
- A thin wrapper around `<button>` (fine — inherits all native behavior)
- A styled `<div>` with an onClick handler (not fine — no focus, no keyboard)
- A forwarded ref to a native interactive (fine)
- A React Aria or Radix primitive (fine, they handle a11y internally)

ra11y can't tell from the JSX alone. The `nativeWrappers` config knob lets users say "I've audited `<Button>`, `<Link>`, `<Card>` — they wrap native elements." The `keyboard/handler-missing` rule then stays quiet on those components.

Rules that hit PascalCase components generally emit `severity: "info"` with a message pointing at the opaque name. An agent reading the component source can verify; the scanner couldn't.

## What ra11y's rules check

- `semantics/button-name` — every button needs an accessible name
- `navigation/link-descriptive-text` — link text must describe the destination
- `forms/labels-required` — form controls need labels
- `keyboard/handler-missing` — `onClick` on a non-native element needs tabindex + keydown
- `aria/invalid-role` — custom role must be a valid ARIA role
- `aria/required-attrs` — role-specific required attributes present
- `focus/outline-visible` — focus indicator is visible
- `focus/tabindex-positive` — `tabindex` values > 0 break the tab order; don't use them
- `pointer/cancellation` — pointer activation must be cancellable
- `semantics/nested-interactive` — don't nest interactive elements

## Detection heuristics

A static scanner decides "this element is interactive" by:

1. Native tag match (`a[href]`, `button`, `input`, `select`, `textarea`, `summary`, etc.)
2. Explicit `role=` that names an interactive role
3. Presence of `onClick` / `onKeyDown` / `onKeyPress`
4. `tabindex="0"` or positive

`isInteractiveHtmlElement` and `isInteractiveJsxElement` in `src/engine/ast-helpers.ts` implement this. The heuristic is deliberately inclusive — flagging an arguably-non-interactive element as interactive is recoverable (the user can dismiss); missing an actually-interactive element is not.

## See also

- [`accessible-name-computation.md`](./accessible-name-computation.md) — every interactive element needs a name.
- [`focus-visible-semantics.md`](./focus-visible-semantics.md) — keyboard focus handling.
- [ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/) — canonical patterns for custom widgets.
