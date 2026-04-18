---
title: "aria/conflicting-role"
severity: "error"
scope: "node"
satisfies: ["wcag22:4.1.2", "wcag21:4.1.2"]
---
# `aria/conflicting-role`
- **Severity:** error
- **Scope:** node
- **Satisfies:** `wcag22:4.1.2`, `wcag21:4.1.2`
- **Applies to:** .html, .htm, .tsx, .jsx
## What it checks
The role attribute must not contradict the native element's implicit role. Mismatched role values make assistive tech announce one thing while the browser behaves like another.
## Why it matters
Every native HTML element has an implicit ARIA role. Setting an incompatible explicit role (for example role='link' on a <button>, or role='main' on a <nav>) is a WCAG 4.1.2 failure: the accessible role programmatically determined no longer matches the element's actual behavior. Screen-reader users get told the control is one thing while keyboard/mouse interaction behaves like another. The fix is almost always to change the tag, not the role.
## Normative quote
> For all user interface components the name and role can be programmatically determined.
## Good example
```tsx
<button type="button">Save</button>
<a href="/docs">Read the docs</a>
<nav aria-label="Primary">…</nav>
```
## Bad example
```tsx
<button role="link">Save</button>
<a href="/docs" role="button">Read the docs</a>
<nav role="main">…</nav>
```
## References
- <https://www.w3.org/TR/WCAG22/#name-role-value>
- <https://www.w3.org/TR/html-aria/>
- <https://www.w3.org/TR/wai-aria-1.2/#role_definitions>
