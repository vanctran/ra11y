# tailwind-coverage

Guards commit **4700a13** (`feat(mcp): tailwind-aware CSS coverage hint`).

## Failure mode

When a codebase uses Tailwind utility classes in JSX and emits no local
CSS files (the compiled output lives in `dist/assets/`), the scanner's
thin-CSS-coverage hint must name the exact `additionalPaths: ["dist/assets"]`
invocation rather than the generic "build and point scan at .css" message.
Before 4700a13 the hint was generic; after, Tailwind detection strengthens it.

## What this fixture asserts

1. `zero-parse-errors` — 41 TSX files parse cleanly.
2. `meta-hint-includes: "Tailwind usage detected"` — the Tailwind detector
   fired; the hint is the strengthened form.
3. `meta-hint-includes: "dist/assets"` — the actionable `additionalPaths`
   suggestion is present in the hint text.

## What would regress

- Dropping `hasTailwindSignal()` or weakening `TAILWIND_TOKEN_RE` so fewer
  than two utility-shaped tokens are detected → hint falls back to generic
  form → assertion 2 fails.
- Removing the `additionalPaths` example from `buildCssThinHint()` →
  assertion 3 fails.
- Raising `MARKUP_FILES_FOR_CSS_HINT_MIN` above 41 → no hint fires at all
  → assertion 2 fails.

## Why existing tools miss this

axe-core, jsx-a11y, and Pa11y evaluate rendered DOM or static attribute
semantics. None inspect the scanner's coverage telemetry. This fixture
guards the MCP-facing `meta.analysisCoverage.hints` shape that the
consuming agent uses to decide whether the scan had full CSS coverage.
