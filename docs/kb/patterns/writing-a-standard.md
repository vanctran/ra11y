---
title: "Writing a standard"
topic: pattern
audience: contributors, plugin authors
---

# Writing a standard

The internal contributor checklist for adding a built-in standard. Plugin authors should also read [`docs/plugins/authoring-a-standard.md`](../../plugins/authoring-a-standard.md) for the package-side extras.

## Shortcut: the `/add-standard` skill

For WCAG-derivative standards (Section 508, EN 301 549, national a11y regulations, corporate guidelines), the `/add-standard <id>` skill delegates criteria enumeration to `spec-researcher` and scaffold-building to `standard-builder`. Use it. The steps below are what it does under the hood.

## File layout

```
src/standards/<id>/
  metadata.ts     — id, name, version, publisher, url, levels
  criteria.ts     — the Criterion[] array
  standard.ts     — exports { id, ...metadata, criteria } as a Standard
```

Register in `src/standards/index.ts`.

## The big decision: `equivalentTo`

If your new standard references WCAG (most do), the single most important authoring step is getting `equivalentTo` right. A criterion like Section 508 §1194.22(a) — "A text equivalent for every non-text element shall be provided" — is the same check as WCAG 1.1.1.

```ts
{
  id: "section508:1194.22.a",
  standardId: "section508",
  title: "Text equivalent for every non-text element.",
  level: "base",
  url: "https://www.access-board.gov/ict/#1194.22",
  equivalentTo: ["wcag22:1.1.1", "wcag21:1.1.1"],
},
```

The engine's reciprocal closure fans rule coverage across the equivalence class. Zero new rules required for a standard that is fully WCAG-derivative.

If a criterion has no WCAG equivalent, omit `equivalentTo`. Then ship a sibling rule in `src/rules/` with `satisfies: ["<your-standard>:<criterion-id>"]`.

## Testing

Every standard ships with `tests/unit/standards/<id>.test.ts` asserting:

1. Criterion count matches the source document. A miscount usually means a copy-paste error.
2. Every `url` is a syntactically valid absolute URL.
3. Level distribution matches the source document (e.g. WCAG 2.2 has 30 A, 24 AA, 23 AAA criteria; count them).
4. Every `equivalentTo` reference resolves to a criterion in a loaded standard.
5. Reciprocal equivalence check: if this standard says `a:1 ≡ b:1`, the registry's closure should find a round-trip path.

See `tests/unit/standards/wcag22.test.ts` for the golden-file pattern.

## Checklist before committing

- [ ] `metadata.ts` has id, name, version, publisher, url, levels.
- [ ] Every criterion has id prefixed with the standard id.
- [ ] Every criterion has a `url` that resolves.
- [ ] `equivalentTo` populated for every WCAG-derived criterion.
- [ ] Registered in `src/standards/index.ts`.
- [ ] Tests cover count, levels, URLs, equivalence.
- [ ] `bun run verify` passes.
- [ ] Integration test: `tests/integration/multi-standard-scan.test.ts` pattern — enable the new standard alongside WCAG, confirm existing violations cite both.

## See also

- [`docs/kb/architecture/three-layer-model.md`](../architecture/three-layer-model.md) — why standards are pure data.
- [`docs/plugins/authoring-a-standard.md`](../../plugins/authoring-a-standard.md) — the plugin-side packaging.
- [ADR 0002](../../adr/0002-three-layer-standards-criteria-rules.md) — the decision rationale for this architecture.
