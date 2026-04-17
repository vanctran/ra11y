# a11y tool comparison

> **Status: scaffold.** Qualitative cells are populated. Numeric cells (accuracy,
> false-positive rate, performance timings) are marked "pending" and will be
> filled in a follow-up PR before the release they accompany. Do not cite
> numeric cells from this document until that PR lands.

This document measures how ra11y compares to other static-analysis accessibility
tools on a shared, labeled fixture corpus. It covers the overlap where the tools
compete: scanning source files before any page is rendered. It does not measure
runtime checks.

Updated per release. See [CHANGELOG.md](../CHANGELOG.md) for history.

---

## 1. Intent

### What this benchmark measures

- **Accuracy on static source.** Given a labeled fixture (violation present / no
  violation), does the tool flag the right location?
- **False-positive rate.** How often does the tool flag a location that is not
  a real violation?
- **Coverage surface.** Which WCAG success criteria and which input file types
  does the tool address?
- **Agent-workflow completion rate (ra11y only).** Can a consuming AI agent
  complete an end-to-end accessibility audit — scan, checklist, suggest fix,
  apply fix — in a single session without leaving the tool surface?
- **Setup friction.** What does a developer need to install, configure, and run
  a first scan?
- **Performance.** Wall-clock scan time at three corpus sizes: 10 files (~1k
  LOC), 100 files (~10k LOC), 1000 files (~100k LOC).

### What this benchmark does NOT measure

Static analysis cannot observe:

- **Post-render contrast.** The computed background color of an element depends
  on CSS cascade, inheritance, and dynamic class toggling. Static contrast
  checks approximate based on literal color values in source; they will miss
  violations set at runtime and may fire false positives where computed styles
  differ from authored values.
- **Live-region announcements.** Whether `aria-live` regions announce
  correctly depends on timing, focus management, and AT implementation.
  No static tool can verify this.
- **Focus trap correctness.** Whether a modal focus trap cycles correctly
  requires a rendered DOM with a running event loop.
- **ARIA state accuracy at runtime.** `aria-expanded`, `aria-selected`, and
  similar attributes are often set dynamically; their static values are only
  the initial state.
- **Visual rendering.** Layout overlap, pointer target size in rendered pixels,
  and reflow behavior at narrow viewports require a browser.

For runtime checks, ra11y's MCP tooling explicitly surfaces a `limitations`
field on clean scans naming the categories above. These belong in a Playwright
or Vitest suite with axe-core, not in a static scanner.

---

## 2. Metrics

| Metric | Definition | Unit |
|--------|-----------|------|
| True-positive rate (recall) | Labeled violations detected / total labeled violations | % |
| False-positive rate | Unlabeled locations flagged / total locations scanned | % |
| False-negative rate | Labeled violations missed / total labeled violations | % |
| Standards covered | Distinct accessibility standards the tool can check against | list |
| Input file types | Source file extensions the tool accepts without a browser | list |
| Agent-workflow completion | Ratio of agent audit sessions completed end-to-end using only the tool's API | % (ra11y only) |
| Install size | `node_modules` byte count after a clean `npm install`, no devDependencies | MB |
| Runtime dependencies | Count of entries in `package.json` `dependencies` | integer |
| Time to first scan (cold) | Wall clock from process spawn to first result line, no prior caching | ms |
| Scan time — 10 files | Wall clock on the 10-file corpus fixture | ms |
| Scan time — 100 files | Wall clock on the 100-file corpus fixture | ms |
| Scan time — 1000 files | Wall clock on the 1000-file corpus fixture | ms |

Agent-workflow completion is defined only for ra11y because it requires the
MCP tool surface (`scan_project` → `checklist` → `suggest_fix`). For other
tools, this column reads "N/A — no MCP surface."

---

## 3. Methodology

### Fixture corpus

All measurements run against a labeled fixture corpus stored at
`tests/fixtures/real-world/`. Each fixture is a directory containing:

- `source/` — the input source files (JSX/TSX/HTML/CSS)
- `assertions.ts` — typed expectations exported as `FixtureAssertions`
- `README.md` — description of the failure mode, what the fixture guards, and
  which commit introduced it

The corpus runner at `tests/fixtures/real-world/runner.ts` drives every tool
against the same `source/` trees. Findings are normalized to
`{ file, line, col, criterionId }` before comparison. Tools that produce
criterion IDs in a different scheme (e.g. axe rule IDs, ESLint rule names)
are mapped to WCAG success criteria via the mapping table in
`scripts/bench-map-findings.ts` (created in the follow-up PR that populates
numeric cells).

### Corpus categories

The following fixture categories anchor the benchmark. Each is a
subdirectory of `tests/fixtures/real-world/`.

