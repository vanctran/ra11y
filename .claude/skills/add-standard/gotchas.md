# /add-standard gotchas

## Forgetting equivalentTo is the moat

If you forget to populate `equivalentTo` on Section 508 / EN 301 549 criteria, the rule engine won't surface existing WCAG rules for that standard and you'll think you need to reimplement them. **Always** map to WCAG where possible. Check the reciprocal index via the golden-file test.

## Criterion IDs are globally unique

`<standardId>:<localId>`. Never reuse a standardId across standards. If a plugin author proposes `wcag22-custom`, reject it — that's confusing. Use `company-custom` or similar.

## Level names are strings

WCAG has A/AA/AAA. EN 301 549 uses `base`. Some corporate guidelines use `foundation`/`enhanced`. Let the standard declare its own level vocabulary via `levels: readonly string[]` on the Standard object. Do not hard-code A/AA/AAA in the engine.

## Spec URLs must resolve

CI runs a link checker on every `criterion.url`. Dead links fail the build. When adding EN 301 549 criteria, use the `etsi.org` deep links, not the `mandate376.standards.eu` mirror.

## Version pinning

`Standard.version` should be the full version as published (e.g., `"2.2"` for WCAG, `"v3.2.1"` for EN 301 549). When the spec updates, bump this and note it in the changelog.
