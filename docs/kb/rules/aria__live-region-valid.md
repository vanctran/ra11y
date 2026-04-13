---
title: "aria/live-region-valid"
severity: "error"
scope: "node"
satisfies: ["wcag22:4.1.3", "wcag21:4.1.3"]
---
# `aria/live-region-valid`
- **Severity:** error
- **Scope:** node
- **Satisfies:** `wcag22:4.1.3`, `wcag21:4.1.3`
- **Applies to:** .html, .htm, .tsx, .jsx
## What it checks
Live region declarations must use valid ARIA token values, and an explicit aria-live must not contradict the politeness implied by a live-region role.
## Why it matters
Status messages are announced to screen reader users via live regions. If aria-live, aria-atomic, or aria-relevant carries an invalid token, assistive tech treats the attribute as absent and the status update is silently dropped. Likewise, pairing role="status" (implicitly polite) with aria-live="assertive" is contradictory: some screen readers honor the role, others honor the attribute, and the resulting behavior is unpredictable. Catching these declarations statically prevents announcements that authors intend but never reach the user.
## Normative quote
> In content implemented using markup languages, status messages can be programmatically determined through role or properties such that they can be presented to the user by assistive technologies without receiving focus.
## Good example
```tsx
<div role="status" aria-atomic="true">Saved.</div>
```
## Bad example
```tsx
<div role="status" aria-live="assertive">Saved.</div>
```
## References
- <https://www.w3.org/TR/WCAG22/#status-messages>
- <https://www.w3.org/TR/wai-aria-1.2/#aria-live>
- <https://www.w3.org/TR/wai-aria-1.2/#aria-atomic>
- <https://www.w3.org/TR/wai-aria-1.2/#aria-relevant>
