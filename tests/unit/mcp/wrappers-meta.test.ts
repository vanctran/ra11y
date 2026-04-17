/**
 * Unit tests for wrappers-meta.ts — the response-shape builder that
 * merges the three native-wrapper sources and assembles the
 * `activeNativeWrappers` / `activeNativeWrappersBySource` meta block.
 *
 * Invariants under test:
 *   - auto-detect `confirmed` names flow into `activeNativeWrappers`;
 *     `assumed` names do NOT (P1-F)
 *   - `fromAutoDetect` in the meta block is a `{ confirmed, assumed }`
 *     object, not a flat string[]; empty sub-lists are omitted
 *   - the meta block is still emitted when only `assumed` names are
 *     present (agent needs to see the candidate) even though
 *     `activeNativeWrappers` is then absent
 *   - session and config names pass through unchanged
 */

import { describe, expect, it } from "bun:test";
import { McpSession } from "../../../src/mcp/session.ts";
import {
  type NativeWrapperSources,
  resolveWrapperSources,
  wrappersMetaBlock,
} from "../../../src/mcp/wrappers-meta.ts";

describe("resolveWrapperSources: auto-detect split", () => {
  it("includes only `confirmed` names in the effective allowlist", () => {
    // The core P1-F invariant: a wrapper the probe couldn't confirm
    // must NOT end up in the active-wrapper set. If it did, findings
    // on that component would be silenced even though we can't tell
    // whether the wrapper renders a native element underneath.
    const session = new McpSession();
    const sources: NativeWrapperSources = {
      fromFile: [],
      fromSession: [],
      fromAutoDetect: {
        confirmed: ["Button"],
        assumed: ["BeliefSubmitButton"],
      },
    };
    const resolved = resolveWrapperSources(sources, session);
    expect(resolved.wrappers).toEqual(["Button"]);
    expect(resolved.wrappers).not.toContain("BeliefSubmitButton");
  });

  it("preserves the confirmed/assumed split in bySource.fromAutoDetect", () => {
    const session = new McpSession();
    const sources: NativeWrapperSources = {
      fromFile: [],
      fromSession: [],
      fromAutoDetect: {
        confirmed: ["IconButton", "Button"],
        assumed: ["PerceptionSlider", "BeliefSubmitButton"],
      },
    };
    const resolved = resolveWrapperSources(sources, session);
    // Both buckets sorted alphabetically — determinism matters for
    // baseline diffs.
    expect(resolved.bySource.fromAutoDetect.confirmed).toEqual(["Button", "IconButton"]);
    expect(resolved.bySource.fromAutoDetect.assumed).toEqual([
      "BeliefSubmitButton",
      "PerceptionSlider",
    ]);
  });

  it("defaults fromAutoDetect to empty split when the caller omits it", () => {
    // Back-compat: callers (like plain `scan`) that never auto-detect
    // pass wrapperSources without `fromAutoDetect`. The resolve
    // function must tolerate that without tripping over an undefined
    // access.
    const session = new McpSession();
    const sources: NativeWrapperSources = {
      fromFile: ["ConfigButton"],
      fromSession: [],
    };
    const resolved = resolveWrapperSources(sources, session);
    expect(resolved.wrappers).toEqual(["ConfigButton"]);
    expect(resolved.bySource.fromAutoDetect).toEqual({ confirmed: [], assumed: [] });
  });

  it("lets config + session wrappers pass through regardless of auto-detect split", () => {
    // Config / session sources aren't gated by the probe — the user
    // explicitly listed them. Only the inline `autoDetectWrappers`
    // pass gets the confirmed/assumed gating.
    const session = new McpSession();
    const sources: NativeWrapperSources = {
      fromFile: ["ConfigButton"],
      fromSession: ["SessionButton"],
      fromAutoDetect: {
        confirmed: ["AutoConfirmed"],
        assumed: ["AutoAssumed"],
      },
    };
    const resolved = resolveWrapperSources(sources, session);
    expect(resolved.wrappers).toEqual(
      expect.arrayContaining(["ConfigButton", "SessionButton", "AutoConfirmed"]),
    );
    expect(resolved.wrappers).not.toContain("AutoAssumed");
  });
});

