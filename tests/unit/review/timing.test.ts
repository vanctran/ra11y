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

  describe("filename role hints (AI-first dismissal context)", () => {
    // Per CLAUDE.md §1 we never suppress — but we enrich the `reason`
    // with a filename-derived role hint so an MCP agent can dismiss
    // the candidate in one pass instead of opening the file.
    const cases: readonly { file: string; role: string }[] = [
      { file: "src/hooks/useDebouncedCallback.ts", role: "debounce" },
      { file: "lib/useThrottledScroll.ts", role: "throttle" },
      { file: "services/authManager.ts", role: "auth" },
      { file: "services/telemetryService.ts", role: "telemetry" },
      { file: "lib/indexedDbTransport.ts", role: "transport" },
      { file: "workers/backgroundWorker.ts", role: "worker" },
      { file: "utils/retry.ts", role: "retry" },
      { file: "lib/heartbeat.ts", role: "keepalive" },
    ];
    for (const { file, role } of cases) {
      it(`annotates ${role} role for ${file}`, () => {
        const out = runFinder(finder, `setTimeout(() => x(), 1000);`, { filePath: file });
        const hit = out.find((c) => c.reason.includes("setTimeout"));
        expect(hit).toBeDefined();
        expect(hit?.reason).toMatch(/file looks like a .+ — likely not user-facing/);
      });
    }

    it("does NOT annotate for an ordinary component file", () => {
      const out = runFinder(finder, `setTimeout(() => logout(), 60_000);`, {
        filePath: "src/ui/Session.tsx",
      });
      const hit = out.find((c) => c.reason.includes("setTimeout"));
      expect(hit).toBeDefined();
      expect(hit?.reason).not.toContain("file looks like");
    });

    it("never replaces the normative review prompt — hint is additive", () => {
      const out = runFinder(finder, `setTimeout(() => x(), 1000);`, {
        filePath: "src/hooks/useDebouncedCallback.ts",
      });
      const hit = out.find((c) => c.reason.includes("setTimeout"));
      expect(hit?.reason).toContain("verify the user can pause, extend, or disable");
    });
  });
});
