---
title: "pointer/drag-alternative"
severity: "warning"
scope: "document"
satisfies: ["wcag22:2.5.7"]
---
# `pointer/drag-alternative`
- **Severity:** warning
- **Scope:** document
- **Satisfies:** `wcag22:2.5.7`
- **Applies to:** .html, .htm, .tsx, .jsx, .ts, .js
## What it checks
All functionality that uses a dragging movement must also be achievable by a single pointer without dragging (e.g., a click, button, or keyboard handler).
## Why it matters
Dragging requires sustained motor control across two axes — difficult or impossible for users with tremors, limited dexterity, or who use head pointers, switch input, or eye-gaze. Providing a click/keyboard alternative (up/down arrow buttons next to a sortable list, a 'Move to top' menu item, etc.) makes the same functionality reachable without the drag gesture.
## Normative quote
> All functionality that uses a dragging movement for operation can be achieved by a single pointer without dragging, unless dragging is essential or the functionality is determined by the user agent and not modified by the author.
## Good example
```tsx
<li draggable="true" onDragStart={onDragStart}>
  Item 1
  <button onClick={moveUp} aria-label="Move up">↑</button>
  <button onClick={moveDown} aria-label="Move down">↓</button>
</li>
```
## Bad example
```tsx
<li draggable="true" onDragStart={onDragStart}>
  Item 1
</li>
```
## References
- <https://www.w3.org/TR/WCAG22/#dragging-movements>
- <https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html>
