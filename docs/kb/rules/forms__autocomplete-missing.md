---
title: "forms/autocomplete-missing"
severity: "warning"
scope: "node"
satisfies: ["wcag22:1.3.5", "wcag21:1.3.5"]
---
# `forms/autocomplete-missing`
- **Severity:** warning
- **Scope:** node
- **Satisfies:** `wcag22:1.3.5`, `wcag21:1.3.5`
- **Applies to:** .html, .htm, .tsx, .jsx
## What it checks
Input fields collecting personal information (name, email, address, phone) should declare an autocomplete value so browsers and assistive tech can autofill them.
## Why it matters
Autocomplete tokens are how password managers, symbol-based input aids, and browser autofill understand what an input is for. Users with cognitive disabilities rely on these aids heavily — an email field without autocomplete='email' turns a one-tap autofill into a manual re-entry.
## Normative quote
> The purpose of each input field collecting information about the user can be programmatically determined.
## Good example
```tsx
<input type="email" name="email" autocomplete="email">
```
## Bad example
```tsx
<input type="email" name="email">
```
## References
- <https://www.w3.org/TR/WCAG22/#identify-input-purpose>
- <https://www.w3.org/TR/WCAG21/#input-purposes>
