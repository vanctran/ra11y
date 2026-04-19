---
title: Fix-suggestion audit (v1.0 ship gate)
audience: maintainer
layer: rules
generated: 2026-04-19
---

# Fix-suggestion audit (v1.0 ship gate)

This is the v1.0 audit output for CLAUDE.md §3 invariant 5: every violation must
carry a context-aware fix suggestion, not a generic boilerplate string. The
benchmark from `docs/kb/patterns/writing-a-rule.md` §"Violation emission": the
suggestion should include a code snippet or imperative that references the
offending element's concrete state — `Add alt describing the chart's message
(e.g., alt="revenue chart 2026")`, not `add alt text`.

Each row reflects a read-only inspection of the rule file's `suggestion` /
`fixPaths.primary.label` builders as of the generated date above. Classification
uses three verdicts:

- **context-aware** — the builder inspects surrounding AST nodes or attribute
  values and inlines concrete tokens (filename, href, id, role, aria value,
  contrast ratio, computed size, sibling line number, …) into the fix text.
  Same rule firing on two different elements produces materially different
  suggestions.
- **generic** — the builder returns the same constant string across every
  occurrence, or only branches on the tag kind the user already sees. Tag-only
  templating counts as generic: "Remove tabindex from `<div>`" vs "Remove
  tabindex from `<a>`" carries no information the caller didn't already have.
- **caveat-only** — the rule emits an advisory note without a concrete
  remediation path. Used for guidance-class rules that cannot propose a fix
  from static evidence alone.

`generic` rows are the fix-suggestion debt v1.0 has to clear. Each one needs
its own `feat(rules): context-aware fix for <rule>` follow-up commit that
threads one or more of: surrounding-element inspection, cross-element
references (label-for, sibling markers, ancestor role), filename/href-derived
example text, or the adjacent signal the rule is already reading to decide the
violation fires.

## Per-rule verdicts

| Rule ID | Fix class | Verdict | Context inputs | Notes |
|---|---|---|---|---|
| aria/conflicting-role | verify-in-source | context-aware | tagName, implicit role, explicit role | `remediationSuggestion` branches on button/link swap, landmark swap, heading/list/table mismatch; inlines a landmark-specific correct tag when applicable. |
| aria/hidden-focus | verify-in-source | context-aware | tagName, direct-vs-descendant path, child tag, edit-safety | `buildDirect/DescendantViolation` choose distinct `fixPaths` per variant; anchor-vs-input-vs-other branch for the non-focusable-swap alternative. |
| aria/invalid-role | mechanical | context-aware | offending role token, edit-distance suggestion | Emits `Did you mean role="X"?` with a Levenshtein-2 match when one exists; names the invalid token. |
| aria/live-region-valid | mechanical | context-aware | raw attribute value, tag, role, explicit-vs-implicit politeness | Five violation builders; each inlines the offending token and tailors advice per role-conflict combination. |
| aria/required-attrs | mechanical | context-aware | role, first missing attribute | `buildSuggestion` branches on aria-checked / aria-selected / aria-expanded / aria-valuenow with attribute-specific guidance. |
| aria/valid-attr | mechanical | context-aware | offending aria-* name, edit-distance suggestion | Emits `Did you mean aria-X?` when a Levenshtein-2 match exists; references the actual attribute name. |
| contrast/enhanced | guidance | context-aware | foreground source, background source, measured ratio, required minimum, large-text flag | Shared `buildContrastSuggestion` inlines both color tokens, the current ratio, the gap, and a rough darken-percentage. |
| contrast/minimum | guidance | context-aware | foreground source, background source, measured ratio, required minimum, large-text flag | Same `buildContrastSuggestion` helper as `contrast/enhanced`. |
| contrast/non-text | guidance | context-aware | CSS property, fg source, bg source, measured ratio | `buildSuggestion(prop, fgSource, bgSource, ratio)` — per-property boundary advice with the failing pair inlined. |
| document/iframe-title | mechanical | context-aware | `src` attribute | `describeSource` derives a human subject from the URL path and inlines it as an example `title` value. |
| document/lang-attribute | mechanical | generic | none (two static strings) | Fix text is the same canonical `lang="en"` advice for every document. No inspection of content, charset, or other lang signals. |
| document/lang-on-parts | mechanical | context-aware | attribute name, raw value, issue kind, canonical rewrite | Per-kind builders; underscore/uppercase branches compute the exact corrected value and inline it. |
| document/meta-refresh | guidance | context-aware | target URL, delay seconds | Branches on zero-delay vs delayed redirect, inlines the target URL into the suggested replacement link. |
| document/page-titled | mechanical | generic | none (two static strings) | Missing-title and empty-title branches each emit a constant string. Does not derive a title candidate from `<h1>`, URL, or content. |
| document/viewport-zoom | mechanical | context-aware | offending viewport directive, raw value | Inlines the offending directive name and value, with WCAG-specific threshold guidance per problem. |
| focus/not-obscured | guidance | context-aware | selector, declared height | `buildSuggestion` inlines the anchor selector and the candidate `scroll-padding-*` value derived from the declared height. |
| focus/outline-visible | guidance | context-aware | selector, scoped-vs-bare, Tailwind utility cross-reference | Inlines the selector in the remediation; appends a pragma-silencing note when the selector is class-scoped. |
| focus/tabindex-positive | mechanical | generic | tagName only | `Remove tabindex from <${tagName}>` + canonical tabindex="0"/"-1" guidance. Tag substitution is the only dynamism. |
| forms/autocomplete-missing | mechanical | context-aware | inferred autocomplete token | `Add autocomplete="${expected}"` — the expected token is derived from `type` / `name` / `id` heuristics. |
| forms/fieldset-legend | guidance | context-aware | fieldset subject (id/name), reason kind | Subject describes the actual `<fieldset>` by id or name; reason-kind branch picks empty-vs-missing advice. |
| forms/label-for-id-mismatch | mechanical | context-aware | `for` target, nearest existing id (Levenshtein-2), wraps-control flag | Emits `Did you mean id="X"?` when a typo-range match exists; appends a note when the label also wraps the control. |
| forms/labels-required | verify-in-source | context-aware | tagName, type, id, spread-props flag | Non-primitive path inlines tag + type + id; primitive-props branch suggests a pragma scoped to the rule. |
| forms/non-empty-label | guidance | generic | none (three static strings) | HTML / JSX / JSX-primitive branches each emit a constant. Does not reference the associated control's id or surrounding text. |
| forms/required-indicator-missing | verify-in-source | context-aware | wrapper component name, forwarded native tag | `buildSuggestion` inlines the component name and the native tag it forwards to; proposes concrete `aria-required` + indicator pair. |
| keyboard/accesskey-duplicate | verify-in-source | context-aware | token, first binding's tag/line/column | Names the colliding access-key, points at the earlier binding by file coordinates, flags the case-insensitive comparison. |
| keyboard/character-shortcuts | guidance | context-aware | first flagged key, event target, event name | Inlines the flagged key into a proposed `event.ctrlKey && event.key === "…"` guard and names the listener's target. |
| keyboard/handler-missing | guidance | context-aware | tagName, role | Role-branch inlines the actual role into the `onKeyDown` Enter/Space guidance; no-role branch recommends `<button>` by name. |
| layout/orientation-lock | guidance | context-aware | orientation, selector, declaration text, lock kind (hidden vs rotated) | Builder inlines the offending selector, the declaration, and the orientation axis; branches on hidden vs rotated. |
| layout/reflow-hardcoded-width | guidance | context-aware | property name, declared value | Inlines the offending property, value, and the reflow-threshold media-query breakpoint into the suggested rewrite. |
| layout/text-spacing | guidance | context-aware | CSS property name | Inlines the offending property into `Remove !important from '${property}'`; names specificity as the alternative lever. |
| media/alt-text-missing | mechanical | context-aware | tagName, `src` filename, derived subject | `buildSuggestion` inlines a humanized filename as the example alt text (`alt="revenue chart 2026"`). |
| media/autoplay-sound | guidance | context-aware | tag kind (audio vs video) | Two tag-specific suggestions with genuinely different advice: audio gets controls-or-muted guidance, video gets the `autoplay muted loop` pattern. |
| media/video-captions-missing | guidance | generic | tagName only (always "video") | Constant "Add a captions track: `<track kind=\"captions\" …>`". Does not inspect src, aria-label, or existing tracks. |
| motion/pause-stop-hide | guidance | context-aware | selector, animation property | Inlines the selector and property into a ready-to-copy `@media (prefers-reduced-motion: reduce)` override. |
| navigation/link-descriptive-text | guidance | context-aware | href, generic-phrase token, derived destination hint | Inlines the offending phrase and a URL-derived destination candidate into the replacement suggestion. |
| navigation/link-no-href | mechanical | generic | none | Constant "If this element navigates, add href=…" text. Does not inspect onClick body, aria-label, or parent. |
| navigation/skip-link | mechanical | context-aware | targetId branch | Missing-id branch inlines the expected `id="${targetId}"` value from the skip-link href. Missing-link and wrong-first-link branches are constants but coexist with a context-aware third branch. |
| parsing/duplicate-id | mechanical | generic | tagName only | "Change this `<${tag}>`'s id to something unique" — tag-only substitution. Does not propose a unique candidate or point at the earlier binding. |
| parsing/html-has-lang | mechanical | context-aware | tagName, raw value, trimmed vs raw, underscore-vs-hyphen, guessed BCP 47 code | `buildInvalidSuggestion` computes a concrete rewrite per issue shape (dashed form, BCP-47 guess from full-word name). |
| pointer/cancellation | guidance | context-aware | tagName, list of down-events | Maps each down-event to its correct up-event (`onMouseDown` → `onMouseUp`, `onTouchStart` → `onTouchEnd`). |
| pointer/drag-alternative | guidance | context-aware | tagName, drag-signal tokens, imported library name | Element-level builder names the tag and the exact drag-signal that fired; file-level builder cites the imported library. |
| pointer/target-size | guidance | context-aware | selector/tag, declared width/height, padding, measured size text | Computes the exact pixel delta and proposes concrete `width: 24px` / `height: 24px` / `padding` deltas to reach the 24×24 floor. |
| semantics/button-name | guidance | generic | none (two static strings) | Error branch and primitive-props branch each emit the same canonical "Add visible text, aria-label, or aria-labelledby" text. Does not inspect icon-child, form context, or action verb. |
| semantics/empty-heading | guidance | generic | tagName only | `Add descriptive text inside <${tagName}>` — tag is the only dynamism. Does not inspect sibling context or page title. |
| semantics/heading-hierarchy | guidance | context-aware | previous level, current level | Inlines the exact `h${previous+1}` the heading should become, plus the gap width. |
| semantics/label-in-name | guidance | context-aware | visible text, aria-label, interleaved-expansion detection, case-mismatch words | Ranked `fixPaths`; optional `editCandidate` when visible-text tokens are non-contiguous in the aria-label. |
| semantics/landmark-main | guidance | generic | none (two static strings) | Missing-main and extra-main branches each emit a constant. Does not inspect which `<section>` / `<article>` looks like the strongest main candidate. |
| semantics/list-structure | guidance | context-aware | parent tag, child tag, primitive-vs-wrong-child flag | Stray-li and primitive branches are tag-templated; wrong-child branch inlines both parent and child tags into the fix. |
| semantics/nested-interactive | verify-in-source | context-aware | outer descriptor, inner descriptor, outer-open line number | `describeHtml` / `describeJsx` compose tag + identifying attrs into the descriptors; suggestion inlines both. |
| semantics/table-headers | guidance | generic | none | Constant "Add `<th scope=\"col\">` cells in the first `<tr>`…" text. Does not inspect caption, layout-table signals, or cell structure. |
| tooltip/dismissable | guidance | context-aware | tagName, offending title text (truncated) | Inlines the title text into the proposed `aria-label="${title}"` replacement and the visible-label alternative. |
| wrapper/drift | verify-in-source | context-aware | wrapper name, declared element, actual rendered element, definition file path | Proposes two concrete fixes and names the `ra11y.config.ts` entry to change, inlining the path the agent should read. |

