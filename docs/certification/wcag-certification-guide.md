---
title: "WCAG certification guide"
audience: certification leads, compliance engineers
---

# WCAG certification guide

An end-to-end walkthrough of using ra11y to prepare for WCAG 2.2 AA certification. The same steps apply to 2.1 AA, Section 508, and EN 301 549 — swap the standard IDs.

## Before you start

- Decide the target: which standard, which level. Most teams target WCAG 2.2 AA (the current W3C recommendation, referenced by most jurisdictions) plus Section 508 (US federal procurement) or EN 301 549 (EU/UK).
- Have the source tree ready. Ideally clean working tree on the main branch — you'll re-run scans many times.
- Know what runtime testing you already do (axe-core in Playwright, manual screen-reader passes, keyboard-only sessions). ra11y covers source-time issues; runtime testing covers what the browser produces at execution time. **Both are required** for a credible conformance claim.

## Step 1: Set up

```sh
npx @ra11y/core --init        # Scaffolds ra11y.config.ts
npx @ra11y/core --doctor      # Sanity-check: standards loaded, rules loaded, project detected
```

Configure your project by editing `ra11y.config.ts`:

```ts
export default defineConfig({
  standards: ["wcag22", "section508"],  // or just wcag22
  level: "AA",
  exclude: ["node_modules", "dist", "build", ".next", "coverage"],
  nativeWrappers: ["Button", "Link", /* ...your design-system wrappers */],
});
```

Populate `nativeWrappers` by attaching an MCP-compatible agent and running `detect_native_wrappers`. See [`docs/mcp/server-setup.md`](../mcp/server-setup.md).

## Step 2: Baseline the current state

Take a snapshot of current violations so you can measure progress:

```sh
npx @ra11y/core --baseline create src/
```

Commit `.ra11y-baseline.json` to version control.

## Step 3: Readiness scorecard

```sh
npx @ra11y/core --certification src/
```

This produces the traffic-light readiness scorecard: green (automated clean), yellow (manual review), red (active violations). Your goal before certifying is **all criteria green or yellow, no red**.

See [`readiness-scoring.md`](./readiness-scoring.md) for how the verdict is derived.

## Step 4: Fix the red

Work through the red criteria one at a time. For each:

1. Read the rule's spec context: `npx @ra11y/core --explain <rule-id>`.
2. Fix the code. If it's a design-system issue, fix the wrapper once; per-usage fixes are a code smell.
3. Re-scan: `npx @ra11y/core src/file-you-changed`.
4. Iterate.

Agent-assisted: attach Claude Code / Cursor and ask it to work through the findings. The info-severity ones are exactly where agent source-reading beats static analysis.

## Step 5: Do the yellow (manual review)

For every criterion marked yellow:

```sh
npx @ra11y/core --checklist src/
```

This produces the manual-review checklist: criteria that need human judgment, grouped by section, with candidate source locations and the exact review question per criterion.

Run the checklist against the code. For each item:
- Answer the review question (yes / no / not applicable).
- Record the answer plus a one-line rationale.

Agents can drive this via the `review_candidates` MCP tool — it returns candidates one by one with source snippets and the finder's review prompt. Phase 20's `verdict_candidate` tool will close the loop by sampling the host for the verdict directly.

## Step 6: Draft the VPAT

```sh
npx @ra11y/core --vpat src/ --standard wcag22 --level AA > vpat.md
```

Output is a markdown VPAT with four-verdict conformance for every criterion. Fill in the "Remarks and explanations" cells based on your manual-review notes from Step 5.

See [`vpat-mapping.md`](./vpat-mapping.md) for how ra11y derives each verdict.

## Step 7: Complement with runtime testing

ra11y's scope is source-time. Before claiming conformance, run a runtime test suite — typically axe-core in Playwright, a manual keyboard-only pass, and at least one screen-reader session (NVDA on Windows and/or VoiceOver on macOS). Runtime catches:

- Live regions that never announce
- Focus traps in modals that don't release on close
- Dynamic ARIA state that the component does set but doesn't update
- Accessibility-tree surprises the browser produces that source inspection missed

## Step 8: Submit

Your artifact package typically contains:
1. The signed VPAT (step 6)
2. A testing-methodology statement (ra11y + runtime tests you ran, versions, date)
3. Known-issue disclosure (if any criteria are yellow without being audited, disclose explicitly)
4. Contact info for accessibility queries

## See also

- [`vpat-mapping.md`](./vpat-mapping.md) — how ra11y derives each VPAT verdict.
- [`readiness-scoring.md`](./readiness-scoring.md) — the traffic-light scorecard.
- [`docs/kb/architecture/reports.md`](../kb/architecture/reports.md) — all four report kinds.
- [`docs/mcp/tool-reference.md`](../mcp/tool-reference.md) — MCP tools that drive the agent-assisted flow.
