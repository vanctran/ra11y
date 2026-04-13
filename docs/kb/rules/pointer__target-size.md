---
title: "pointer/target-size"
severity: "warning"
scope: "document"
satisfies: ["wcag22:2.5.8"]
---
# `pointer/target-size`
- **Severity:** warning
- **Scope:** document
- **Satisfies:** `wcag22:2.5.8`
- **Applies to:** .css, .html, .htm, .tsx, .jsx
## What it checks
Pointer targets (buttons, links, form controls) must measure at least 24×24 CSS pixels, unless the inline, equivalent, user-agent, or essential exception applies.
## Why it matters
Users with motor impairments, tremors, or who use touch input on small screens cannot reliably hit small targets. WCAG 2.2 SC 2.5.8 sets a 24×24 CSS-pixel minimum (with documented exceptions). A button styled `w-4 h-4` (16×16) or `width: 20px; height: 20px;` is too small without compensating padding or the inline-text exception.
## Normative quote
> The size of the target for pointer inputs is at least 24 by 24 CSS pixels, except where: Spacing, Equivalent, Inline, User agent control, or Essential.
## Good example
```tsx
.icon-button { width: 24px; height: 24px; }
<button className="w-6 h-6">×</button>
```
## Bad example
```tsx
.icon-button { width: 16px; height: 16px; }
<button className="w-4 h-4">×</button>
```
## References
- <https://www.w3.org/TR/WCAG22/#target-size-minimum>
- <https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html>
