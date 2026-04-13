---
title: "layout/orientation-lock"
severity: "warning"
scope: "document"
satisfies: ["wcag22:1.3.4", "wcag21:1.3.4"]
---
# `layout/orientation-lock`
- **Severity:** warning
- **Scope:** document
- **Satisfies:** `wcag22:1.3.4`, `wcag21:1.3.4`
- **Applies to:** .css
## What it checks
CSS @media queries targeting orientation must not hide content or force rotation, which locks the page to a single orientation.
## Why it matters
Users with mounted devices (wheelchairs, bed mounts) may only be able to view content in one orientation. Locking to portrait or landscape makes the content unusable for them. WCAG requires content to adapt to both orientations unless the orientation is essential to the functionality.
## Normative quote
> Content does not restrict its view and operation to a single display orientation, such as portrait or landscape, unless a specific display orientation is essential.
## Good example
```tsx
@media (orientation: portrait) { .sidebar { flex-direction: column; } }
```
## Bad example
```tsx
@media (orientation: portrait) { .app { display: none; } }
```
## References
- <https://www.w3.org/TR/WCAG22/#orientation>
- <https://www.w3.org/WAI/WCAG22/Understanding/orientation.html>
