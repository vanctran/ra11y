---
title: "motion/pause-stop-hide"
severity: "error"
scope: "node"
satisfies: ["wcag22:2.2.2", "wcag21:2.2.2"]
---
# `motion/pause-stop-hide`
- **Severity:** error
- **Scope:** node
- **Satisfies:** `wcag22:2.2.2`, `wcag21:2.2.2`
- **Applies to:** .html, .htm, .css
## What it checks
Moving or auto-updating content must have a mechanism to pause, stop, or hide. <marquee> is always flagged. CSS animations without a prefers-reduced-motion guard are flagged.
## Why it matters
People with attention deficits, vestibular disorders, or seizure conditions can be severely affected by motion they cannot control. A prefers-reduced-motion media query lets the browser honor the user's OS-level motion preference.
## Normative quote
> For moving, blinking, scrolling, or auto-updating information, all of the following are true.
## Good example
```tsx
@media (prefers-reduced-motion: reduce) {
  .spinner { animation: none; }
}
```
## Bad example
```tsx
<marquee>Breaking news</marquee>

.spinner { animation: spin 1s infinite; }
```
## References
- <https://www.w3.org/TR/WCAG22/#pause-stop-hide>
- <https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide>
