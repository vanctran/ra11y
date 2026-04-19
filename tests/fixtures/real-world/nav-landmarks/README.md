# nav-landmarks

Guards commit V1-FIXTURE-NAV. Exercises four navigation and landmark
invariants on a minimal two-route app shell.

## Failure mode

A refactor that silences any of the four targets below would produce a
silent regression — a green unit test suite with a real accessibility gap
undetected.

## Files

- `source/shell.html` — full-page HTML shell with `<header>`, `<nav>`,
  `<footer>` but no `<main>`; a `<a>click here</a>` non-descriptive link;
  no skip link before the primary nav.
- `source/app/routes/home.tsx` — React route with nav order
  `[home, about, contact]`.
- `source/app/routes/about.tsx` — React route with nav order
  `[about, home, contact]` — same set, different order.

## Locked assertions

| Target | Kind | Reason substring |
|---|---|---|
| `semantics/landmark-main` | violation-present | `no <main> landmark` |
| `navigation/skip-link` | violation-present | `No skip link precedes the primary <nav>` |
| `navigation/link-descriptive-text` | violation-present | `click here` |
| `wcag22:3.2.3` | candidate-present | `link order diverges` |

## Sanitization

Brand names replaced with "Widget". Import paths use `@example/router`.
No personal paths, no proprietary copy.
