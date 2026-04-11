---
name: research-latest
description: Looks up the current stable version of a package or spec (TypeScript, Bun, Node LTS, Biome, WCAG, SARIF, EN 301 549, Section 508) via WebSearch + WebFetch. Updates the stack table in CLAUDE.md section 2 with the finding and today's date.
argument-hint: <package-or-spec>
allowed-tools: Read Edit Bash(git *) Bash(bun *)
---

# /research-latest $ARGUMENTS

Researches the current stable version of `$1` and updates `CLAUDE.md` section 2.

## Supported queries

- `typescript` → https://www.npmjs.com/package/typescript
- `bun` → https://github.com/oven-sh/bun/releases + https://bun.sh
- `node-lts` → https://nodejs.org/en/about/previous-releases
- `biome` → https://www.npmjs.com/package/@biomejs/biome
- `wcag` → https://www.w3.org/TR/WCAG22/ (and 2.1 status)
- `sarif` → https://docs.oasis-open.org/sarif/sarif/v2.1.0/
- `en301549` → https://www.etsi.org/deliver/etsi_en/301500_301599/301549/
- `section508` → https://www.access-board.gov/ict/

## Workflow

1. Dispatch `spec-researcher` with `$1` if it's a spec, or do the version lookup directly via WebSearch + WebFetch if it's a package.
2. Read the current stack table in `CLAUDE.md` section 2.
3. If the current row is stale (older than 90 days or the version has changed), update the row with:
   - New version
   - Today's date in the "as of" row
   - The source URL
4. Commit: `docs(claude): bump <package> to <version> in stack table`.
5. Never upgrade devDependencies automatically — only the table. Version bumps go through a dedicated PR with full verify.

## Return format

```
package: $1
old_version: <x>
new_version: <y>
source_url: <url>
stack_table_updated: yes | no (already current)
commit: <sha>
```

## Safety

- Never edit `package.json` here. This skill only updates the table.
- Never follow security-advisory redirects without reading them first.
