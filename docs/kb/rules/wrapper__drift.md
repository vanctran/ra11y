---
title: "wrapper/drift"
severity: "error"
scope: "project"
satisfies: ["wcag22:4.1.2", "wcag21:4.1.2"]
---
# `wrapper/drift`
- **Severity:** error
- **Scope:** project
- **Satisfies:** `wcag22:4.1.2`, `wcag21:4.1.2`
## What it checks
A component declared in `nativeWrappers` whose definition no longer renders the expected native element.
## Why it matters
Declaring `{ Button: 'button' }` tells other rules to treat every `<Button>` call site as-if it were `<button>`. If the definition drifts to `<div>`, every call-site check built on that declaration is silently suppressed — and the WCAG 4.1.2 failures at those call sites never reach the agent. Emitting once at the definition file makes the drift visible without re-noising each call site.
## Normative quote
> For all user interface components, the name and role can be programmatically determined; states, properties, and values that can be set by the user can be programmatically set.
## Good example
```tsx
// ra11y.config.ts declares { Button: "button" }
// src/components/Button.tsx
export function Button(props) {
  return <button {...props} />;
}
```
## Bad example
```tsx
// ra11y.config.ts declares { Button: "button" }
// src/components/Button.tsx — drifted from <button> to <div>
export function Button(props) {
  return <div role="button" {...props} />;
}
```
## References
- <https://www.w3.org/TR/WCAG22/#name-role-value>
- <https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html>
