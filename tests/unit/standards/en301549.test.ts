import { describe, expect, it } from "bun:test";
import { en301549 } from "../../../src/standards/en301549/standard.ts";

describe("EN 301 549 v3.2.1 standard module", () => {
  it("exports the standard with the canonical id 'en301549'", () => {
    expect(en301549.id).toBe("en301549");
    expect(en301549.name).toBe("EN 301 549");
    expect(en301549.version).toBe("v3.2.1");
    expect(en301549.publisher).toBe("ETSI");
  });

  it("contains 50 criteria (WCAG 2.1 A+AA)", () => {
    // WCAG 2.1 A = 30, AA = 20 → 50.
    expect(en301549.criteria.length).toBe(50);
  });

  it("numbers every criterion as 9.X.Y.Z per clause 9 (Web)", () => {
    for (const c of en301549.criteria) {
      expect(c.localId).toMatch(/^9\.\d+\.\d+\.\d+$/);
      expect(c.id).toMatch(/^en301549:9\.\d+\.\d+\.\d+$/);
    }
  });

  it("every criterion maps to its wcag22 equivalent", () => {
    for (const c of en301549.criteria) {
      const wcagId = c.localId.replace(/^9\./, "");
      expect(c.equivalentTo).toContain(`wcag22:${wcagId}`);
    }
  });

  it("includes the expected anchors (9.1.1.1, 9.1.4.3, 9.2.4.1, 9.3.1.1, 9.4.1.3)", () => {
    const requiredIds = ["9.1.1.1", "9.1.4.3", "9.2.4.1", "9.3.1.1", "9.4.1.3"];
    for (const id of requiredIds) {
      expect(en301549.criteria.find((c) => c.localId === id)).toBeDefined();
    }
  });

  it("does NOT include WCAG 2.2 additions", () => {
    // e.g., 9.2.4.11 would be EN's mapping of 2.4.11 if it existed.
    expect(en301549.criteria.find((c) => c.localId === "9.2.4.11")).toBeUndefined();
    expect(en301549.criteria.find((c) => c.localId === "9.2.5.7")).toBeUndefined();
  });

  it("does NOT include any Level AAA criteria", () => {
    // AAA criteria from WCAG 2.0 and 2.1 should be filtered out.
    const aaaAnchors = ["9.1.4.6", "9.2.2.3", "9.2.4.10"];
    for (const id of aaaAnchors) {
      expect(en301549.criteria.find((c) => c.localId === id)).toBeUndefined();
    }
  });
});
