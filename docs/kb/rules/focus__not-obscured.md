---
title: "focus/not-obscured"
severity: "warning"
scope: "document"
satisfies: ["wcag22:2.4.11"]
---
# `focus/not-obscured`
- **Severity:** warning
- **Scope:** document
- **Satisfies:** `wcag22:2.4.11`
- **Applies to:** .css
## What it checks
Sticky or fixed-position headers and footers must be paired with `scroll-padding-top` / `scroll-padding-bottom` on the scroll container so focused elements scrolled into view are not entirely hidden underneath them.
## Why it matters
WCAG 2.2 SC 2.4.11 requires that a focused component is not entirely hidden by author content. A sticky header is the most common cause: the browser scrolls a focused element to the top of the viewport, but the sticky bar covers it. Setting `scroll-padding-top` on `html` (or `body`) reserves space so the focused element stays visible.
## Normative quote
> When a user interface component receives keyboard focus, the component is not entirely hidden due to author-created content.
## Good example
```tsx
html { scroll-padding-top: 64px; }
.site-header { position: sticky; top: 0; height: 64px; }
```
## Bad example
```tsx
.site-header { position: sticky; top: 0; height: 64px; }
/* no scroll-padding on html/body */
```
## References
- <https://www.w3.org/TR/WCAG22/#focus-not-obscured-minimum>
- <https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html>
- <https://developer.mozilla.org/en-US/docs/Web/CSS/scroll-padding>
