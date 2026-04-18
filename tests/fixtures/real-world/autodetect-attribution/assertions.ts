/**
 * Fixture: autodetect-attribution
 *
 * Guards the channel separation between auto-detected wrappers and the
 * session-override audit. When `autoDetectWrappers: true` is set, detected
 * component names must arrive via `fromAutoDetect` — not `fromSession` —
 * so no entry in the unified `activeNativeWrappers` tagged list carries
 * `source: "session"` and the `sessionOverridesNote` prose stays absent,
 * avoiding a false implication that a configure() call registered them.
 *
 * Source: first surfaced as a real-world gap during harness wiring of the
 * autoDetectWrappers flag (ADR 0006 follow-up). The fixture is minimal
 * but structurally faithful to production component libraries that expose
 * PascalCase wrappers over native HTML buttons and anchors.
 */

import type { FixtureAssertions } from "../runner.ts";

export const assertions: FixtureAssertions = {
  description:
    "autoDetectWrappers: true registers Button and Link via the autoDetect channel (not session), so activeNativeWrappers entries carry source: 'autoDetect' and sessionOverridesNote stays absent",

  origin: {
    notes:
      'Harness wiring follow-up for ADR 0006: the fixture guards that detected wrappers use the fromAutoDetect channel and never contaminate the session-override audit (sessionOverridesNote + `source: "session"` entries in activeNativeWrappers).',
  },

  toolInput: {
    autoDetectWrappers: true,
  },

  expectations: [
    // Files must parse cleanly — no parse errors in any of the three source
    // files before we make any behavioral assertions.
    { kind: "zero-parse-errors" },

    // Button and Link must be active for this scan. The unified tagged
    // list carries entries shaped `{ name, source, confirmed? }`; the
    // fixture harness's `contains` predicate treats an object entry as
    // a match when its `name` equals the needle.
    {
      kind: "meta-field",
      path: ["activeNativeWrappers"],
      predicate: { contains: "Button" },
    },
    {
      kind: "meta-field",
      path: ["activeNativeWrappers"],
      predicate: { contains: "Link" },
    },

    // The session-override prose MUST be absent. If it were present it
    // would falsely imply a configure() call registered these names
    // and that restarting the MCP server would remove them.
    {
      kind: "meta-field",
      path: ["sessionOverridesNote"],
      predicate: "absent",
    },

    // The legacy `sessionNativeWrappers` field must also be absent — it
    // was collapsed into the unified tagged list in Q2R2-WRAPPER-SOURCES.
    // Callers relying on the old shape must migrate to reading
    // `activeNativeWrappers` entries tagged `source: "session"`.
    {
      kind: "meta-field",
      path: ["sessionNativeWrappers"],
      predicate: "absent",
    },

    // The legacy `activeNativeWrappersBySource` provenance object must
    // also be absent under the collapse — same migration note as above.
    {
      kind: "meta-field",
      path: ["activeNativeWrappersBySource"],
      predicate: "absent",
    },
  ],
};
