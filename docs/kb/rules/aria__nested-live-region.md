---
title: "aria/nested-live-region"
severity: "error"
scope: "document"
satisfies: ["wcag22:4.1.3", "wcag21:4.1.3"]
---
# `aria/nested-live-region`
- **Severity:** error
- **Scope:** document
- **Satisfies:** `wcag22:4.1.3`, `wcag21:4.1.3`
- **Applies to:** .tsx, .jsx, .html, .htm
## What it checks
An element that declares a live region must not be nested inside another live region in the same document — the resulting announcement behavior is undefined and screen readers commonly re-announce the outer region on every descendant mutation.
## Why it matters
WAI-ARIA does not define the resolution when two live regions overlap. Screen readers diverge: some announce only the outer, some announce both (duplicate), some honor the inner role override, and several treat any mutation under the outer live region as a change to the whole outer region — re-announcing every existing descendant. The user-perceived failure is duplicate or stuttering announcements, or whole-region re-reads triggered by a single update. Status messages then fail SC 4.1.3 because the new content cannot be programmatically determined as a discrete announcement.
## Normative quote
> In content implemented using markup languages, status messages can be programmatically determined through role or properties such that they can be presented to the user by assistive technologies without receiving focus.
## Good example
```tsx
<ul aria-live="polite" aria-relevant="additions">
  <li>Item A</li>
  <li>Item B</li>
</ul>
```
## Bad example
```tsx
<ul aria-live="polite" aria-relevant="additions">
  <li role="status">Saved.</li>
</ul>
```
## References
- <https://www.w3.org/TR/WCAG22/#status-messages>
- <https://www.w3.org/TR/wai-aria-1.2/#aria-live>
- <https://www.w3.org/TR/wai-aria-1.2/#status>
- <https://www.w3.org/TR/wai-aria-1.2/#alert>
- <https://www.w3.org/TR/wai-aria-1.2/#log>
- <https://www.w3.org/TR/html-aam-1.0/#el-output>
