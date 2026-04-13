---
title: "forms/labels-required"
severity: "error"
scope: "document"
satisfies: ["wcag22:1.3.1", "wcag21:1.3.1", "wcag22:3.3.2", "wcag21:3.3.2", "wcag22:4.1.2", "wcag21:4.1.2"]
---
# `forms/labels-required`
- **Severity:** error
- **Scope:** document
- **Satisfies:** `wcag22:1.3.1`, `wcag21:1.3.1`, `wcag22:3.3.2`, `wcag21:3.3.2`, `wcag22:4.1.2`, `wcag21:4.1.2`
- **Applies to:** .html, .htm, .tsx, .jsx
## What it checks
Form controls must have an accessible name — a <label>, aria-label, or aria-labelledby.
## Why it matters
Screen readers announce a form control's accessible name when the user tabs to it. Without a label, users hear 'edit' or 'combobox' and have no way to know what to type. A missing label is also a sighted-user problem: inputs without visible labels rely on placeholder text that disappears when the user starts typing.
## Normative quote
> Labels or instructions are provided when content requires user input.
## Good example
```tsx
<label for="email">Email</label>
<input id="email" type="email">
```
## Bad example
```tsx
<input type="email" placeholder="Email">
```
## References
- <https://www.w3.org/TR/WCAG22/#labels-or-instructions>
- <https://www.w3.org/WAI/WCAG22/Techniques/general/G131>
