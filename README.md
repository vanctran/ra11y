# ra11y

> Multi-standard accessibility scanner. Zero runtime dependencies. Built for precommit speed and WCAG certification.

[![npm version](https://img.shields.io/npm/v/@ra11y/core)](https://www.npmjs.com/package/@ra11y/core)
[![license](https://img.shields.io/npm/l/@ra11y/core)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/vanctran/ra11y/ci.yml?branch=main)](https://github.com/vanctran/ra11y/actions)

**`ra11y`** (pronounced "rally") is an accessibility scanner for JSX/TSX, HTML, and CSS. It ships with four accessibility standards out of the box — WCAG 2.2, WCAG 2.1, Section 508, and EN 301 549 — and a plugin API for adding more. It produces VPAT-ready compliance reports and a certification readiness scorecard alongside line-level violations, so the same tool that catches the bug in your precommit also tells your legal team where you stand on ADA conformance.

> **Status: pre-release (v0.0.x).** The engine, plugin API, 29 rules, and four built-in standards are in place. The v0.1.0 milestone targets the first npm release. See [`CHANGELOG.md`](./CHANGELOG.md) for what's landed.

## Why ra11y

| | ra11y | axe-core | eslint-plugin-jsx-a11y | Pa11y |
|---|:---:|:---:|:---:|:---:|
| Zero runtime dependencies | ✅ | ❌ | ❌ | ❌ |
| Multi-standard (WCAG + Section 508 + EN 301 549) | ✅ | partial | ❌ | partial |
| VPAT + certification scorecard | ✅ | ❌ | ❌ | ❌ |
| Runs in precommit (< 1s on typical commits) | ✅ | partial | ✅ | ❌ |
| Context-aware fix suggestions | ✅ | partial | partial | ❌ |
| Plugin API for custom standards | ✅ | ❌ | ❌ | ❌ |
| First-class TSX + Tailwind class resolution | ✅ | partial | ✅ | ❌ |

## Install

```sh
bun add -D @ra11y/core
# or
npm install -D @ra11y/core
# or
pnpm add -D @ra11y/core
```

Install is instantaneous — zero runtime dependencies means zero transitive downloads.

## Quickstart

```sh
npx ra11y src/
```

```
  ra11y  v0.1.0

  ┌─ src/ui/Card.tsx ─────────────────────────────────────────────
  │
  │  ✗  12:5   contrast/minimum
  │            Text color on background has ratio 3.2:1 (needs 4.5:1)
  │            WCAG 2.2 · 1.4.3 Contrast (Minimum) · Level AA
  │            Fix: Use #4A4A4A foreground for 5.2:1 ratio
  │
  │  ⚠  45:9   link/descriptive-text
  │            Link text "here" is not descriptive
  │            WCAG 2.2 · 2.4.4 Link Purpose · Level A
  │            Fix: Describe the destination, e.g. "view settings"
  │
  └───────────────────────────────────────────────────────────────

  ✗ 1 error   ⚠ 1 warning   ℹ 0 info          in 12 files · 340ms

  Coverage   22 of 28 automatable SC checked · 27 need manual review
  Next       Run `ra11y --checklist` for manual review guide
             Run `ra11y --explain contrast/minimum` for detail
```

## Common commands

```sh
ra11y --changed                     # Scan only git-staged files (precommit)
ra11y --since main                  # Scan files changed since a git ref
ra11y --standard wcag22,section508  # Run multiple standards at once
ra11y --level AA                    # Enforce conformance level
ra11y --format sarif                # GitHub code scanning output
ra11y --format agent                # AI agent-optimized JSON (see below)
ra11y --baseline=create              # Freeze existing violations
ra11y --coverage                    # Per-standard coverage summary
ra11y --vpat                        # Generate VPAT-ready report
ra11y --certification               # Generate readiness scorecard
ra11y --checklist                   # Manual review checklist
ra11y --explain contrast/minimum    # Rule detail, spec quote, examples
ra11y --list-rules                  # All 36 built-in rules
ra11y --list-standards              # All 4 built-in standards
```

Full CLI reference: [`docs/cli.md`](./docs/cli.md). Architecture: [`docs/architecture.md`](./docs/architecture.md).

## Agent mode

ra11y is the first accessibility scanner designed for AI coding agents. `--format agent` outputs compact JSON optimized for LLM context windows:

```sh
ra11y src/ --format agent | claude-code --stdin
```

The output includes:
- **Plan summary** — "15 findings (12 auto-fixable). Most common: button-name (5), handler-missing (4)." — so the agent can form a strategy before reading individual findings
- **Findings grouped by file** — with fix confidence (`high`/`medium`/`low`), safety (`safe`/`unsafe`), effort (`trivial`/`moderate`/`significant`), and the exact `// ra11y-ignore` suppression syntax
- **Review candidates** — locations where the agent should evaluate manual WCAG criteria, with the question to answer, pass/fail criteria, and suggested fix

```json
{
  "plan": { "totalFindings": 15, "fixSuggestionAvailable": 12, "summary": "..." },
  "files": [{ "path": "src/Button.tsx", "findings": [{ "fix": { "confidence": "high" }, ... }] }],
  "reviewCandidates": [{ "question": "Does this text rely solely on sensory characteristics?", ... }]
}
```

Every field earns its place in the context window. No SARIF bloat, no schema URLs, no enterprise metadata.

## Configure

`ra11y.config.ts`:

```ts
import { defineConfig } from "@ra11y/core";

export default defineConfig({
  standards: ["wcag22", "section508"],
  level: "AA",
  exclude: ["node_modules", "dist", "**/*.test.tsx"],
  overrides: [
    {
      files: ["src/legacy/**/*.tsx"],
      rules: { "contrast/minimum": "warn" },
    },
  ],
});
```

## Precommit integration

Scan only files staged in git, and fail the commit on any error:

```sh
ra11y --changed --fail-on error
```

With [lefthook](https://github.com/evilmartians/lefthook):

```yaml
# lefthook.yml
pre-commit:
  commands:
    ra11y:
      run: bunx ra11y --changed --fail-on error
```

Or use ra11y's baseline mode to adopt on an existing codebase without fixing everything up front:

```sh
ra11y --baseline=create    # freeze existing violations
ra11y --baseline=check     # only new violations fail the scan
```

Examples for CI and precommit tools: [`examples/`](./examples).

## Plugin API

Standards and rules are both pluggable. Adding a new accessibility framework is one file:

```ts
import { defineStandard } from "@ra11y/core/plugin";

export default defineStandard({
  id: "coga",
  name: "Cognitive Accessibility Guidelines",
  version: "1.0",
  publisher: "W3C WAI",
  url: "https://www.w3.org/TR/coga-usable/",
  levels: ["base"],
  criteria: [
    /* … */
  ],
});
```

Rules declare coverage across every loaded standard:

```ts
import { defineRule } from "@ra11y/core/plugin";

export default defineRule({
  id: "custom/no-placeholder-as-label",
  satisfies: ["wcag22:3.3.2", "coga:clear-instructions"],
  severity: "error",
  // …
});
```

End-to-end templates: [`examples/plugin-rule/`](./examples/plugin-rule/) and [`examples/plugin-standard/`](./examples/plugin-standard/). Architecture deep-dive: [`docs/architecture.md`](./docs/architecture.md).

## MCP Server (AI Agent Integration)

ra11y ships a built-in [MCP](https://modelcontextprotocol.io) server so AI coding agents (Claude Code, Cursor, etc.) can scan, explain, and fix accessibility issues interactively.

**Setup** — add this to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "ra11y": {
      "command": "npx",
      "args": ["@ra11y/core", "--mcp"]
    }
  }
}
```

Or start the server directly: `ra11y --mcp`

**Available tools:**

| Tool | Purpose |
|------|---------|
| `scan` | Scan files/directories for violations |
| `scan_file` | Fast single-file re-scan (cached ASTs) |
| `explain_rule` | Full rule docs, WCAG quote, examples |
| `suggest_fix` | Concrete fix suggestion for a violation |
| `coverage` | Per-standard compliance scorecard |
| `checklist` | Manual review items with evaluation prompts |
| `list_rules` | Discover available rules |
| `configure` | Set session defaults (standard, level) |

**Typical agent workflow:** `scan` → read findings → `explain_rule` for unclear ones → apply fix → `scan_file` to verify → `coverage` to check overall compliance.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). TL;DR: TypeScript only, Bun-first, zero runtime deps, every rule cites WCAG, conventional commits, `bun run verify` before committing. Claude Code users: see [`CLAUDE.md`](./CLAUDE.md) for the autonomous-development workflow and the Orchestrator-Workers pattern the project is built around.

## License

MIT © ra11y contributors