## Summary

Verdict distribution:

- context-aware: 41
- generic: 11
- caveat-only: 0

Rules flagged `generic` (need per-rule `feat(rules): context-aware fix for <rule>` follow-up commits before v1.0):

- `document/lang-attribute`
- `document/page-titled`
- `focus/tabindex-positive`
- `forms/non-empty-label`
- `media/video-captions-missing`
- `navigation/link-no-href`
- `parsing/duplicate-id`
- `semantics/button-name`
- `semantics/empty-heading`
- `semantics/landmark-main`
- `semantics/table-headers`

No rows flagged `needs-review` — every rule's fix builder read cleanly under
inspection. No runtime bugs (ReferenceErrors, unsafe expressions) were spotted
during the audit.

## Follow-up guidance (for the per-rule tightening commits)

Suggested context inputs by rule — these are read-only recommendations, not
commitments; the implementer reads the rule file and decides:

- `document/lang-attribute`: derive a candidate lang value from the scan's
  other documents (if they all have `lang="en"`, suggest that) or from the
  document's `<meta charset>` / OS locale signals the scanner has.
- `document/page-titled`: when `<h1>` text is present, surface it as the
  candidate title (`<title>${h1Text}</title>`).
- `focus/tabindex-positive`: inline the offending `tabindex` value
  (`tabindex="5"`) and the role or interactivity state of the element; branch
  on whether the element is natively interactive (drop tabindex entirely) vs.
  custom (consider `tabindex="0"`).
