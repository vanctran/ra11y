---
title: "Focus visibility and the :focus-visible pseudo-class"
topic: concept
audience: agents, contributors
---

# Focus visibility and the `:focus-visible` pseudo-class

Keyboard-only users navigate by Tab, Shift+Tab, and arrow keys. They need a **visible focus indicator** — a ring, outline, or color change — to know which element currently has focus. Suppressing the focus ring is the single most common deliberate a11y regression (teams remove it because it "looks bad," breaking an entire category of users).

## The relevant criteria

- **WCAG 2.4.7 Focus Visible (AA).** When an interactive component has keyboard focus, the focus indicator is visible.
- **WCAG 2.4.11 Focus Not Obscured (AA, new in WCAG 2.2).** The focused component is not entirely hidden by other content (sticky headers, chat widgets, cookie banners).
- **WCAG 2.4.13 Focus Appearance (AAA, new in WCAG 2.2).** Specifies minimum size, contrast, and unobscured-area requirements for the indicator itself.

## The `outline: none` trap

```css
/* don't do this */
button:focus { outline: none; }

/* don't do this either */
* { outline: none; }
```

Browsers render a default focus outline on interactive elements. Removing it without replacing it breaks keyboard navigation. The `focus/outline-visible` rule flags this pattern.

The right answer is to either keep the default or replace it:

```css
button:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
```

## `:focus` vs `:focus-visible`

- `:focus` — element has focus, regardless of how it got focused (mouse click, keyboard Tab, programmatic focus).
- `:focus-visible` — element has focus AND the browser heuristically decided the user needs to see it. Triggered by keyboard focus; suppressed for mouse clicks on buttons.

Modern CSS typically wants `:focus-visible` for the visible ring and leaves `:focus` alone. That avoids showing a giant focus ring when the user clicks a button with a mouse.

```css
button:focus { outline: none; }                    /* mouse-click no ring */
button:focus-visible { outline: 2px solid blue; }  /* keyboard focus ring */
```

The combined pattern is the current best practice.

## Tailwind quirks

Tailwind's `focus:ring-3` applies on `:focus` (any focus), not `:focus-visible`. Teams that want the focus-visible-only behavior reach for `focus-visible:ring-3`. Both are legitimate; static analysis can't tell which the designer intended without reading the design intent.

The `focus/outline-visible` rule downgrades Tailwind class-scoped suppression to `info` severity so an agent can read the source and verify. False-positive rate on AA-compliant Tailwind codebases would otherwise be unacceptable.

## The `outline-color: transparent` anti-pattern

Some codebases keep `outline` present but set it to `transparent` to preserve layout while hiding the ring. That defeats the purpose. The rule checks for this.

## Focus management

A distinct problem from focus visibility: when a modal opens, focus should move into the modal; when it closes, focus should return to the invoking element. When a route changes in a SPA, focus should move to the new page's main heading. Static analysis can detect the *absence* of focus-management code but can't verify its correctness; runtime testing (Playwright + accessibility tree inspection) covers what we can't.

## See also

- [`interactive-elements.md`](./interactive-elements.md) — what has focus in the first place.
- WCAG 2.4.7: https://www.w3.org/TR/WCAG22/#focus-visible
- WCAG 2.4.11: https://www.w3.org/TR/WCAG22/#focus-not-obscured-minimum
