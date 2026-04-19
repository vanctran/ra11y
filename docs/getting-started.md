# Getting started with ra11y

ra11y is a multi-standard accessibility scanner for JSX/TSX, HTML, and CSS. It ships four accessibility standards out of the box — WCAG 2.2, WCAG 2.1, Section 508 (2017 refresh), and EN 301 549 v3.2.1 — and a plugin API for adding more. Zero runtime dependencies, sub-second precommit scans, and VPAT-ready compliance reports.

## Install

```sh
bun add -D @ra11y/core
# or
npm install -D @ra11y/core
# or
pnpm add -D @ra11y/core
```

ra11y is published to npm as `@ra11y/core` (the unscoped `ra11y` name is owned by an unrelated legacy package). The binary is still called `ra11y`. Zero runtime dependencies means installs are near-instantaneous — no transitive fetch, no native builds.

## First scan

```sh
npx ra11y src/
```

Against a typical React codebase, output looks like this:

```
  ra11y  v0.1.0

  ┌─ src/ui/Card.tsx ─────────────────────────────────────────────
  │
  │  ✗  12:5   contrast/minimum
  │            '.muted-note' has color contrast ratio 2.17:1 against its background
  │            WCAG 2.2 · 1.4.3 · Level AA
  │            Fix: Darken the foreground (`color: #b0b0b0`) to ~#595959 for 7:1.
  │
  │  ⚠  45:9   navigation/link-descriptive-text
  │            Link text "here" is not descriptive
  │            WCAG 2.2 · 2.4.4 · Level A
  │            Fix: Describe the destination, e.g. "View the API reference"
  │
  └───────────────────────────────────────────────────────────────

  ✗ 1 error   ⚠ 1 warning   ℹ 0 info           in 12 files · 340ms

  Coverage   WCAG 2.2   22/28 automatable passing (78%) · 54 need manual review
```

Exit code is `1` when any error-severity violation fires, `0` otherwise. `--fail-on warning` escalates warnings to failures; `--fail-on never` disables the gate for reporting-only runs.

## Scan a specific directory or file

```sh
ra11y src/                     # recursive scan of src/
ra11y src/ui/Card.tsx          # single file
ra11y src/ tests/fixtures/     # multiple roots
```

## Scan only what you're about to commit

```sh
ra11y --changed                # only files currently staged in git
ra11y --since main             # files changed since main on the current branch
```

These are designed for precommit hooks and CI integration. `--changed` shells out to `git diff --cached --name-only --diff-filter=ACMR`, so it's portable across every OS with git installed — no libgit2 bindings.

## Output formats

```sh
ra11y src/                          # default: rich terminal output
ra11y src/ --format plain           # one line per violation, no color (accessible)
ra11y src/ --format json            # machine-readable JSON
ra11y src/ --format sarif           # GitHub code scanning
ra11y src/ --format junit           # CI test-runner XML
ra11y src/ --format markdown        # PR comment
```

See `docs/cli.md` for the full flag surface.

## The certification moat

ra11y's distinguishing feature vs. axe-core / eslint-plugin-jsx-a11y / Pa11y is the certification-readiness surface:

```sh
ra11y src/ --coverage                # per-standard coverage summary
ra11y src/ --checklist > manual.md   # manual-review worksheet for human auditors
ra11y src/ --vpat > vpat.md          # VPAT 2.4 conformance table
ra11y src/ --certification           # 0-100 readiness scorecard
```

The `--vpat` output is a clean Markdown table you can paste straight into a VPAT template. The `--certification` scorecard combines automated pass rate (70% weight) with manual-review completion (30% weight) from a `.ra11y-manual.json` file you maintain as reviewers audit criteria.

## Configure

Create `ra11y.config.ts` at your repo root:

```ts
import { defineConfig } from "@ra11y/core";

export default defineConfig({
  standards: ["wcag22", "section508"],
  level: "AA",
  exclude: ["node_modules", "dist", "**/*.test.tsx"],
  rules: {
    "contrast/minimum": "warn",       // downgrade severity
    "parsing/duplicate-id": "off",    // disable entirely
  },
  overrides: [
    {
      files: ["src/legacy/**/*.tsx"],
      rules: { "contrast/minimum": "off" },
    },
  ],
});
```

CLI flags always override config-file values. See `docs/configuration.md` for the full spec.

## Suppress individual violations inline

```tsx
{/* ra11y-disable-next-line contrast/minimum */}
<div className="bg-white text-gray-300">Muted note</div>
```

Block form:

```tsx
{/* ra11y-disable contrast/minimum */}
<LegacyCard />
<LegacyBanner />
{/* ra11y-enable contrast/minimum */}
```

Wildcard (all rules):

```html
<!-- ra11y-disable-next-line -->
<img src="legacy.png">
```

Supported comment styles: `//`, `/* */`, `<!-- -->`, `{/* */}`.

## Adopt on a messy codebase

If your codebase already has hundreds of violations, grandfather them with a baseline:

```sh
ra11y src/ --baseline create   # write .ra11y-baseline.json
git add .ra11y-baseline.json && git commit
```

Then in CI:

```sh
ra11y src/ --baseline check    # exit 3 if new violations appear
```

New regressions break the build; the grandfathered mess is ignored. Run `--baseline update` periodically to prune violations you've fixed.

## Precommit integration

**lefthook** (`lefthook.yml`):

```yaml
pre-commit:
  commands:
    ra11y:
      run: bunx ra11y --changed --fail-on error
```

**husky** (`.husky/pre-commit`):

```sh
#!/bin/sh
bunx ra11y --changed --fail-on error
```

**pre-commit** (`.pre-commit-config.yaml`):

```yaml
- repo: local
  hooks:
    - id: ra11y
      name: ra11y
      entry: bunx ra11y --changed --fail-on error
      language: system
      pass_filenames: false
```

## Next steps

- [CLI reference](./cli.md) — every flag with examples
- [Configuration](./configuration.md) — the `ra11y.config.ts` spec
- [Architecture](./architecture.md) — the three-layer model and how plugins fit in
- [Plugin authoring (rules)](./plugins/authoring-a-rule.md)
- [Plugin authoring (standards)](./plugins/authoring-a-standard.md)

## Upgrading

- [Migrating from 0.1 to 0.2](./migrations/0.1-to-0.2.md)
- [Migrating from 0.2 to 1.0](./migrations/0.2-to-1.0.md)
