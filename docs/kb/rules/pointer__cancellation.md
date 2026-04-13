---
title: "pointer/cancellation"
severity: "warning"
scope: "node"
satisfies: ["wcag22:2.5.2", "wcag21:2.5.2"]
---
# `pointer/cancellation`
- **Severity:** warning
- **Scope:** node
- **Satisfies:** `wcag22:2.5.2`, `wcag21:2.5.2`
- **Applies to:** .html, .htm, .tsx, .jsx
## What it checks
Elements with pointer down-event handlers (onMouseDown, onTouchStart) must also have an up-event or click handler so users can abort by moving the pointer away.
## Why it matters
When functionality fires on pointer-down only, users with motor impairments can't cancel an accidental activation by sliding their finger or pointer off the target before releasing. The up-event or click pattern gives them an escape hatch.
## Normative quote
> For functionality that can be operated using a single pointer, at least one of the following is true: No Down-Event, Abort or Undo, Up Reversal, Essential.
## Good example
```tsx
<button onMouseDown={highlight} onClick={activate}>Go</button>
```
## Bad example
```tsx
<div onMouseDown={activate}>Go</div>
```
## References
- <https://www.w3.org/TR/WCAG22/#pointer-cancellation>
- <https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html>
