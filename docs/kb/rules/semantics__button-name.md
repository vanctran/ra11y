---
title: "semantics/button-name"
severity: "error"
scope: "node"
satisfies: ["wcag22:4.1.2", "wcag21:4.1.2"]
---
# `semantics/button-name`
- **Severity:** error
- **Scope:** node
- **Satisfies:** `wcag22:4.1.2`, `wcag21:4.1.2`
- **Applies to:** .html, .htm, .tsx, .jsx
## What it checks
Every button must have an accessible name — via visible text, aria-label, aria-labelledby, or (for input type=submit/button) the value attribute.
## Why it matters
Screen readers announce a button by its accessible name. A button with only an icon child and no label is announced as 'button' — the user has no idea what it does. Icon-only buttons are one of the top-3 accessibility failures in audits.
## Normative quote
> For all user interface components the name and role can be programmatically determined.
## Good example
```tsx
<button aria-label="Close dialog"><svg>...</svg></button>
```
## Bad example
```tsx
<button><svg>...</svg></button>
```
## References
- <https://www.w3.org/TR/WCAG22/#name-role-value>
- <https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/>
