/**
 * Unit tests for the review/media-variants finder.
 * Covers wcag22:1.2.4, 1.2.6, 1.2.7, 1.2.8, 1.2.9, 1.4.7.
 */

import { describe, expect, it } from "bun:test";
import { finder } from "../../../src/review/finders/media-variants.ts";
import { runFinder } from "../../helpers/run-finder.ts";

describe("review/media-variants", () => {
  it("HTML <video> emits candidates for applicable criteria", () => {
    const out = runFinder(finder, `<video src="/clip.mp4"></video>`, { filePath: "a.html" });
    const ids = new Set(out.map((c) => c.criterionId));
    expect(ids.has("wcag22:1.2.4")).toBe(true);
    expect(ids.has("wcag22:1.2.6")).toBe(true);
    expect(ids.has("wcag22:1.2.7")).toBe(true);
    expect(ids.has("wcag22:1.2.8")).toBe(true);
    expect(ids.has("wcag22:1.4.7")).toBe(true);
  });

  it("HTML <audio> emits candidates for audio-applicable criteria only", () => {
    const out = runFinder(finder, `<audio src="/track.mp3"></audio>`, { filePath: "a.html" });
    const ids = new Set(out.map((c) => c.criterionId));
    // audio-only live
    expect(ids.has("wcag22:1.2.9")).toBe(true);
    // media alternative and background audio apply to audio too
    expect(ids.has("wcag22:1.2.8")).toBe(true);
    expect(ids.has("wcag22:1.4.7")).toBe(true);
    // sign language / extended audio description / live captions are video-only
    expect(ids.has("wcag22:1.2.4")).toBe(false);
    expect(ids.has("wcag22:1.2.6")).toBe(false);
    expect(ids.has("wcag22:1.2.7")).toBe(false);
  });

  it("JSX <video> emits candidates", () => {
    const out = runFinder(finder, `const X = <video src="/clip.mp4" />;`);
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((c) => c.criterionId === "wcag22:1.2.4")).toBe(true);
  });

  it("files with no media elements emit nothing", () => {
    const out = runFinder(finder, `<p>Hello</p>`, { filePath: "a.html" });
    expect(out).toEqual([]);
  });

  it("each criterion has a wcag21 equivalent emitted", () => {
    const out = runFinder(finder, `<video></video>`, { filePath: "a.html" });
    const ids = new Set(out.map((c) => c.criterionId));
    expect(ids.has("wcag21:1.2.4")).toBe(true);
    expect(ids.has("wcag21:1.4.7")).toBe(true);
  });

  it("reason explains the live/prerecorded question for 1.2.4", () => {
    const out = runFinder(finder, `<video></video>`, { filePath: "a.html" });
    const liveCaption = out.find((c) => c.criterionId === "wcag22:1.2.4");
    expect(liveCaption?.reason).toContain("live");
  });
});
