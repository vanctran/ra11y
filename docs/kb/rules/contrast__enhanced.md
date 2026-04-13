---
title: "contrast/enhanced"
severity: "warning"
scope: "document"
satisfies: ["wcag22:1.4.6", "wcag21:1.4.6"]
---
# `contrast/enhanced`
- **Severity:** warning
- **Scope:** document
- **Satisfies:** `wcag22:1.4.6`, `wcag21:1.4.6`
- **Applies to:** .css
## What it checks
Text must have a contrast ratio of at least 7:1 against its background (4.5:1 for large text) — WCAG 1.4.6 AAA.
## Why it matters
People with moderate low vision benefit from 4.5:1, but people with more substantial vision loss (roughly 20/200 or worse) need the 7:1 AAA threshold to read comfortably. Government and accessibility-critical public-facing sites often target AAA for body text.
## Normative quote
> The visual presentation of text and images of text has a contrast ratio of at least 7:1, except for large text, incidental text, and logotypes.
## Good example
```tsx
.button { color: #ffffff; background-color: #1a202c; }  /* ratio 14.5:1 */
```
## Bad example
```tsx
.button { color: #ffffff; background-color: #4a5568; }  /* ratio 5.1:1 */
```
## References
- <https://www.w3.org/TR/WCAG22/#contrast-enhanced>
- <https://www.w3.org/WAI/WCAG22/Techniques/general/G17>
