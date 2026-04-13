---
title: "contrast/non-text"
severity: "error"
scope: "document"
satisfies: ["wcag22:1.4.11", "wcag21:1.4.11"]
---
# `contrast/non-text`
- **Severity:** error
- **Scope:** document
- **Satisfies:** `wcag22:1.4.11`, `wcag21:1.4.11`
- **Applies to:** .css
## What it checks
Borders, outlines, and graphical objects of user interface components must have at least 3:1 contrast against adjacent colors.
## Why it matters
Users with low vision rely on the visual boundary of a control (its border, focus ring, or shape) to find and operate it. WCAG 1.4.11 mandates a 3:1 contrast for that boundary against adjacent colors so the control remains identifiable for the same population that needs 1.4.3 text contrast.
## Normative quote
> The visual presentation of user interface components and graphical objects has a contrast ratio of at least 3:1 against adjacent color(s).
## Good example
```tsx
.btn { background: #ffffff; border: 1px solid #595959; }  /* border ~7.0:1 vs bg */
```
## Bad example
```tsx
.btn { background: #ffffff; border: 1px solid #d0d0d0; }  /* border 1.6:1 vs bg */
```
## References
- <https://www.w3.org/TR/WCAG22/#non-text-contrast>
- <https://www.w3.org/WAI/WCAG22/Techniques/general/G195>
- <https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html>
