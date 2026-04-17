# timing-role-hints

**Guards:** commit `3ada44a` (feat(review): annotate timing candidates with filename role hints) and its revert `adb3976`.

## What this fixture guards

Commit `3ada44a` added a `FILENAME_ROLE_HINTS` table to the timing candidate finder that matched basenames containing keywords like `debounce`, `auth`, `telemetry`, and appended `"(file looks like a <role> — likely not user-facing)"` to each `setTimeout`/`setInterval` review candidate whose file matched. The commit message called it reason-text enrichment (candidates still surfaced).

Commit `adb3976` reverted the feature with this rationale:

> Filename → user-facing-ness is a classification the agent already performs accurately by reading the file (CLAUDE.md §1, "Don't duplicate capability the agent already has"). The hint confidently asserts "likely not user-facing" on evidence a fresh reader could rebut — authManager might house a real session timeout; useDebouncedCallback might govern user-perceived latency.

This fixture locks in both sides of the revert:

1. **Surfacing invariant** — `wcag22:2.2.1` candidates MUST be present for all three files. The three source files (`useDebouncedCallback.ts`, `authManager.ts`, `telemetryService.ts`) each contain a `setTimeout` call. No suppression is permitted.

2. **Non-heuristic invariant** — No candidate reason may contain `"likely not user-facing"`. If the `FILENAME_ROLE_HINTS` table reappears, this assertion fails before the change ships.

## Why axe / jsx-a11y miss this

This fixture guards behavior of ra11y's review-candidate finder, not a static rule. Neither axe-core nor jsx-a11y have a `wcag22:2.2.1` timing-candidate surface; they check DOM properties at runtime. Ra11y surfaces `setTimeout`/`setInterval` call sites statically as manual-review candidates — the issue here is a design invariant in how the reason text is composed, not something these tools model.

## Sanitization decisions

- No library/framework imports. All three files are standalone TypeScript with no `import` statements.
- Symbol names (`useDebouncedCallback`, `authManager`, `telemetryService`) are the reproduction — they match the `FILENAME_ROLE_HINTS` regexes from `3ada44a`. Renaming them would destroy the fixture.
- No real API endpoints, URLs, or trademarked identifiers. `sendToCollector` and `refreshAccessToken` are generic placeholders.
