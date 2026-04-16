/**
 * Unit tests for the review/timing finder.
 * Covers wcag22:2.2.1, 2.2.3, 2.2.4, 2.2.5, 2.2.6.
 */

import { describe, expect, it } from "bun:test";
import { finder } from "../../../src/review/finders/timing.ts";
import { runFinder } from "../../helpers/run-finder.ts";

describe("review/timing", () => {
  it('flags <meta http-equiv="refresh"> in HTML', () => {
    const out = runFinder(finder, `<meta http-equiv="refresh" content="30; url=/next">`, {
      filePath: "a.html",
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("refresh");
    const ids = new Set(out.map((c) => c.criterionId));
    expect(ids.has("wcag22:2.2.1")).toBe(true);
  });

  it("flags setInterval call in TSX source", () => {
    const out = runFinder(finder, `setInterval(() => tick(), 1000);`);
    const hits = out.filter((c) => c.reason.includes("setInterval"));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.criterionId).toBe("wcag22:2.2.1");
  });

  it("flags setTimeout call in TSX source", () => {
    const out = runFinder(finder, `setTimeout(() => logout(), 60_000);`);
    const hits = out.filter((c) => c.reason.includes("setTimeout"));
    expect(hits.length).toBeGreaterThan(0);
  });

  it("does not flag mere references to the identifiers (no paren)", () => {
    const out = runFinder(finder, `const fn = setTimeout;`);
    // `setTimeout;` with no paren should NOT match because regex requires `\s*\(`
    const hits = out.filter((c) => c.reason.includes("setTimeout"));
    expect(hits).toHaveLength(0);
  });

  it('flags <meta httpEquiv="refresh"> in JSX', () => {
    const out = runFinder(finder, `const X = <meta httpEquiv="refresh" content="60" />;`);
    expect(out.length).toBeGreaterThan(0);
  });

  it("does not flag <meta charset> etc.", () => {
    const out = runFinder(finder, `<meta charset="utf-8">`, { filePath: "a.html" });
    expect(out).toEqual([]);
  });

  it("every hit carries both wcag22 and wcag21 equivalents", () => {
    const out = runFinder(finder, `setInterval(() => tick(), 1000);`);
    const ids = new Set(out.map((c) => c.criterionId));
    expect(ids.has("wcag22:2.2.1")).toBe(true);
    expect(ids.has("wcag21:2.2.1")).toBe(true);
  });

  it("one setTimeout + one setInterval → two distinct candidate offsets", () => {
    const out = runFinder(finder, `setInterval(() => a(), 100); setTimeout(() => b(), 200);`);
    const offsets = new Set(out.map((c) => `${c.location.line}:${c.location.column}`));
    expect(offsets.size).toBeGreaterThanOrEqual(2);
  });

  describe("no filename-based classification (CLAUDE.md §1 regression guard)", () => {
    // Prior design attached "(file looks like a X — likely not user-facing)"
    // hints to setTimeout/setInterval candidates, keyed off filename
    // regexes for debounce/telemetry/authManager/etc. That's the tool
    // duplicating agent-side classification — and risking confidently
    // wrong output when, say, authManager legitimately houses a session
    // timeout or useDebouncedCallback governs user-perceived latency.
    // Pin the removal so the hints never sneak back in.
    const suspectFiles: readonly string[] = [
      "src/hooks/useDebouncedCallback.ts",
      "lib/useThrottledScroll.ts",
      "services/authManager.ts",
      "services/telemetryService.ts",
      "lib/indexedDbTransport.ts",
      "workers/backgroundWorker.ts",
      "utils/retry.ts",
      "lib/heartbeat.ts",
    ];
    for (const file of suspectFiles) {
      it(`does NOT attach filename-derived user-facing judgments for ${file}`, () => {
        const out = runFinder(finder, `setTimeout(() => x(), 1000);`, { filePath: file });
        const hit = out.find((c) => c.reason.includes("setTimeout"));
        expect(hit).toBeDefined();
        expect(hit?.reason).not.toContain("file looks like");
        expect(hit?.reason).not.toContain("likely not user-facing");
      });
    }

    it("keeps the normative review prompt so the agent knows what to check", () => {
      const out = runFinder(finder, `setTimeout(() => x(), 1000);`, {
        filePath: "src/hooks/useDebouncedCallback.ts",
      });
      const hit = out.find((c) => c.reason.includes("setTimeout"));
      expect(hit?.reason).toContain("verify the user can pause, extend, or disable");
    });
  });
});
