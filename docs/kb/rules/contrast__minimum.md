---
title: "contrast/minimum"
severity: "error"
scope: "document"
satisfies: ["wcag22:1.4.3", "wcag21:1.4.3"]
---
# `contrast/minimum`
- **Severity:** error
- **Scope:** document
- **Satisfies:** `wcag22:1.4.3`, `wcag21:1.4.3`
- **Applies to:** .css
## What it checks
Text must have a contrast ratio of at least 4.5:1 against its background (3:1 for large text).
## Why it matters
People with moderately low vision (common among older adults) need high contrast to read text. The 4.5:1 minimum compensates for the loss of contrast sensitivity that about 20% of the population experiences by age 80.
## Normative quote
> The visual presentation of text and images of text has a contrast ratio of at least 4.5:1, except for large text, incidental text, and logotypes.
## Good example
```tsx
.button { color: #ffffff; background-color: #2b6cb0; }  /* ratio 6.3:1 */
```
## Bad example
```tsx
.button { color: #ffffff; background-color: #90caf9; }  /* ratio 1.9:1 */
```
## References
- <https://www.w3.org/TR/WCAG22/#contrast-minimum>
- <https://www.w3.org/WAI/WCAG22/Techniques/general/G18>
