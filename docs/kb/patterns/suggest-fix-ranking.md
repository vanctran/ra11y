---
title: "suggest_fix ranking and fixClass semantics"
topic: pattern
audience: agent
related:
  - fixClass
  - suggest_fix
  - FixPath
  - FixPaths
---

# suggest_fix ranking and fixClass semantics

When an agent calls `suggest_fix`, the response either carries a direct `kind: "edit"` with a ready-to-apply `oldText/newText` pair, or a `kind: "guidance"` response with a ranked `primary` fix path and zero or more `alternatives`. This page explains how those two axes — the `primary`/`alternatives` ranking and the rule-level `fixClass` — interact, which rules produce guidance-only responses, and why a proposed `confidenceRationale` field was deferred.

## The two axes

`fixClass` and `suggest_fix.kind` are distinct fields on two different objects describing two different things:

| Field | Where | What it describes |
|---|---|---|
| `fixClass` | `Violation` (stamped at scan time) | The *nature* of the fix the rule demands |
| `kind` | `suggest_fix` response | What the payload *contains* |

A rule with `fixClass: "mechanical"` produces violations the engine routes to the batch-edit queue. When the agent calls `suggest_fix` on one of those violations, it gets `kind: "edit"` with `primary.edit` populated — the two usually coincide. But they are logically independent (see ADR 0007).

## Routing at scan time with `fixClass`

`fixClass` is stamped onto every `Violation` at emit time so an agent can batch-route findings from `scan_project` or `scan_file` without calling `suggest_fix` per finding.

```
mechanical       → batch-apply via apply_fix / Edit
guidance         → agent reads source, writes tailored fix
runtime-only     → defer to axe-core / Playwright lane
verify-in-source → open the referenced file, read adjacent code
```

The four values and their remediation lanes:

**`"mechanical"`** — The fix is a deterministic source transform: insert a missing `alt` attribute, correct a misspelled ARIA role name, add a `lang` attribute. Safe to apply without reading surrounding code. Rules in this class: `media/alt-text-missing`, `parsing/html-has-lang`, `focus/tabindex-positive`, `keyboard/accesskey-duplicate`, `parsing/duplicate-id`, `aria/invalid-role`, `forms/autocomplete-missing`, `aria/valid-attr`, `forms/label-for-id-mismatch`, `document/page-titled`, `document/viewport-zoom`, `document/lang-attribute`, `document/lang-on-parts`, `document/iframe-title`, `document/meta-refresh`.

**`"guidance"`** — The fix requires author judgment: choosing a color pair that passes contrast, rewriting link text to be descriptive, rearranging a label hierarchy. The scanner can explain the problem and rank the options; the agent writes the fix. Rules in this class: `contrast/minimum`, `contrast/enhanced`, `contrast/non-text`, `keyboard/character-shortcuts`, `semantics/label-in-name`, `forms/non-empty-label`, `navigation/link-descriptive-text`, `pointer/target-size`, `wrapper/drift`.

**`"runtime-only"`** — The scanner flags the pattern, but only runtime verification (axe-core in Playwright or Vitest) can confirm the violation or measure the fix. Route these to the runtime harness. Rules in this class: `tooltip/dismissable`, `motion/pause-stop-hide`.

**`"verify-in-source"`** — The agent must read adjacent code to decide what the right fix is: the keyboard handler might be on a parent, the focus management might be in a different file, the nested-interactive structure requires DOM surgery that spans siblings. Rules in this class: `navigation/link-no-href`, `focus/outline-visible`, `semantics/table-headers`, `pointer/cancellation`, `media/video-captions-missing`, `media/autoplay-sound`, `focus/not-obscured`, `pointer/drag-alternative`, `semantics/nested-interactive`, `layout/reflow-hardcoded-width`, `forms/fieldset-legend`, `semantics/list-structure`, `layout/orientation-lock`, `keyboard/handler-missing`, `semantics/heading-hierarchy`, `semantics/landmark-main`, `layout/text-spacing`, `navigation/skip-link`, `semantics/empty-heading`, `aria/hidden-focus`, `forms/labels-required`, `aria/live-region-valid`, `aria/required-attrs`, `semantics/button-name`, `aria/conflicting-role`, `forms/required-indicator-missing`.

## The `primary`/`alternatives` ranking contract

When a violation carries `fixPaths`, `suggest_fix` forwards the ranked paths verbatim (after optionally widening `primary.edit` to a unique anchor for `apply_fix`). The `primary` represents the rule's highest-confidence transformation for the diagnosed pattern. Alternatives are equally correct in spec terms but trade off on ergonomics, style, or completeness.

A caller should always try `primary` first. Fall through to `alternatives[0]`, then `alternatives[1]`, when context rules the primary out — for instance, when the primary says "widen aria-label" but the label is already maximal.

The rule computes the ranking from structural signals available in the AST snippet: presence of icon-like characters in visible text, whether the aria-label tokens are an interleaved expansion of the visible text, whether the aria-label is a superset-adjacent phrase. The ranking is a heuristic, not a guarantee, but it is always better than forcing the agent to re-read the source to disambiguate three equal options.

### `primary.edit` vs `primary.editCandidate`

A `FixPath` carries at most one of two optional edit fields:

- **`edit`** — a deterministic `{ oldText, newText }` pair that `apply_fix` can apply verbatim. When `primary.edit` is populated, `suggest_fix` returns `kind: "edit"`. The text is widened via `widenToUniqueAnchor` before serialization so `apply_fix`'s literal find-and-replace matches exactly once. If no unique anchor fits within the cap, a `caveat` string appears on the response so the agent can disambiguate.

