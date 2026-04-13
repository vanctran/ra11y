---
title: Authoring a ra11y standard plugin
audience: plugin authors
---

# Authoring a ra11y standard plugin

A **standard** is a set of accessibility criteria — WCAG 2.2, Section 508, EN 301 549, or an internal corporate guideline — represented as pure data. ra11y ships four built-in standards; plugins let you add your own.

The most important thing to know up front: **you almost never need to write rules when you write a standard.** If your corporate guideline aligns with existing WCAG criteria, use the `equivalentTo` field and ra11y's existing 41 rules cover you for free.

See the runnable reference at [`examples/plugin-standard/`](../../examples/plugin-standard/).

## The `defineStandard` surface

```ts
import { defineStandard } from "@ra11y/core/plugin";

export const standard = defineStandard({
  id: "your-org-guideline",
  name: "Your Org Accessibility Guidelines",
  version: "1.0",
  publisher: "Your Org",
  url: "https://your-org.example/a11y-guidelines",
  levels: ["base", "strict"],
  criteria: [
    {
      id: "your-org-guideline:1.1",
      standardId: "your-org-guideline",
      title: "All images must have a text alternative.",
      level: "base",
      url: "https://your-org.example/a11y-guidelines#1-1",
      equivalentTo: ["wcag22:1.1.1"],
    },
    // …
  ],
});
```

## Required fields

- `id` — globally unique, lowercase, hyphen-separated. Used as the prefix for criterion IDs (`your-org-guideline:1.1`).
- `name`, `version`, `publisher`, `url` — human-readable metadata for the `--list-standards` output and the VPAT report.
- `levels` — the conformance levels your standard defines. WCAG uses `["A", "AA", "AAA"]`. You can use any strings you want (e.g. `["base", "extended"]`).
- `criteria[]` — the actual content.

## Per-criterion fields

- `id` — `<standard-id>:<criterion-number>`. Must start with your standard's id.
- `standardId` — redundant with the prefix but enforced by the type system so typos are caught at compile time.
- `title` — one-line normative statement, preferably verbatim from the source document.
- `level` — must be a value from the parent standard's `levels` array.
- `url` — deep link to the criterion's anchor in the source document. Enforced: CI fails if the URL doesn't resolve.
- `equivalentTo` — **the most important field.** List WCAG criterion IDs (or other loaded-standard IDs) that this criterion is functionally equivalent to. The registry builds a bidirectional index from these, so any rule that satisfies a WCAG criterion automatically satisfies your criterion at scan time. No rule code required.

## Why `equivalentTo` is the whole game

ra11y's architecture separates *what to check* (rules) from *why it matters* (criteria) from *which framework cares* (standards). Corporate standards, jurisdiction-specific regulations (ADA, AODA, JIS), and industry guidelines (FedRAMP, HIPAA-related) almost universally derive from WCAG 2.x. Listing `equivalentTo: ["wcag22:X.Y.Z"]` on your criterion costs one line and unlocks 41 rules.

If your standard has a genuinely new requirement not covered by WCAG — say, your org mandates an `aria-describedby` on every input that references a policy page — then you write a custom rule in a sibling plugin and cite your criterion in its `satisfies` list. See [`authoring-a-rule.md`](./authoring-a-rule.md).

## Packaging

A standard plugin is a regular npm package with `@ra11y/core` in `peerDependencies`:

```jsonc
{
  "name": "ra11y-standard-your-org",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "peerDependencies": { "@ra11y/core": ">=0.1.0 <1.0.0" }
}
```

Users opt in via `ra11y.config.ts`:

```ts
import { defineConfig } from "@ra11y/core/plugin";
import yourOrg from "ra11y-standard-your-org";

export default defineConfig({
  plugins: { standards: [yourOrg] },
  standards: ["wcag22", "your-org-guideline"],
});
```

Then `ra11y --standard your-org-guideline src/` will run and violations will cite both WCAG and your standard.

## Testing

A standard plugin's test suite should assert:

1. The standard loads under `defineStandard` (surface hasn't drifted).
2. Every criterion's `equivalentTo` cites criteria that exist in the built-in set (no dangling references).
3. The criterion count matches the source document's count.
4. Every `url` is a real link (the `check-docs-links` guard, if you adopt it).

The [`examples/plugin-standard/test.ts`](../../examples/plugin-standard/test.ts) smoke test demonstrates the basic shape.

## See also

- [`authoring-a-rule.md`](./authoring-a-rule.md) — for the custom-rule side when `equivalentTo` isn't enough.
- [`docs/kb/architecture/three-layer-model.md`](../kb/architecture/three-layer-model.md) — explains how standards, criteria, and rules compose.
- [`docs/kb/patterns/writing-a-standard.md`](../kb/patterns/writing-a-standard.md) — the internal authoring checklist ra11y contributors follow when adding a built-in standard.
