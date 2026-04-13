---
title: "keyboard/handler-missing"
severity: "error"
scope: "node"
satisfies: ["wcag22:2.1.1", "wcag21:2.1.1"]
---
# `keyboard/handler-missing`
- **Severity:** error
- **Scope:** node
- **Satisfies:** `wcag22:2.1.1`, `wcag21:2.1.1`
- **Applies to:** .html, .htm, .tsx, .jsx
## What it checks
Elements with onClick must be reachable by keyboard: either use a native button/link or attach an onKeyDown/onKeyUp and set tabIndex.
## Why it matters
Mouse users can click anywhere; keyboard users can't. An onClick on a bare <div> means the functionality is invisible to people who navigate with the keyboard — blind users, motor-impaired users, and anyone without a mouse. The fix is almost always to use a <button> instead.
## Normative quote
> All functionality of the content is operable through a keyboard interface.
## Good example
```tsx
<button type="button" onClick={handleDelete}>Delete</button>
```
## Bad example
```tsx
<div onClick={handleDelete}>Delete</div>
```
## References
- <https://www.w3.org/TR/WCAG22/#keyboard>
- <https://www.w3.org/WAI/WCAG22/Techniques/general/G202>