- `forms/non-empty-label`: when the label has a `for` / `htmlFor` target,
  inline the referenced control's tag and id in the suggestion
  (`the control at id="email"`).
- `media/video-captions-missing`: derive the language from the document
  `lang` attribute for the `srclang` example; check existing `<source>`
  children and inline that filename's basename as the `.vtt` path hint.
- `navigation/link-no-href`: inspect the onClick body — if it's navigation,
  recommend `href={route}`; if it's a mutation, recommend `<button>` and
  name the handler's identifier.
- `parsing/duplicate-id`: cite the earlier binding's file coordinates (line,
  column, tag) — the rule already has them in `first` on the local map.
- `semantics/button-name`: inspect icon-only (`<svg>` / `<img>` only child)
  vs. empty; name the icon filename or svg title child when present as the
  aria-label candidate.
- `semantics/empty-heading`: cite the document's existing heading outline so
  the suggestion can reference the section's surrounding context.
- `semantics/landmark-main`: when two `<main>` elements exist, name both by
  id/class so the reader knows which to demote; missing-main branch can
  highlight the largest top-level block (already captured in
  `looksLikeFullPage`).
- `semantics/table-headers`: inspect the first row — if it contains `<td>`
  elements whose text looks header-shaped (short, title-case), suggest
  converting those specific cells to `<th scope="col">`.
- `parsing/duplicate-id` + `semantics/button-name`: both can adopt the
  "name a concrete candidate" pattern already used by `forms/label-for-id-mismatch`
  and `aria/invalid-role` (Levenshtein-nearest "Did you mean?" suggestion).

The v1.0 acceptance gate is zero `generic` rows in this table. Each
follow-up commit MUST re-run this audit (manually for the row under change)
and update the verdict cell.