| Fixture | What it covers |
|---------|---------------|
| `tailwind-coverage` | JSX components styled exclusively with Tailwind utility classes; no local CSS files. Tests whether the tool can surface coverage gaps when compiled CSS lives in `dist/assets/`. See `tailwind-coverage/README.md`. |
| `template-directives` | Jinja and Handlebars/Mustache HTML templates. Tests whether the tool parses template syntax without rendering or executing directives, and whether it communicates that behavior honestly to the consumer. See `template-directives/README.md`. |
| `opaque-components-top` | A React app with many PascalCase wrapper components that obscure native element semantics (e.g. `<Button onClick={...}>` instead of a bare `<button>`). Tests whether the tool surfaces which wrappers need investigation and how many call sites each has. |
| `logotype-annotation` | Images with `className="logo"` or `className="site-logo"`. Tests whether the tool distinguishes the WCAG 1.4.5 logotype exemption hint from the stricter 1.4.9 no-exception criterion without suppressing either candidate. |
| `spa-shell-vite` | A Vite SPA shell (`index.html` + `src/main.tsx`). Tests handling of minimal HTML that delegates layout entirely to JavaScript. |
| `tsx-generics` | TSX files with generic type parameters in JSX context (`Component<T>`). Tests whether the parser correctly disambiguates the `<T>` syntax. |
| `timing-role-hints` | TypeScript files containing `setTimeout` and interval calls. Tests whether the tool surfaces timing-based accessibility concerns (wcag22:2.2.1) with the numeric literal in the reason text. |
| `autodetect-attribution` | A codebase with custom wrapper components (`Button`, `Link`) that the scanner auto-detects as native wrappers. Tests whether the coverage telemetry attributes suppressed call sites to the correct detection source. |
| `suppression-reason-slot` | Components using `ra11y-disable` pragmas with and without reason text. Tests whether suppression metadata is surfaced honestly and whether bare suppressions are distinguishable from annotated ones. |

Additional fixtures may be added before numeric cells populate. The benchmark
runs against all fixtures present in `tests/fixtures/real-world/` at time of
measurement.

### Matching findings across tools

Tools use different identifiers for the same accessibility problem. A finding
from eslint-plugin-jsx-a11y as `jsx-a11y/alt-text` maps to the same logical
violation as an axe finding tagged `image-alt`, which maps to WCAG 1.1.1.

All findings are normalized to a `(file, line, criterionId)` triple. Mapping
tables are committed in `scripts/bench-map-findings.ts` and are versioned
alongside this document. When a tool does not produce criterion-level
granularity, the nearest unambiguous mapping is used; ambiguous cases are
logged and excluded from precision/recall calculations.

### Tiebreaker for disputed findings

When tools disagree on whether a given source location is a violation, the
tiebreaker is the WCAG normative text and the published Understanding document.
The fixture's `assertions.ts` documents the expected verdict. If an existing
assertion is wrong, the correction requires updating both the fixture and this
document with a citation.

### Reproducibility

The runner script and mapping tables are in this repository. Any reviewer with
the `bun` runtime can reproduce the numeric results with:

```sh
bun scripts/run-benchmark.ts
```

That script is created in the follow-up PR. Until then, the fixture corpus
itself is fully reproducible:

```sh
bun test tests/fixtures/real-world/
```

### Who ran it and when

Each published revision of this document records the runner version, the commit
hash of the fixture corpus, and the date of the run in the table header of
section 5. The first numeric run is pending.

---

## 4. Tools in scope

| Tool | Version tested | Primary surface | Notes |
|------|---------------|-----------------|-------|
| axe-core DevTools | pending | DOM (browser / jsdom) | Requires a rendered document. Headless CLI wrappers (`axe-cli`, `@axe-core/playwright`) are in scope for DOM-based comparison; axe's static-analysis mode (`axe-linter`) is noted separately where relevant. |
| pa11y | pending | DOM (headless Chromium) | Requires Chromium at runtime. Results are post-render. |
| eslint-plugin-jsx-a11y | pending | JSX/TSX AST (static) | ESLint plugin; static analysis only. Requires ESLint in the project. |
| ra11y | see `package.json` | JSX/TSX, HTML, CSS (static) + MCP | Static analysis; no browser required. |

WAVE and Lighthouse are excluded from the matrix. WAVE has no scriptable CLI
that operates on source files. Lighthouse's accessibility audit delegates to
axe-core and is measured more directly via that row. alex (prose accessibility
checker) operates on written text, not source code — a different problem.

---

## 5. Comparison matrix

Measured on fixture corpus at `tests/fixtures/real-world/`. Numeric cells are
pending.

**Run metadata:** pending (first run fills this in before release).

### Qualitative properties

| Property | axe-core (headless) | pa11y | eslint-plugin-jsx-a11y | ra11y |
|----------|--------------------:|------:|----------------------:|------:|
| Requires browser / Chromium | yes (headless) | yes (Chromium) | no | no |
| Runtime dependencies | many (transitive) | many (transitive, includes Chromium) | many (ESLint ecosystem) | zero |
| Input: JSX/TSX static | no | no | yes | yes |
| Input: HTML static | no (needs DOM) | no (needs DOM) | no | yes |
| Input: CSS static | no | no | no | yes |
| Multi-standard output (WCAG 2.1, 2.2, Section 508, EN 301 549) | WCAG 2.x tags | WCAG 2.x tags | WCAG 2.x annotations | yes — per-criterion, multi-standard |
| VPAT / certification report | no | no | no | yes (`--vpat`, `--certification`) |
| MCP tool surface for AI agents | no | no | no | yes |
| Source-level disable pragma | no | no | per ESLint comment | yes (`ra11y-disable`) |
| Scan-confidence telemetry | no | no | no | yes (`meta.analysisCoverage`) |
| Config file required | no (API) | no | yes (ESLint config) | no (zero-config defaults) |
| Offline by contract | yes | no (fetches Chromium) | yes | yes |

