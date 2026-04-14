/**
 * Unit tests for the review/pointer-input finder.
 * Covers wcag22:2.5.1 (pointer gestures) and 2.5.6 (concurrent input).
 */

import { describe, expect, it } from "bun:test";
import { finder } from "../../../src/review/finders/pointer-input.ts";
import { runFinder } from "../../helpers/run-finder.ts";

describe("review/pointer-input", () => {
  it("flags onPointerMove in JSX", () => {
    const out = runFinder(finder, `const X = <div onPointerMove={handler} />;`);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("onPointerMove");
    const ids = new Set(out.map((c) => c.criterionId));
    expect(ids.has("wcag22:2.5.1")).toBe(true);
    expect(ids.has("wcag22:2.5.6")).toBe(true);
  });

  it("flags onTouchMove in JSX", () => {
    const out = runFinder(finder, `const X = <div onTouchMove={handler} />;`);
    expect(out.length).toBeGreaterThan(0);
  });

  it("flags addEventListener('touchmove') in source", () => {
    const out = runFinder(finder, `el.addEventListener('touchmove', handler);`);
    const hits = out.filter((c) => c.reason.includes("touchmove"));
    expect(hits.length).toBeGreaterThan(0);
  });

  it("does not flag onClick (single-point, no gesture)", () => {
    const out = runFinder(finder, `const X = <button onClick={handler} />;`);
    expect(out).toEqual([]);
  });

  it("does not flag onPointerDown alone (instantaneous, no path)", () => {
    const out = runFinder(finder, `const X = <div onPointerDown={handler} />;`);
    expect(out).toEqual([]);
  });

  it("every hit carries both wcag22 and wcag21 ids for both criteria", () => {
    const out = runFinder(finder, `const X = <div onTouchMove={h} />;`);
    const ids = new Set(out.map((c) => c.criterionId));
    expect(ids.has("wcag22:2.5.1")).toBe(true);
    expect(ids.has("wcag21:2.5.1")).toBe(true);
    expect(ids.has("wcag22:2.5.6")).toBe(true);
    expect(ids.has("wcag21:2.5.6")).toBe(true);
  });

  it("addEventListener for gesturestart is flagged", () => {
    const out = runFinder(finder, `el.addEventListener("gesturestart", handler);`);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("gesturestart");
  });
});
