---
title: "document/lang-on-parts"
severity: "error"
scope: "node"
satisfies: ["wcag22:3.1.2", "wcag21:3.1.2"]
---
# `document/lang-on-parts`
- **Severity:** error
- **Scope:** node
- **Satisfies:** `wcag22:3.1.2`, `wcag21:3.1.2`
- **Applies to:** .html, .htm, .tsx, .jsx
## What it checks
Validates the BCP 47 shape of `lang` and `xml:lang` attributes on non-`<html>` elements. Detecting missing lang on foreign passages requires natural-language analysis; flagging malformed tags is the high-signal subset that can be checked statically.
## Why it matters
Screen readers switch pronunciation dictionaries based on the lang attribute. A malformed tag (`en_US`, empty string, `english`) silently fails to match any installed dictionary, so the wrong voice continues reading the passage. Authors usually intend a real language code; flagging the shape catches copy-paste mistakes from POSIX locales and typos before they ship.
## Normative quote
> The human language of each passage or phrase in the content can be programmatically determined, except for proper names, technical terms, words of indeterminate language, and words or phrases that have become part of the vernacular of the immediately surrounding text.
## Good example
```tsx
<p>The French phrase <span lang="fr">c'est la vie</span> means "that's life".</p>
```
## Bad example
```tsx
<p>The French phrase <span lang="fr_FR">c'est la vie</span> means "that's life".</p>
```
## References
- <https://www.w3.org/TR/WCAG22/#language-of-parts>
- <https://www.w3.org/WAI/WCAG22/Techniques/html/H58>
- <https://www.rfc-editor.org/rfc/rfc5646>
