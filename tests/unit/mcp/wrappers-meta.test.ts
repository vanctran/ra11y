/**
 * Unit tests for wrappers-meta.ts — the response-shape builder that
 * merges the three native-wrapper sources and assembles the unified
 * tagged `activeNativeWrappers` list.
 *
 * Invariants under test:
 *   - auto-detect `confirmed` names flow into the effective allowlist;
 *     `assumed` names do NOT (P1-F)
 *   - the unified `activeNativeWrappers` list is tagged per entry with
 *     `{ name, source, confirmed? }`
 *   - `confirmed` is populated ONLY for `source: "autoDetect"` entries
 *     (true for confirmed, false for assumed); omitted entirely for
 *     `"config"` and `"session"` per the honest-shape doctrine
 *   - the meta block still emits entries when only `assumed` names are
 *     present (agent needs to see the candidate) — those entries carry
 *     `confirmed: false`
 *   - session and config names pass through unchanged
 *   - a name declared in multiple channels emits one entry per channel
 *     so agents see every origin independently
 */

import { describe, expect, it } from "bun:test";
import { McpSession } from "../../../src/mcp/session.ts";
import {
  type ActiveNativeWrapper,
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

describe("wrappersMetaBlock: unified tagged list shape", () => {
  const EMPTY_SPLIT = { confirmed: [] as readonly string[], assumed: [] as readonly string[] };

  it("emits config-only entries with source: 'config' and no confirmed field", () => {
    // Author-supplied: `confirmed` is omitted per CLAUDE.md §1
    // "Ambiguous field shapes are dishonest." Populating it on a
    // config entry would either lie ("we verified your config") or
    // carry no signal.
    const meta = wrappersMetaBlock({
      sessionOnly: [],
      unusedWrappers: [],
      wrapperProvenance: {
        fromConfig: ["ConfigButton"],
        fromSession: [],
        fromAutoDetect: EMPTY_SPLIT,
      },
    });
    const entries = meta["activeNativeWrappers"] as readonly ActiveNativeWrapper[];
    expect(entries).toEqual([{ name: "ConfigButton", source: "config" }]);
    expect(entries[0]).not.toHaveProperty("confirmed");
  });

  it("emits session-only entries with source: 'session' and no confirmed field", () => {
    const meta = wrappersMetaBlock({
      sessionOnly: ["SessButton"],
      unusedWrappers: [],
      wrapperProvenance: {
        fromConfig: [],
        fromSession: ["SessButton"],
        fromAutoDetect: EMPTY_SPLIT,
      },
    });
    const entries = meta["activeNativeWrappers"] as readonly ActiveNativeWrapper[];
    expect(entries).toEqual([{ name: "SessButton", source: "session" }]);
    expect(entries[0]).not.toHaveProperty("confirmed");
  });

  it("emits autoDetect confirmed entries with source: 'autoDetect', confirmed: true", () => {
    const meta = wrappersMetaBlock({
      sessionOnly: [],
      unusedWrappers: [],
      wrapperProvenance: {
        fromConfig: [],
        fromSession: [],
        fromAutoDetect: { confirmed: ["Button"], assumed: [] },
      },
    });
    expect(meta["activeNativeWrappers"]).toEqual([
      { name: "Button", source: "autoDetect", confirmed: true },
    ]);
  });

  it("emits autoDetect assumed entries with source: 'autoDetect', confirmed: false", () => {
    // Load-bearing P1-F case: the scan found wrappers, none confirmed
    // — but the agent MUST still see the assumed names so it knows
    // what the scanner considered. Silent omission would defeat the
    // whole probe.
    const meta = wrappersMetaBlock({
      sessionOnly: [],
      unusedWrappers: [],
      wrapperProvenance: {
        fromConfig: [],
        fromSession: [],
        fromAutoDetect: { confirmed: [], assumed: ["BeliefSubmitButton"] },
      },
    });
    expect(meta["activeNativeWrappers"]).toEqual([
      { name: "BeliefSubmitButton", source: "autoDetect", confirmed: false },
    ]);
  });

  it("omits the activeNativeWrappers field entirely when no wrapper signal is present", () => {
    const meta = wrappersMetaBlock({
      sessionOnly: [],
      unusedWrappers: [],
      wrapperProvenance: {
        fromConfig: [],
        fromSession: [],
        fromAutoDetect: EMPTY_SPLIT,
      },
    });
    expect(meta["activeNativeWrappers"]).toBeUndefined();
  });

  it("emits one entry per channel when a name appears in multiple sources", () => {
    // Names overlap freely across sources — config + session of the
    // same name stays active even if one source is removed. The
    // tagged list surfaces each origin independently so agents
    // triaging "why is X active?" see every channel.
    const meta = wrappersMetaBlock({
      sessionOnly: ["Button"],
      unusedWrappers: [],
      wrapperProvenance: {
        fromConfig: ["Button"],
        fromSession: ["Button"],
        fromAutoDetect: EMPTY_SPLIT,
      },
    });
    expect(meta["activeNativeWrappers"]).toEqual([
      { name: "Button", source: "config" },
      { name: "Button", source: "session" },
    ]);
  });

  it("emits mixed-source entries in deterministic order (config, autoDetect, session)", () => {
    const meta = wrappersMetaBlock({
      sessionOnly: ["SessBtn"],
      unusedWrappers: [],
      wrapperProvenance: {
        fromConfig: ["ConfigBtn"],
        fromSession: ["SessBtn"],
        fromAutoDetect: { confirmed: ["AutoConfBtn"], assumed: ["AutoAssBtn"] },
      },
    });
    expect(meta["activeNativeWrappers"]).toEqual([
      { name: "ConfigBtn", source: "config" },
      { name: "AutoConfBtn", source: "autoDetect", confirmed: true },
      { name: "AutoAssBtn", source: "autoDetect", confirmed: false },
      { name: "SessBtn", source: "session" },
    ]);
  });

  it("does NOT emit legacy fields activeNativeWrappersBySource or sessionNativeWrappers", () => {
    // Breaking change called out in CHANGELOG — three fields collapse
    // into one tagged list. Callers relying on the old shape see
    // undefined and must migrate.
    const meta = wrappersMetaBlock({
      sessionOnly: ["SessBtn"],
      unusedWrappers: [],
      wrapperProvenance: {
        fromConfig: ["ConfigBtn"],
        fromSession: ["SessBtn"],
        fromAutoDetect: { confirmed: ["AutoBtn"], assumed: [] },
      },
    });
    expect(meta["activeNativeWrappersBySource"]).toBeUndefined();
    expect(meta["sessionNativeWrappers"]).toBeUndefined();
  });

  it("still emits sessionOverridesNote when session-only names exist", () => {
    // The prose note survives the collapse — it names the
    // operational consequence (restart to un-layer) that the
    // per-entry `source: "session"` tag alone does not explain.
    const meta = wrappersMetaBlock({
      sessionOnly: ["SessBtn"],
      unusedWrappers: [],
      wrapperProvenance: {
        fromConfig: [],
        fromSession: ["SessBtn"],
        fromAutoDetect: EMPTY_SPLIT,
      },
    });
    expect(meta["sessionOverridesNote"]).toBeDefined();
    expect(meta["sessionOverridesNote"]).toContain("configure()");
  });
});
