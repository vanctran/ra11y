---
title: "focus/outline-visible"
severity: "error"
scope: "project"
satisfies: ["wcag22:2.4.7", "wcag21:2.4.7"]
---
# `focus/outline-visible`
- **Severity:** error
- **Scope:** project
- **Satisfies:** `wcag22:2.4.7`, `wcag21:2.4.7`
## What it checks
CSS rules on :focus/:focus-visible must not remove the outline without providing a replacement focus indicator.
## Why it matters
Keyboard users rely on the focus indicator to know which element is active. Removing outline with `outline: none` on :focus without a replacement makes the page unusable for anyone navigating by keyboard — sighted screen-reader users, motor-impaired users, and power users alike.
## Normative quote
> Any keyboard operable user interface has a mode of operation where the keyboard focus indicator is visible.
## Good example
```tsx
button:focus-visible { outline: 2px solid #0066cc; }
```
## Bad example
```tsx
a:focus { outline: none; }
```
## References
- <https://www.w3.org/TR/WCAG22/#focus-visible>
- <https://www.w3.org/WAI/WCAG22/Techniques/failures/F78>
