---
title: "forms/fieldset-legend"
severity: "error"
scope: "node"
satisfies: ["wcag22:1.3.1", "wcag21:1.3.1", "wcag22:3.3.2", "wcag21:3.3.2"]
---
# `forms/fieldset-legend`
- **Severity:** error
- **Scope:** node
- **Satisfies:** `wcag22:1.3.1`, `wcag21:1.3.1`, `wcag22:3.3.2`, `wcag21:3.3.2`
- **Applies to:** .html, .htm, .tsx, .jsx
## What it checks
<fieldset> elements must have a non-empty <legend> as their first element child, or an aria-label / aria-labelledby fallback, so the group has an accessible name.
## Why it matters
A fieldset groups related controls (radios, checkboxes, address parts). Screen readers announce the legend as the group's accessible name — 'Shipping speed, radio group, 3 items'. Without a legend, users hear only 'radio group' with no clue what the choice is about, and the structural relationship conveyed visually is lost programmatically.
## Normative quote
> Information, structure, and relationships conveyed through presentation can be programmatically determined or are available in text.
## Good example
```tsx
<fieldset>
  <legend>Shipping speed</legend>
  <label><input type="radio" name="speed" value="std"> Standard</label>
  <label><input type="radio" name="speed" value="exp"> Express</label>
</fieldset>
```
## Bad example
```tsx
<fieldset>
  <label><input type="radio" name="speed" value="std"> Standard</label>
  <label><input type="radio" name="speed" value="exp"> Express</label>
</fieldset>
```
## References
- <https://www.w3.org/TR/WCAG22/#info-and-relationships>
- <https://www.w3.org/TR/WCAG22/#labels-or-instructions>
- <https://html.spec.whatwg.org/multipage/form-elements.html#the-fieldset-element>
- <https://www.w3.org/WAI/WCAG22/Techniques/html/H71>