### Accuracy (labeled fixture corpus)

| Metric | axe-core (headless) | pa11y | eslint-plugin-jsx-a11y | ra11y |
|--------|--------------------:|------:|----------------------:|------:|
| True-positive rate | pending | pending | pending | pending |
| False-positive rate | pending | pending | pending | pending |
| False-negative rate | pending | pending | pending | pending |

### Coverage surface

| Criterion category | axe-core (headless) | pa11y | eslint-plugin-jsx-a11y | ra11y |
|--------------------|--------------------:|------:|----------------------:|------:|
| Perceivable (WCAG 1.x) | post-render only | post-render only | partial (alt-text, label, contrast via plugin) | static — see `src/rules/index.ts` |
| Operable (WCAG 2.x) | post-render only | post-render only | partial (keyboard, focus) | static — see `src/rules/index.ts` |
| Understandable (WCAG 3.x) | post-render only | post-render only | partial | static — see `src/rules/index.ts` |
| Robust (WCAG 4.x) | post-render only | post-render only | partial (aria) | static — see `src/rules/index.ts` |
| Standards beyond WCAG 2.x | no | no | no | Section 508, EN 301 549 |
| Manual-review checklist | no | no | no | yes (`checklist` tool / `--checklist`) |

For the exact rule list per tool, consult the tool's own documentation. For
ra11y, the canonical source is `src/rules/index.ts`.

### Setup friction

| Step | axe-core (headless) | pa11y | eslint-plugin-jsx-a11y | ra11y |
|------|--------------------:|------:|----------------------:|------:|
| Install command | `npm i -D axe-core` + headless driver | `npm i -g pa11y` (pulls Chromium) | `npm i -D eslint eslint-plugin-jsx-a11y` | `npm i -D @ra11y/core` |
| Config file required | no (API only) | no | yes (ESLint flat config or `.eslintrc`) | no |
| Time to first scan (cold) | pending | pending (Chromium launch) | pending | pending |
| Runtime environment | Node + headless browser | Node + Chromium | Node | Node 22+ or Bun |

### Performance (wall clock)

| Corpus size | axe-core (headless) | pa11y | eslint-plugin-jsx-a11y | ra11y |
|-------------|--------------------:|------:|----------------------:|------:|
| 10 files (~1k LOC) | pending | pending | pending | pending |
| 100 files (~10k LOC) | pending | pending | pending | pending |
| 1000 files (~100k LOC) | pending | pending | pending | pending |

Performance budget for ra11y is documented in `CLAUDE.md` §13 and enforced in
CI via `scripts/bench.ts`. The comparison numbers above run against the same
fixture trees under the same conditions and are not subject to ra11y's internal
budget enforcement.

---

## 6. Reproducibility

Once the runner script lands, the full benchmark (including numeric cells)
reproduces with:

```sh
bun scripts/run-benchmark.ts --output benchmarks/results/latest.json
```

The output JSON is not committed. Only this summary document is committed. The
fixture corpus that drives it is committed at `tests/fixtures/real-world/`.

To run the fixture corpus alone (no external tools needed):

```sh
bun test tests/fixtures/real-world/
```

To audit which fixtures exist and what they assert:

```sh
ls tests/fixtures/real-world/
```

---

## 7. Publication cadence

This document updates with each ra11y release. The update process:

1. Run the benchmark against the new release tag.
2. Fill in or update numeric cells.
3. Record the run metadata (date, commit hash, runner version) in the matrix
   header of section 5.
4. Commit: `docs(benchmarks): update comparison for vX.Y.Z`.

The CHANGELOG entry for the release links to the corresponding revision of this
document.

Historical results are retrievable via `git log --follow benchmarks/a11y-tool-comparison.md`.

---

## Appendix: mapping table sketch

The tool-to-criterion mapping (axe rule ID / ESLint rule name → WCAG SC) lives
in `scripts/bench-map-findings.ts` (created in the follow-up PR). The entries
below sketch the scope:

| Tool rule identifier | Maps to | Notes |
|----------------------|---------|-------|
| `axe: image-alt` | `wcag22:1.1.1` | axe uses WCAG 2.x tags directly |
| `axe: color-contrast` | `wcag22:1.4.3` | post-render only; static tools approximate |
| `jsx-a11y/alt-text` | `wcag22:1.1.1` | static check; JSX only |
| `jsx-a11y/aria-role` | `wcag22:4.1.2` | static check; JSX only |
| `jsx-a11y/no-static-element-interactions` | `wcag22:2.1.1` | static check; JSX only |
| `pa11y: WCAG2AA.Principle1.Guideline1_1.1_1_1.H37` | `wcag22:1.1.1` | pa11y uses Technique IDs |

The full mapping table is populated alongside the first numeric run.
