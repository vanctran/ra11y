# suppression-reason-slot

Guards commit `d820186` — the `: reason` / `-- reason` slot on
`ra11y-disable` pragmas and the `meta.suppressions` audit-trail surface
that exposes it to agents.

## Failure modes this locks in

1. **Reason slot parses.** `{/* ra11y-disable-next-line rule/id: reason text */}`
   and the line-comment equivalent must capture `reason: "reason text"` on
   the resulting `meta.suppressions` entry.
2. **Bare pragma omits the key.** `{/* ra11y-disable wcag22:X.Y.Z */}` must
   produce an entry with `reason` **absent** (not `undefined`, not `""`) — the
   key-presence difference is how agents distinguish documented from
   un-justified silences at a glance.
3. **`meta.suppressionsNote` advertises the syntax.** Its text must still
   mention `: reason` so the correct pragma form is discoverable from the
   scan response itself.

## Sources

Three files, one pragma each: a JSX-comment reasoned pragma
(`App.tsx`), a bare JSX-comment pragma (`BareSuppression.tsx`), and a
line-comment reasoned pragma (`Legacy.tsx`).

The harness does not populate the scanner's `disableMap`, so the
pragma-targeted findings still appear in `result.violations` — that is
intentional and proves the pragmas are doing real work on real findings
rather than annotating already-clean code.
