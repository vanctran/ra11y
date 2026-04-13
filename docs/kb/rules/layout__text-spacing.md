---
title: "layout/text-spacing"
severity: "warning"
scope: "document"
satisfies: ["wcag22:1.4.12", "wcag21:1.4.12"]
---
# `layout/text-spacing`
- **Severity:** warning
- **Scope:** document
- **Satisfies:** `wcag22:1.4.12`, `wcag21:1.4.12`
- **Applies to:** .css
## What it checks
Text-spacing properties (line-height, letter-spacing, word-spacing, margin-bottom) must not use !important, which prevents users from overriding text spacing to meet their needs.
## Why it matters
Users with low vision or cognitive disabilities often need to adjust text spacing to read comfortably. WCAG 1.4.12 requires that content remain readable when users override these four properties. Using !important on them blocks user stylesheets from taking effect, causing content to clip, overlap, or become unreadable.
## Normative quote
> No loss of content or functionality occurs by setting all of the following and by changing no other style property: Line height to at least 1.5 times the font size; Spacing following paragraphs to at least 2 times the font size; Letter spacing to at least 0.12 times the font size; Word spacing to at least 0.16 times the font size.
## Good example
```tsx
.body {
  line-height: 1.5;
  letter-spacing: 0.12em;
}
```
## Bad example
```tsx
.body {
  line-height: 1.2 !important;
  letter-spacing: 0 !important;
}
```
## References
- <https://www.w3.org/TR/WCAG22/#text-spacing>
- <https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html>
