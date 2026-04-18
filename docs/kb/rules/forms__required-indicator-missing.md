---
title: "forms/required-indicator-missing"
severity: "error"
scope: "document"
satisfies: ["wcag22:3.3.2", "wcag21:3.3.2"]
---
# `forms/required-indicator-missing`
- **Severity:** error
- **Scope:** document
- **Satisfies:** `wcag22:3.3.2`, `wcag21:3.3.2`
- **Applies to:** .tsx, .jsx
## What it checks
Component wrappers that forward a `required` prop to a native form control must render a visible required indicator or set aria-required.
## Why it matters
The `required` HTML attribute blocks submission but is not announced reliably across assistive tech. Screen-reader users and sighted users both need an up-front cue ('this field is required') to avoid submit-then-recover loops. Fixing this at the wrapper definition propagates the fix to every consumer — fixing it at call sites does not.
## Normative quote
> Labels or instructions are provided when content requires user input.
## Good example
```tsx
function EmailField({ required, ...rest }: Props) {
  return (
    <label>
      Email {required && <span aria-hidden="true">*</span>}
      <input type="email" required={required} aria-required={required} {...rest} />
    </label>
  );
}
```
## Bad example
```tsx
function EmailField({ required, ...rest }: Props) {
  return (
    <label>
      Email
      <input type="email" required={required} {...rest} />
    </label>
  );
}
```
## References
- <https://www.w3.org/TR/WCAG22/#labels-or-instructions>
- <https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html>
- <https://www.w3.org/WAI/WCAG22/Techniques/general/G131>
