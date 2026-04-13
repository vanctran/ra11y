---
title: "aria/required-attrs"
severity: "error"
scope: "node"
satisfies: ["wcag22:4.1.2", "wcag21:4.1.2"]
---
# `aria/required-attrs`
- **Severity:** error
- **Scope:** node
- **Satisfies:** `wcag22:4.1.2`, `wcag21:4.1.2`
- **Applies to:** .html, .htm, .tsx, .jsx
## What it checks
ARIA roles with required states or properties must declare them. role='checkbox' needs aria-checked; role='slider' needs aria-valuenow; etc.
## Why it matters
When you assign a role, you promise assistive tech that the element behaves like that role. If the role requires a state attribute and you don't provide one, screen readers announce the element with unknown state — the user can't tell if the checkbox is checked or the slider's current value.
## Normative quote
> The name and role can be programmatically determined; states, properties, and values that can be set by the user can be programmatically set.
## Good example
```tsx
<div role="checkbox" aria-checked="false" tabindex="0">Remember me</div>
```
## Bad example
```tsx
<div role="checkbox" tabindex="0">Remember me</div>
```
## References
- <https://www.w3.org/TR/WCAG22/#name-role-value>
- <https://www.w3.org/TR/wai-aria-1.2/#requiredState>
