/**
 * Unit tests for the MCP session meta-cache helpers.
 *
 * Covers the three invariants that make the opt-in `metaMode: "delta"`
 * path safe:
 *
 *  1. `hashToolInput` is stable across caller-ordering mutations and
 *     pagination flags but changes when any field that could legitimately
 *     alter scan output changes.
 *  2. `computeMetaDelta` surfaces changed fields under `delta`, surfaces
 *     disappeared fields under `removedFields`, and implies unchanged
 *     fields by absence.
 *  3. `applyMetaCacheMode` passes through in `"full"` mode and collapses
 *     to a delta shape with the same `sessionRef` on repeat calls in
 *     `"delta"` mode.
 */

import { describe, expect, it } from "bun:test";
import {
  applyMetaCacheMode,
  computeMetaDelta,
  hashToolInput,
  readMetaMode,
} from "../../../src/mcp/meta-cache.ts";
import { McpSession } from "../../../src/mcp/session.ts";

describe("readMetaMode", () => {
  it("defaults to 'full' when unspecified", () => {
    expect(readMetaMode({})).toBe("full");
  });

  it("returns 'delta' only on exact match", () => {
    expect(readMetaMode({ metaMode: "delta" })).toBe("delta");
  });

  it("coerces unknown values to 'full' (no ambiguous input)", () => {
    expect(readMetaMode({ metaMode: "DELTA" })).toBe("full");
    expect(readMetaMode({ metaMode: true })).toBe("full");
    expect(readMetaMode({ metaMode: null })).toBe("full");
  });
});