- **`editCandidate`** — a synthesized starting-point rewrite the rule proposes "if it had to." Same shape as `edit`, but the caller must decide whether the text is right before applying it. The response `kind` stays `"guidance"` even when `editCandidate` is populated. This is for cases where a templated rewrite is useful (e.g., `semantics/label-in-name` in the interleaved-expansion case can propose a rephrase) but the exact phrasing is genuinely the author's call.

Never treat `editCandidate` as a mechanical patch. It signals "here is what the fix might look like" — apply it only after reading the source and confirming the proposed text makes sense in context.

### How `fixClass` interacts with ranking

When a rule's `fixClass` is `"mechanical"`, the primary path carries `edit` and the response is `kind: "edit"`. Alternatives, if present, are also labeled paths without edits — they describe alternative approaches if the mechanical primary is wrong (e.g., "use an aria-labelledby instead of inserting alt text").

When `fixClass` is `"guidance"`, no path carries `edit`. The response is `kind: "guidance"`. The primary is still the most-likely-right guidance path — "all guidance, no edit" does not mean "all options are equal." The ranking logic described above applies to guidance responses the same way it applies to edit responses.

When `fixClass` is `"verify-in-source"`, `suggest_fix` may still return a `kind: "guidance"` response with ranked paths — the two rules that emit `fixPaths` in this class (`aria/hidden-focus`, `semantics/label-in-name`) do so. The class signals that the agent must read adjacent code regardless; `fixPaths` is additive context, not a substitute for that read.

## Rules that emit guidance-only responses

These rules have `fixClass: "guidance"` and never emit `primary.edit`. The `suggest_fix` response is always `kind: "guidance"`.

- **`contrast/minimum`** — Color-pair rewrite requires choosing a new color value; the scanner reports the failing ratio and the threshold but cannot select a conformant palette.
- **`contrast/enhanced`** — Same as `contrast/minimum` but for the AAA 7:1 / 4.5:1 thresholds.
- **`contrast/non-text`** — Border/outline or fill/stroke rewrite for UI components and graphics.
- **`keyboard/character-shortcuts`** — Adding a modifier key, building a remap UI, or scoping the listener to focus — all require restructuring logic the scanner cannot determine.
- **`semantics/label-in-name`** — Three ranked paths (widen aria-label, rephrase to contiguous substring, hide decorative icon). An `editCandidate` appears on the primary when the interleaved-expansion case is detected, but the response stays `kind: "guidance"`.
- **`forms/non-empty-label`** — The label text content must come from the author; the scanner cannot synthesize a meaningful label string.
- **`navigation/link-descriptive-text`** — The replacement link text must describe the destination; the scanner knows only that the current text is generic.
- **`pointer/target-size`** — The agent must add or adjust size/padding declarations; the right approach depends on the surrounding layout context.
- **`wrapper/drift`** — Restoring the native element or updating the config declaration requires understanding the component's intended rendering behavior.

## After applying a fix: `verifyCommand` and `verifyCommandStructured`

Every `suggest_fix` response carries:

- `verifyCommand` — prose instruction naming `scan_file` as the re-check step.
- `verifyCommandStructured` — `{ tool: "scan_file", args: { file, ruleId } }` for programmatic consumption.

Both are always present — a fix without a re-verify is never complete. The structured form's `ruleId` is advisory: `scan_file` does not filter by rule, but the field documents "what you were fixing" so a downstream consumer can post-filter the re-scan's findings to the specific rule.

After applying a mechanical edit via `apply_fix`, call `scan_file` immediately and confirm the rule no longer fires at the original line. After applying guidance, do the same — guidance responses can miss edge cases the agent catches after reading the source.

```
suggest_fix → apply fix (edit or guided rewrite) → scan_file → confirm rule absent
```

Use `nextStep` on the `suggest_fix` response to find the canonical next call if you're unsure.

## Decision: defer `confidenceRationale?: string`

The backlog item asked whether to add `confidenceRationale?: string` on guidance responses to explain why `primary` was ranked above alternatives.

**Decision: defer.**

The existing surfaces already carry the signal:

- The `primary.label` is a human-readable sentence explaining what to do and why it fits the diagnosed pattern (e.g., "widen aria-label to contain the visible text as a contiguous substring, e.g. aria-label='Send — additional context'").
- The `explanation` field on the `suggest_fix` response carries the full `suggestion` string from the violation, which `semantics/label-in-name` populates with the expansion note and case-mismatch note alongside the ranked primary.
- The `caveat` field on `kind: "edit"` responses carries disambiguation prose when the anchor window isn't unique.

`confidenceRationale` would duplicate that prose under a different key. Per CLAUDE.md §14, abstractions added for imagined consumers rather than concrete ones are a liability — more drift surface, more shape to maintain. If a specific downstream consumer files a concrete need (e.g., "I need the ranking rationale in a structured field to drive a UI picker"), that is the right time to add the field. The deferral is recorded here so future maintainers understand why it was considered and what would justify revisiting it.

## See also

- [`docs/adr/0007-violation-fix-class-metadata.md`](../../adr/0007-violation-fix-class-metadata.md) — decision record for `fixClass`.
- [`docs/kb/architecture/ai-first-consumer.md`](../architecture/ai-first-consumer.md) — why the agent reads every candidate rather than relying on suppression or buckets.
- [`docs/kb/patterns/writing-a-rule.md`](writing-a-rule.md) — how to declare `fixClass` when authoring a rule.
- [`src/types/violation.ts`](../../../src/types/violation.ts) — canonical `FixPath`, `FixPaths`, `FixClass` type definitions.
- [`src/mcp/tool-suggest-fix-internals.ts`](../../../src/mcp/tool-suggest-fix-internals.ts) — the payload builder that assembles the `suggest_fix` response from a matched violation.
