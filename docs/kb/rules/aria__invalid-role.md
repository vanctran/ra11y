---
title: "aria/invalid-role"
severity: "error"
scope: "node"
satisfies: ["wcag22:4.1.2", "wcag21:4.1.2"]
---
# `aria/invalid-role`
- **Severity:** error
- **Scope:** node
- **Satisfies:** `wcag22:4.1.2`, `wcag21:4.1.2`
- **Applies to:** .html, .htm, .tsx, .jsx
## What it checks
The role attribute must be a valid WAI-ARIA role. Misspelled or non-existent roles collapse the element's semantics to generic.
## Why it matters
Assistive technology maps role values to its own semantic model. A misspelled role (role='buton') is treated as no role at all — the button is announced as a generic container and keyboard/action affordances are lost. Abstract roles (role='widget') are reserved for the ARIA spec itself and have no effect in author code.
## Normative quote
> For all user interface components the name and role can be programmatically determined.
## Good example
```tsx
<div role="button" tabindex="0">Save</div>
```
## Bad example
```tsx
<div role="buton" tabindex="0">Save</div>
```
## References
- <https://www.w3.org/TR/WCAG22/#name-role-value>
- <https://www.w3.org/TR/wai-aria-1.2/#role_definitions>
