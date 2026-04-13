---
title: "tooltip/dismissable"
severity: "warning"
scope: "node"
satisfies: ["wcag22:1.4.13", "wcag21:1.4.13"]
---
# `tooltip/dismissable`
- **Severity:** warning
- **Scope:** node
- **Satisfies:** `wcag22:1.4.13`, `wcag21:1.4.13`
- **Applies to:** .html, .htm, .tsx, .jsx
## What it checks
Native title attributes on interactive elements produce browser tooltips that are not dismissable, hoverable, or persistent — failing WCAG 1.4.13.
## Why it matters
Browser-native tooltips (rendered from the title attribute) cannot be dismissed with the Escape key, disappear when the pointer approaches them, time out unpredictably, and are invisible to many touch and assistive-technology users. WCAG 1.4.13 requires content that appears on hover or focus to be dismissable, hoverable, and persistent — three properties native tooltips do not satisfy. The fix is to expose the information as an accessible visible label, an aria-label, or a custom tooltip with proper keyboard and pointer behavior.
## Normative quote
> Where receiving and then removing pointer hover or keyboard focus triggers additional content to become visible and then hidden, the following are true: Dismissible, Hoverable, Persistent.
## Good example
```tsx
<button aria-label="Save document">💾</button>
```
## Bad example
```tsx
<button title="Save document">💾</button>
```
## References
- <https://www.w3.org/TR/WCAG22/#content-on-hover-or-focus>
- <https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html>