describe("wrappersMetaBlock: shape", () => {
  const EMPTY_SPLIT = { confirmed: [] as readonly string[], assumed: [] as readonly string[] };

  it("emits activeNativeWrappersBySource.fromAutoDetect as {confirmed, assumed}", () => {
    const meta = wrappersMetaBlock({
      wrappers: ["Button"],
      sessionOnly: [],
      unusedWrappers: [],
      wrapperProvenance: {
        fromConfig: [],
        fromSession: [],
        fromAutoDetect: { confirmed: ["Button"], assumed: ["BeliefSubmitButton"] },
      },
    });
    expect(meta["activeNativeWrappers"]).toEqual(["Button"]);
    const bySource = meta["activeNativeWrappersBySource"] as Record<string, unknown>;
    expect(bySource["fromAutoDetect"]).toEqual({
      confirmed: ["Button"],
      assumed: ["BeliefSubmitButton"],
    });
  });

  it("omits an empty sub-list inside fromAutoDetect (no sentinel-empty arrays)", () => {
    // CLAUDE.md §1 "Ambiguous field shapes are dishonest" — an empty
    // `assumed: []` tells the agent "no assumed wrappers," whereas
    // omission says "no signal at all here." They need to read the
    // same way: present only when meaningful.
    const meta = wrappersMetaBlock({
      wrappers: ["Button"],
      sessionOnly: [],
      unusedWrappers: [],
      wrapperProvenance: {
        fromConfig: [],
        fromSession: [],
        fromAutoDetect: { confirmed: ["Button"], assumed: [] },
      },
    });
    const bySource = meta["activeNativeWrappersBySource"] as Record<string, unknown>;
    expect(bySource["fromAutoDetect"]).toEqual({ confirmed: ["Button"] });
  });

  it("still surfaces fromAutoDetect when only assumed names exist (activeNativeWrappers absent)", () => {
    // This is the load-bearing P1-F case: the scan found wrappers,
    // none confirmed, `activeNativeWrappers` is empty — but the
    // agent MUST still see the assumed names so it knows what the
    // scanner considered. Silent omission would defeat the whole
    // probe.
    const meta = wrappersMetaBlock({
      wrappers: [],
      sessionOnly: [],
      unusedWrappers: [],
      wrapperProvenance: {
        fromConfig: [],
        fromSession: [],
        fromAutoDetect: { confirmed: [], assumed: ["BeliefSubmitButton"] },
      },
    });
    expect(meta["activeNativeWrappers"]).toBeUndefined();
    const bySource = meta["activeNativeWrappersBySource"] as Record<string, unknown>;
    expect(bySource["fromAutoDetect"]).toEqual({ assumed: ["BeliefSubmitButton"] });
  });

  it("omits the wrapper meta block entirely when no wrapper signal is present", () => {
    const meta = wrappersMetaBlock({
      wrappers: [],
      sessionOnly: [],
      unusedWrappers: [],
      wrapperProvenance: {
        fromConfig: [],
        fromSession: [],
        fromAutoDetect: EMPTY_SPLIT,
      },
    });
    expect(meta["activeNativeWrappers"]).toBeUndefined();
    expect(meta["activeNativeWrappersBySource"]).toBeUndefined();
  });

  it("emits config and session provenance alongside the split auto-detect", () => {
    const meta = wrappersMetaBlock({
      wrappers: ["ConfigBtn", "SessBtn", "AutoBtn"],
      sessionOnly: ["SessBtn"],
      unusedWrappers: [],
      wrapperProvenance: {
        fromConfig: ["ConfigBtn"],
        fromSession: ["SessBtn"],
        fromAutoDetect: { confirmed: ["AutoBtn"], assumed: ["AssumedBtn"] },
      },
    });
    const bySource = meta["activeNativeWrappersBySource"] as Record<string, unknown>;
    expect(bySource["fromConfig"]).toEqual(["ConfigBtn"]);
    expect(bySource["fromSession"]).toEqual(["SessBtn"]);
    expect(bySource["fromAutoDetect"]).toEqual({
      confirmed: ["AutoBtn"],
      assumed: ["AssumedBtn"],
    });
  });
});
