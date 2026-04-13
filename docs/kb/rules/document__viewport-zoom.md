---
title: "document/viewport-zoom"
severity: "error"
scope: "document"
satisfies: ["wcag22:1.4.4", "wcag21:1.4.4"]
---
# `document/viewport-zoom`
- **Severity:** error
- **Scope:** document
- **Satisfies:** `wcag22:1.4.4`, `wcag21:1.4.4`
- **Applies to:** .html, .htm
## What it checks
<meta name='viewport'> must not disable pinch-to-zoom. Avoid user-scalable=no and maximum-scale values below 2.
## Why it matters
Users with low vision rely on pinch-to-zoom to read content. A viewport meta tag that disables scaling — or caps it below 200% — makes the page unreadable for them. WCAG 1.4.4 requires text to be resizable up to 200% without loss of content; 1.4.10 requires reflow at 400% on mobile.
## Normative quote
> Text can be resized without assistive technology up to 200 percent without loss of content or functionality.
## Good example
```tsx
<meta name="viewport" content="width=device-width, initial-scale=1">
```
## Bad example
```tsx
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
```
## References
- <https://www.w3.org/TR/WCAG22/#resize-text>
- <https://www.w3.org/TR/WCAG22/#reflow>
