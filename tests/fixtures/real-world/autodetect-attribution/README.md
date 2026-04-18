# autodetect-attribution

## Scenario

A component library with two PascalCase wrappers over native HTML elements:

- `Button` renders a `<button>` and forwards all `ButtonHTMLAttributes`.
- `Link` renders an `<a>` and forwards all `AnchorHTMLAttributes`.

`App.tsx` uses both with `onClick` props, making them auto-detectable by
`collectWrapperCandidates`.

The fixture exercises the `autoDetectWrappers: true` flag on the fixture
harness (mirroring `scan_project`'s inline `autoDetectWrappers` param).

## The hard part: channel separation

When auto-detection runs, the detected component names must travel through
the `fromAutoDetect` channel inside `NativeWrapperSources`, not through
`fromSession`. This distinction matters because:

- Entries in the unified `activeNativeWrappers` tagged list are tagged
  `source: "session"` when they came from a prior `configure()` call,
  and `sessionOverridesNote` is emitted alongside them.
- Agents reading `source: "session"` entries (or the `sessionOverridesNote`
  prose) expect to see names registered by a prior `configure()` call —
  something that persists until the MCP server is restarted.
- Auto-detected names are **scan-scoped**: they apply for one scan only and
  never touch session or project config. They must appear as
  `source: "autoDetect"` entries with a `confirmed` flag from the P1-F
  AST probe.

If the harness wired auto-detected names through `fromSession` instead of
`fromAutoDetect`, the meta would show spurious `source: "session"` entries
and the `sessionOverridesNote` prose, causing agents to believe a
configure() call is in play and that restarting the server would
unregister the wrappers — neither of which is true.

## Why existing tools miss it

axe-core, jsx-a11y, and Pa11y do not model the native-wrapper concept at
all. The attribution bug is entirely internal to ra11y's wrapper metadata
plumbing and has no analog in those tools.

ra11y catches the correctness invariant by asserting that no entry in
`activeNativeWrappers` carries `source: "session"`, that
`sessionOverridesNote` is absent, and that the detected names appear in
the tagged list (implicitly tagged `source: "autoDetect"`) — a structural
check on the MCP response shape that agents actually consume.

## Fixture structure

```
source/
  Button.tsx   — native <button> wrapper, PascalCase, ButtonHTMLAttributes
  Link.tsx     — native <a> wrapper, PascalCase, AnchorHTMLAttributes
  App.tsx      — consumer; uses both with onClick (triggering detection)
assertions.ts  — expects autoDetect entries present, sessionOverridesNote + legacy fields absent
README.md      — this file
```
