/**
 * Fixture: autodetect-attribution
 *
 * Guards the channel separation between auto-detected wrappers and the
 * session-override audit. When `autoDetectWrappers: true` is set, detected
 * component names must arrive via `fromAutoDetect` — not `fromSession` —
 * so `sessionNativeWrappers` stays absent and agents are not misled into
 * thinking a configure() call registered them.
 *
 * Source: first surfaced as a real-world gap during harness wiring of the
 * autoDetectWrappers flag (ADR 0006 follow-up). The fixture is minimal
 * but structurally faithful to production component libraries that expose
 * PascalCase wrappers over native HTML buttons and anchors.
 */

import type { FixtureAssertions } from "../runner.ts";

export const assertions: FixtureAssertions = {
  description:
    "autoDetectWrappers: true registers Button and Link via fromAutoDetect, not fromSession, so sessionNativeWrappers stays absent",

  origin: {
    notes:
      "Harness wiring follow-up for ADR 0006: the fixture guards that detected wrappers use the fromAutoDetect channel and never contaminate the session-override audit (sessionNativeWrappers).",
  },

  toolInput: {
    autoDetectWrappers: true,
  },

  expectations: [
    // Files must parse cleanly — no parse errors in any of the three source
    // files before we make any behavioral assertions.
    { kind: "zero-parse-errors" },

    // Button and Link must be active for this scan (the detector found them).
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

    // Provenance: both names must land in fromAutoDetect.confirmed
    // (they render real <button> / <a> roots), not fromSession or
    // fromConfig. The probe is a one-hop AST check (P1-F): Button.tsx
    // and Link.tsx whose JSX root is a native interactive element
    // confirm; anything non-native stays in `assumed`.
    {
      kind: "meta-field",
      path: ["activeNativeWrappersBySource", "fromAutoDetect", "confirmed"],
      predicate: { contains: "Button" },
    },
    {
      kind: "meta-field",
      path: ["activeNativeWrappersBySource", "fromAutoDetect", "confirmed"],
      predicate: { contains: "Link" },
    },

    // The session-override audit field MUST be absent. If it were present
    // it would falsely imply a configure() call registered these names and
    // that restarting the MCP server would remove them.
    {
      kind: "meta-field",
      path: ["sessionNativeWrappers"],
      predicate: "absent",
    },
  ],
};
