# spa-shell-vite

Guards commit **bc3aae4** (`feat(review): annotate 2.4.5 candidates on SPA index shells`).

## Failure mode

Before bc3aae4, the Multiple Ways finder surfaced a `wcag22:2.4.5` candidate on a Vite-style `index.html` with a bare reason string: "Likely root layout has no search, sitemap, breadcrumb, or 3-link navigation signal." Agents reviewing that candidate treated `index.html` as the fix location — trying to add navigation to an HTML file that is just a mount point for a React SPA. The real navigation lives in the client-side router config, not the index shell.

## What bc3aae4 fixed

The reason text now includes a trailing annotation when the HTML structurally looks like an SPA index shell (empty mount `<div id="root">` + `<script type="module" src="...">` with no rendered children). The candidate still surfaces — no suppression — but the agent is redirected to the router config.

## What this fixture asserts

1. `zero-parse-errors` — the HTML and TSX files parse cleanly.
2. `candidate-present` for `wcag22:2.4.5` with `reasonIncludes: "SPA index shell"` — the enrichment is present and the candidate is not suppressed.

## Why existing tools miss this

axe-core, jsx-a11y, and Pa11y evaluate rendered DOM or static JSX; none inspect the `index.html` shell at all. ra11y's HTML finder detects the shell structurally and enriches the candidate reason so the reviewing agent knows where to look.
