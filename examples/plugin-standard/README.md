# Example: custom ra11y standard plugin

This directory shows how to ship a custom accessibility standard as a ra11y plugin. The example is "Acme Corp Accessibility Guidelines" — a tiny corporate internal guideline with 5 criteria, all of which reference WCAG 2.2 via `equivalentTo`.

## The architectural moat

The entire point of ra11y's three-layer (Standards → Criteria → Rules) model is that **you don't rewrite rule code to add a new standard**. You enumerate your criteria as pure data, point each criterion at its WCAG equivalent, and the registry's reciprocal closure automatically gives your standard coverage for every WCAG rule that already exists.

This example adds a 5-criterion standard with zero lines of rule code. Running `ra11y --standard acme` against a bad fixture produces the same violations the default `ra11y --standard wcag22` run produces — but the violation records cite `acme:a.1`, `acme:a.2`, etc. instead of (or in addition to) `wcag22:1.1.1`.

## File layout

```
plugin-standard/
├── package.json         # name, peerDependency on @ra11y/core
├── standard.ts          # the defineStandard call — pure data
└── README.md            # this file
```

## Using it

```ts
// ra11y.config.ts
import { defineConfig } from "@ra11y/core";
import acme from "./examples/plugin-standard/standard.ts";

export default defineConfig({
  standards: ["wcag22", acme],
  level: "AA",
});
```

Then run:

```sh
ra11y src/ --standard acme
```

Every rule that satisfies `wcag22:1.1.1` will fire on your codebase as expected, but the violation record will cite `acme:a.1` because that's the enabled standard and `acme:a.1.equivalentTo = ["wcag22:1.1.1"]`.

You can also enable BOTH — `--standard wcag22,acme` — in which case violations cite both IDs simultaneously.

## Adding criteria

```ts
{
  id: "acme:b.1",                              // globally unique, <stdId>:<localId>
  standardId: "acme",                          // matches the parent Standard.id
  localId: "b.1",                              // arbitrary internal ID
  title: "Videos require captions",            // short human title
  level: "base",                               // single-level standard
  description: "Videos must ship with captions …",
  url: "https://example.com/acme-a11y#b.1",    // MUST resolve — CI checks this
  automatable: "manual",                       // "full" | "partial" | "manual"
  equivalentTo: ["wcag22:1.2.2"],              // the WCAG rule does the actual checking
}
```

If you add a criterion with no `equivalentTo`, it will show up in `--list-standards` output but no rule will satisfy it automatically — you'd need to write a custom rule plugin (see `examples/plugin-rule/`) that declares `satisfies: ["acme:b.1"]`.

## Authoring tips

- **URLs must resolve** — CI runs a link checker over every `criterion.url`.
- **ID uniqueness**: `<standardId>:<localId>` must be globally unique across all loaded standards. Don't reuse a `standardId` that already exists in `BUILTIN_STANDARDS`.
- **Level vocabulary**: standards declare their own level names via `levels: readonly string[]`. WCAG uses `A|AA|AAA`; ours uses `base`. Pick what your spec actually says.
- **Dense criterion descriptions**: the `description` field is used by report generators (VPAT, checklist). Keep it to one or two sentences of normative text.
- **Version your standard**: bump `Standard.version` when your spec updates, and note the change in your plugin's own changelog so consumers can track what they're pinning.
