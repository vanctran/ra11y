---
title: "forms/non-empty-label"
severity: "error"
scope: "document"
satisfies: ["wcag22:2.4.6", "wcag21:2.4.6", "wcag22:1.3.1", "wcag21:1.3.1"]
---
# `forms/non-empty-label`
- **Severity:** error
- **Scope:** document
- **Satisfies:** `wcag22:2.4.6`, `wcag21:2.4.6`, `wcag22:1.3.1`, `wcag21:1.3.1`
- **Applies to:** .html, .htm, .tsx, .jsx
## What it checks
<label> elements must contain descriptive text. Empty labels announce controls as unnamed and defeat assistive-tech navigation.
## Why it matters
Screen readers announce a form control by the text of its associated <label>. An empty label means the user hears 'edit' or 'combobox' with no hint as to what to type. An empty label is often a bug — someone wrapped `<input>` in `<label>` then forgot to add the visible text, or they pushed label text into a sibling div that styles as a label but isn't one.
## Normative quote
> Headings and labels describe topic or purpose.
## Good example
```tsx
<label for="email">Email address</label><input id="email">
```
## Bad example
```tsx
<label for="email"></label><input id="email">
```
## References
- <https://www.w3.org/TR/WCAG22/#headings-and-labels>
- <https://www.w3.org/WAI/WCAG22/Techniques/general/G131>
