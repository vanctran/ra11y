---
title: "Tailwind class resolution"
topic: concept
audience: agents, contributors
---

# Tailwind class resolution

Tailwind CSS's utility-class pattern defers meaning: `className="bg-red-500 text-white"` represents a color pair, but the color values come from Tailwind's config and the classes themselves are just keys. Static analysis has to resolve these keys back to CSS values to run contrast checks and similar.

This page documents what ra11y resolves today and what's deferred to Phase 5 polish.

## What's implemented (v0.0.x)

- **Standard utility classes from Tailwind's default palette.** `bg-red-500`, `text-white`, `bg-gray-100`, etc. resolve to their published hex values via a baked-in mapping.
- **Arbitrary values.** `w-[600px]`, `text-[#112233]`, `bg-[rgb(20,40,60)]` — the value in brackets is parsed directly.
- **In-class state modifiers.** `focus:outline-0`, `hover:bg-red-500` — the state modifier is stripped so the base class can be resolved.

## What's not yet implemented

- **Custom theme tokens.** If the user's `tailwind.config.ts` defines `colors: { brand: "#..." }`, ra11y doesn't read the config. `bg-brand` resolves to nothing and the rule abstains.
- **Extended palettes.** Tailwind 3+'s spacing and color palettes can be extended. We only cover the default set.
- **`@apply` and component classes.** `.btn { @apply bg-red-500 text-white; }` requires resolving the `@apply` to the underlying utilities. Not implemented.
- **Conditional classes.** `className={isPrimary ? "bg-red-500" : "bg-blue-500"}` — we can't execute the conditional. Rules that hit this pattern should emit info, not error.
- **classnames / clsx / cva helpers.** These compose classes at runtime; we can't fully resolve them statically.

## Phase 5 polish: the theme resolver

`src/input/resolvers/theme.ts` (not yet built) will:

1. Read `tailwind.config.ts` / `tailwind.config.js` from the project root.
2. Compute the resolved theme (merge defaults + extends + user overrides).
3. Expose a `resolveClass(className): ResolvedStyle | null` that returns CSS-equivalent properties for any supported utility.

Rules that depend on color resolution (contrast/minimum, contrast/enhanced, contrast/non-text) will call through this resolver, and the `bg-brand` case will start working.

## Interim rule behavior

Until the theme resolver lands, rules that hit unresolvable Tailwind classes:

- **Prefer `info` severity.** Static analysis couldn't resolve the classes; an agent or human reading the code can.
- **Include the class name in the message.** "Couldn't resolve contrast for `bg-brand text-white` on `.button`."
- **Suggest the fix path.** "Either move this off Tailwind (use `color` + `background-color` in CSS) or populate `ra11y.config.ts` with the brand-color override."

The `focus/outline-visible` rule is a good reference — it downgrades Tailwind class-scoped suppression to info rather than erroring.

## See also

- [`docs/kb/architecture/input-parsers.md`](../architecture/input-parsers.md) — where Tailwind parsing will land.
- [Tailwind docs: theme configuration](https://tailwindcss.com/docs/theme) — the config format we'll consume.
- `src/rules/contrast/_shared.ts` — current color-pair extraction that will upgrade to use the resolver.
