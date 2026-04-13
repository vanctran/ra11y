/**
 * Unit tests for the review/motion-actuation finder (wcag22:2.5.4).
 */

import { describe, expect, it } from "bun:test";
import { finder } from "../../../src/review/finders/motion-actuation.ts";
import { runFinder } from "../../helpers/run-finder.ts";

describe("review/motion-actuation", () => {
  it("flags addEventListener('devicemotion', …) in TSX", () => {
    const source = `
      import { useEffect } from "react";
      export function Shake() {
        useEffect(() => {
          window.addEventListener("devicemotion", handler);
        }, []);
        return null;
      }
    `;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("devicemotion");
  });

  it("flags addEventListener('deviceorientation', …)", () => {
    const source = `window.addEventListener('deviceorientation', fn);`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
  });

  it("flags addEventListener('deviceorientationabsolute', …)", () => {
    const source = `window.addEventListener('deviceorientationabsolute', fn);`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
  });

  it("flags an ondevicemotion property assignment", () => {
    const source = `window.ondevicemotion = handler;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("ondevicemotion");
  });

  it("flags a DeviceMotionEvent type reference", () => {
    const source = `function handler(e: DeviceMotionEvent) { console.log(e); }`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("DeviceMotionEvent");
  });

  it("flags a DeviceOrientationEvent type reference", () => {
    const source = `function handler(e: DeviceOrientationEvent) {}`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
  });

  it("flags an HTML ondevicemotion attribute", () => {
    const source = `<body ondevicemotion="shake()"></body>`;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("ondevicemotion");
  });

  it("does not flag unrelated addEventListener calls", () => {
    const source = `window.addEventListener('click', fn); window.addEventListener('scroll', fn);`;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("does not flag similarly-named user variables", () => {
    const source = `const deviceMotionEnabled = true; const orientation = 'portrait';`;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("emits one candidate per matching criterion id for cross-standard coverage", () => {
    const source = `window.addEventListener("devicemotion", fn);`;
    const out = runFinder(finder, source);
    const ids = new Set(out.map((c) => c.criterionId));
    expect(ids.has("wcag22:2.5.4")).toBe(true);
    expect(ids.has("wcag21:2.5.4")).toBe(true);
    expect(ids.has("section508:1194.21.c")).toBe(true);
    expect(ids.has("en301549:9.2.5.4")).toBe(true);
  });

  it("deduplicates overlapping matches at the same offset", () => {
    const source = `window.addEventListener("devicemotion", fn);`;
    const out = runFinder(finder, source);
    const locations = new Set(out.map((c) => `${c.location.line}:${c.location.column}`));
    // Only one source location should emit, but across 4 criteria = 4 candidates.
    expect(locations.size).toBe(1);
    expect(out.length).toBe(4);
  });
});