describe("hashToolInput", () => {
  it("is deterministic across calls with equal inputs", () => {
    const a = hashToolInput("scan_project", { cwd: "/a", standard: "wcag22" });
    const b = hashToolInput("scan_project", { cwd: "/a", standard: "wcag22" });
    expect(a).toBe(b);
  });

  it("is stable across key ordering in the params object", () => {
    const a = hashToolInput("scan_project", { cwd: "/a", standard: "wcag22", level: "AA" });
    const b = hashToolInput("scan_project", { level: "AA", standard: "wcag22", cwd: "/a" });
    expect(a).toBe(b);
  });

  it("is stable across array ordering for primitive arrays", () => {
    const a = hashToolInput("scan_project", { additionalPaths: ["a", "b"] });
    const b = hashToolInput("scan_project", { additionalPaths: ["b", "a"] });
    expect(a).toBe(b);
  });

  it("changes when the tool name differs", () => {
    const a = hashToolInput("scan", { cwd: "/a" });
    const b = hashToolInput("scan_project", { cwd: "/a" });
    expect(a).not.toBe(b);
  });

  it("changes when a signature field changes", () => {
    const a = hashToolInput("scan_project", { cwd: "/a" });
    const b = hashToolInput("scan_project", { cwd: "/b" });
    expect(a).not.toBe(b);
  });

  it("ignores metaMode itself so a caller toggling full↔delta keeps the same ref", () => {
    const a = hashToolInput("scan_project", { cwd: "/a", metaMode: "delta" });
    const b = hashToolInput("scan_project", { cwd: "/a", metaMode: "full" });
    const c = hashToolInput("scan_project", { cwd: "/a" });
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it("ignores pagination so a paged walk stays on one sessionRef", () => {
    const a = hashToolInput("scan_project", { cwd: "/a" });
    const b = hashToolInput("scan_project", { cwd: "/a", limit: 50, offset: 100 });
    expect(a).toBe(b);
  });

  it("prefixes the sessionRef with the tool name for agent-readability", () => {
    const ref = hashToolInput("scan_file", { path: "x.tsx" });
    expect(ref).toMatch(/^scan_file-[0-9a-f]{8}$/);
  });
});

describe("computeMetaDelta", () => {
  it("returns empty delta + empty removed when nothing changed", () => {
    const { delta, removedFields } = computeMetaDelta(
      { filesScanned: 5, durationMs: 12 },
      { filesScanned: 5, durationMs: 12 },
    );
    expect(delta).toEqual({});
    expect(removedFields).toEqual([]);
  });

  it("surfaces changed primitive fields under delta", () => {
    const { delta, removedFields } = computeMetaDelta(
      { filesScanned: 5, durationMs: 12 },
      { filesScanned: 5, durationMs: 18 },
    );
    expect(delta).toEqual({ durationMs: 18 });
    expect(removedFields).toEqual([]);
  });

  it("surfaces nested-object changes when the sub-shape differs", () => {
    const { delta } = computeMetaDelta(
      { filesByExtension: { ".tsx": 5, ".css": 1 } },
      { filesByExtension: { ".tsx": 6, ".css": 1 } },
    );
    expect(delta).toEqual({ filesByExtension: { ".tsx": 6, ".css": 1 } });
  });

  it("treats array reorderings as changes (positional equality)", () => {
    // Positional equality is intentional — arrays in meta (e.g.,
    // standards, hints) are ordered by the builder for determinism;
    // a reorder is a real change worth surfacing.
    const { delta } = computeMetaDelta(
      { standards: ["wcag22"] },
      { standards: ["wcag22", "wcag21"] },
    );
    expect(delta).toEqual({ standards: ["wcag22", "wcag21"] });
  });

  it("lists fields present in baseline but absent in curr under removedFields", () => {
    const { delta, removedFields } = computeMetaDelta(
      { filesScanned: 5, autoDetectedWrappers: ["Button"] },
      { filesScanned: 5 },
    );
    expect(delta).toEqual({});
    expect(removedFields).toEqual(["autoDetectedWrappers"]);
  });

  it("lists new fields under delta (baseline did not have them)", () => {
    const { delta, removedFields } = computeMetaDelta(
      { filesScanned: 5 },
      { filesScanned: 5, configNote: "hi" },
    );
    expect(delta).toEqual({ configNote: "hi" });
    expect(removedFields).toEqual([]);
  });
});

describe("applyMetaCacheMode", () => {
  it("in 'full' mode, passes through the meta block unchanged and does not write the cache", () => {
    const session = new McpSession();
    const fullMeta = { filesScanned: 5, durationMs: 12 };
    const result = applyMetaCacheMode({ toolName: "scan", params: {}, fullMeta, session });
    expect(result).toEqual(fullMeta);
    expect(session.metaCacheSize).toBe(0);
  });

  it("in 'delta' mode with no baseline, emits full meta + sessionRef + metaMode:'full'", () => {
    const session = new McpSession();
    const fullMeta = { filesScanned: 5, durationMs: 12 };
    const result = applyMetaCacheMode({
      toolName: "scan_project",
      params: { metaMode: "delta", cwd: "/a" },
      fullMeta,
      session,
    });
    expect(result["filesScanned"]).toBe(5);
    expect(result["durationMs"]).toBe(12);
    expect(result["metaMode"]).toBe("full");
    expect(typeof result["sessionRef"]).toBe("string");
    expect(result["sessionRef"]).toMatch(/^scan_project-[0-9a-f]{8}$/);
    expect(session.metaCacheSize).toBe(1);
  });

  it("in 'delta' mode with a matching baseline, emits a delta shape with the same sessionRef", () => {
    const session = new McpSession();
    const params = { metaMode: "delta", cwd: "/a" };
    const first = applyMetaCacheMode({
      toolName: "scan_project",
      params,
      fullMeta: { filesScanned: 5, durationMs: 12, rulesEvaluated: 20 },
      session,
    });
    const firstRef = first["sessionRef"] as string;
    const second = applyMetaCacheMode({
      toolName: "scan_project",
      params,
      fullMeta: { filesScanned: 5, durationMs: 18, rulesEvaluated: 20 },
      session,
    });
    expect(second["sessionRef"]).toBe(firstRef);
    expect(second["metaMode"]).toBe("delta");
    expect(second["delta"]).toEqual({ durationMs: 18 });
    // unchanged fields are IMPLICIT — absent from the delta shape.
    // That is the whole point of the opt-in.
    expect("filesScanned" in (second["delta"] as object)).toBe(false);
    expect("rulesEvaluated" in (second["delta"] as object)).toBe(false);
    // removedFields is omitted entirely when nothing disappeared
    // (no sentinel-empty arrays per CLAUDE.md §1).
    expect("removedFields" in second).toBe(false);
  });

  it("emits removedFields when a baseline field is absent in the current meta", () => {
    const session = new McpSession();
    const params = { metaMode: "delta", cwd: "/a" };
    applyMetaCacheMode({
      toolName: "scan_project",
      params,
      fullMeta: { filesScanned: 5, autoDetectedWrappers: ["Button"] },
      session,
    });
    const second = applyMetaCacheMode({
      toolName: "scan_project",
      params,
      fullMeta: { filesScanned: 5 },
      session,
    });
    expect(second["removedFields"]).toEqual(["autoDetectedWrappers"]);
  });

  it("issues a fresh sessionRef when the signature changes (per-key replacement)", () => {
    const session = new McpSession();
    const firstRef = applyMetaCacheMode({
      toolName: "scan_project",
      params: { metaMode: "delta", cwd: "/a" },
      fullMeta: { filesScanned: 5 },
      session,
    })["sessionRef"];
    const secondRef = applyMetaCacheMode({
      toolName: "scan_project",
      params: { metaMode: "delta", cwd: "/b" },
      fullMeta: { filesScanned: 5 },
      session,
    })["sessionRef"];
    expect(firstRef).not.toBe(secondRef);
    // Cross-signature entries accumulate rather than evicting older
    // refs — a session that alternates between two cwds doesn't thrash.
    expect(session.metaCacheSize).toBe(2);
  });

  it("replaces the baseline on each delta-mode call so future deltas track the latest state", () => {
    const session = new McpSession();
    const params = { metaMode: "delta", cwd: "/a" };
    // Call 1: baseline = {a: 1, b: 1}
    applyMetaCacheMode({
      toolName: "scan_project",
      params,
      fullMeta: { a: 1, b: 1 },
      session,
    });
    // Call 2: {a: 1, b: 2} — delta surfaces b. Baseline now {a: 1, b: 2}.
    applyMetaCacheMode({
      toolName: "scan_project",
      params,
      fullMeta: { a: 1, b: 2 },
      session,
    });
    // Call 3: {a: 1, b: 2} again — no changes since the LATEST baseline,
    // delta is empty. Without baseline replacement, this would still
    // show `b` as changed against the original.
    const third = applyMetaCacheMode({
      toolName: "scan_project",
      params,
      fullMeta: { a: 1, b: 2 },
      session,
    });
    expect(third["delta"]).toEqual({});
  });
});
