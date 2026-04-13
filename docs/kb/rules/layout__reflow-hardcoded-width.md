---
title: "layout/reflow-hardcoded-width"
severity: "warning"
scope: "document"
satisfies: ["wcag22:1.4.10", "wcag21:1.4.10"]
---
# `layout/reflow-hardcoded-width`
- **Severity:** warning
- **Scope:** document
- **Satisfies:** `wcag22:1.4.10`, `wcag21:1.4.10`
- **Applies to:** .css
## What it checks
Avoid hardcoded widths wider than 320 CSS pixels — the element will overflow a phone-width viewport and require horizontal scrolling, which violates WCAG 1.4.10 Reflow.
## Why it matters
WCAG 1.4.10 requires content to reflow to a 320-pixel-wide viewport without loss of information or horizontal scrolling. A CSS rule that sets `width: 1200px` on a container forces the element to its declared size regardless of viewport, producing a horizontal scrollbar on every phone. Use `max-width` instead, or pair with a media query that scopes the fixed width to a breakpoint wide enough to accommodate it.
## Normative quote
> Content can be presented without loss of information or functionality, and without requiring scrolling in two dimensions, for a width equivalent to 320 CSS pixels.
## Good example
```tsx
.container { max-width: 1200px; margin: 0 auto; padding: 0 1rem; }
```
## Bad example
```tsx
.container { width: 1200px; }
```
## References
- <https://www.w3.org/TR/WCAG22/#reflow>
- <https://www.w3.org/WAI/WCAG22/Techniques/css/C34>
