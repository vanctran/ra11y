# ra11y — VS Code extension (scaffold)

This is an early scaffold of a VS Code extension that wraps ra11y's MCP
server to surface accessibility findings directly in the Problems
panel. It is **not yet published** to the marketplace and several
production-grade concerns (see below) are deliberately unimplemented.

The extension lives in `integrations/vscode/` and is a sibling project
to the main ra11y workspace — it has its own `package.json`,
`tsconfig.json`, and `node_modules`. It is not part of the top-level
workspace and adds no runtime dependencies to `@ra11y/core`.

## What it does today

1. Lazily spawns `ra11y --mcp` (a child process running the in-house
   MCP server) the first time a scan is triggered, and keeps that MCP
   session alive across subsequent commands.
2. Exposes **ra11y: Scan Workspace** in the Command Palette. Running
   it calls `scan_project` with the active workspace folder as `cwd`
   and pushes the findings into the Problems panel as VS Code
   Diagnostics, grouped by file.
3. Watches `onDidSaveTextDocument` for supported file types
   (`.tsx/.jsx/.ts/.js/.html/.css/.vue/.svelte`) and re-scans on save
   when `ra11y.scanOnSave` is enabled (on by default).
4. Surfaces a **ra11y: Restart MCP Server** command for cases where
   the child process has crashed or the agent wants to force a clean
   session.

## Configuration

All settings live under the `ra11y.*` namespace:

| Setting | Default | Purpose |
|---|---|---|
| `ra11y.standard` | `wcag22` | Forwarded as `scan_project.standard`. Comma-separated to enable multiple. |
| `ra11y.level` | `AA` | Forwarded as `scan_project.level`. |
| `ra11y.additionalPaths` | `[]` | Forwarded as `scan_project.additionalPaths` — paths that bypass `.gitignore` / build-dir defaults. |
| `ra11y.minSeverity` | `info` | Minimum severity to surface in Problems. Matches the MCP default — don't raise to `warning` unless you understand what `info` findings mean (static analysis flagged something it can't fully verify). |
| `ra11y.command` | `ra11y` | Executable used to spawn the MCP server. Override to pin to an absolute path (e.g. a project-local `node_modules/.bin/ra11y`). |
| `ra11y.scanOnSave` | `true` | Re-run a scan when a supported file is saved. |

## Running locally

The extension isn't on the marketplace yet. To try it in an
extension-development host:

```bash
cd integrations/vscode
bun install     # or npm install — @types/vscode + typescript
npm run compile # or: npx tsc -p ./
```

Then open `integrations/vscode/` in VS Code and press `F5` to launch
an Extension Development Host. In that new window, open a project
folder that has `@ra11y/core` installed (so `ra11y --mcp` is on PATH),
then run **ra11y: Scan Workspace** from the Command Palette.

If you need to pin the extension to a specific ra11y installation,
set `ra11y.command` to an absolute path — e.g.
`${workspaceFolder}/node_modules/.bin/ra11y`.

## Architecture

```
integrations/vscode/src/
  extension.ts     activate()/deactivate(), commands, save-watcher,
                   diagnostic emission
  mcp-client.ts    JSON-RPC 2.0 client over stdio — spawn, initialize,
                   tools/call, line-buffered stdout parser
  types.ts         Narrow types mirroring the subset of ra11y's MCP
                   response shapes the extension consumes
```

`mcp-client.ts` intentionally does not import from ra11y's source tree
— the extension compiles in isolation and talks to ra11y only over
stdio + JSON. That keeps the invariant in `@ra11y/core` (zero runtime
deps, Node-compatible only) unviolated even if the extension grows.

## Explicitly NOT done yet

The tracking list for when this graduates from "scaffold" to "shipping":

- **Marketplace packaging.** No `vsce package` wiring, no publisher
  account, no icon, no changelog, no `README` targeted at marketplace
  browsers. `publisher: "ra11y"` in `package.json` is a placeholder.
- **Zero-dep install verification.** The extension's `devDependencies`
  (`@types/vscode`, `typescript`, `@types/node`) haven't been
  installed — the user runs `bun install` / `npm install` once.
- **Sandbox / Extension Development Host smoke test.** The wire-level
  logic is straightforward but nobody has actually clicked "Scan
  Workspace" in an EDH and watched diagnostics appear. Do that before
  claiming this works end-to-end.
- **Code actions / quick fixes.** `scan_project` findings carry a
  `fix` string and the MCP server exposes `suggest_fix` /
  `apply_fix` tools. Wiring those into a `CodeActionProvider` so
  users can one-click fixes from the lightbulb is obvious next work.
- **Per-file scans on save.** `onDidSaveTextDocument` currently
  re-runs `scan_project` over the whole workspace. Switching the save
  path to the `scan_file` MCP tool would be faster and is the
  natural next step.
- **Streaming / partial diagnostics.** Large workspaces wait for the
  full scan before anything appears. An incremental flush after each
  file would feel better, but requires the MCP server to emit
  progress notifications (it doesn't yet).
- **Graceful shutdown.** We `SIGTERM` the child on `deactivate` but
  don't wait for it to flush stderr or confirm exit.
- **Telemetry / auth / network.** None. Matches `@ra11y/core`'s
  offline-by-default posture. No changes expected here.
- **Multi-root workspaces.** Only the first workspace folder is
  scanned. Multi-root projects need a root-picker or
  one-scan-per-root.
- **Reconnection after crash.** If the MCP child dies, the next scan
  will try to relaunch it, but there's no retry/backoff and no user
  prompt explaining why diagnostics went stale.

## Relationship to the main project

- **Does not appear in top-level `package.json`.** `integrations/`
  isn't in `workspaces`, isn't scanned by `scripts/check-zero-deps.ts`
  or `scripts/check-network-isolation.ts` (which are scoped to `src/`),
  and can depend freely on the VS Code API surface without violating
  the zero-runtime-dependency invariant of `@ra11y/core`.
- **Version is independent** of `@ra11y/core`. The extension can ship
  on a different cadence once it earns a publisher.
- **License: MIT**, matching the rest of the repo.
