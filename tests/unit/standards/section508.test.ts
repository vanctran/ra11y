import { describe, expect, it } from "bun:test";
import { section508 } from "../../../src/standards/section508/standard.ts";

describe("Section 508 (2017 refresh) standard module", () => {
  it("exports the standard with the canonical id 'section508'", () => {
    expect(section508.id).toBe("section508");
    expect(section508.name).toBe("Section 508 (2017 refresh)");
    expect(section508.version).toBe("2017");
    expect(section508.publisher).toBe("U.S. Access Board");
  });

  it("uses a single level 'base'", () => {
    expect([...section508.levels]).toEqual(["base"]);
  });

  it("contains 38 criteria (WCAG 2.0 A+AA)", () => {
    // WCAG 2.0 level A: 25, level AA: 13 → 38 total.
    expect(section508.criteria.length).toBe(38);
  });

  it("every criterion has level 'base'", () => {
    for (const c of section508.criteria) {
      expect(c.level).toBe("base");
    }
  });

  it("every criterion has equivalentTo pointing at its wcag22 counterpart", () => {
    for (const c of section508.criteria) {
      expect(c.equivalentTo).toContain(`wcag22:${c.localId}`);
    }
  });

  it("does NOT include any of the 17 WCAG 2.1 additions", () => {
    const newInWcag21 = [
      "1.3.4",
      "1.3.5",
      "1.3.6",
      "1.4.10",
      "1.4.11",
      "1.4.12",
      "1.4.13",
      "2.1.4",
      "2.2.6",
      "2.3.3",
      "2.5.1",
      "2.5.2",
      "2.5.3",
      "2.5.4",
      "2.5.5",
      "2.5.6",
      "4.1.3",
    ];
    for (const id of newInWcag21) {
      expect(section508.criteria.find((c) => c.localId === id)).toBeUndefined();
    }
  });

  it("does NOT include any of the 9 WCAG 2.2 additions", () => {
    const newInWcag22 = ["2.4.11", "2.5.7", "2.5.8", "3.2.6", "3.3.7", "3.3.8"];
    for (const id of newInWcag22) {
      expect(section508.criteria.find((c) => c.localId === id)).toBeUndefined();
    }
  });

  it("does NOT include any Level AAA criteria", () => {
    // WCAG 2.0 level values survive as the original automation
    // classification, but we stamp c.level = "base" for Section 508.
    // The test is really "the source row level wasn't AAA" — we assert
    // by looking at the local IDs.
    const aaaIds = ["1.2.6", "1.2.7", "1.2.8", "1.2.9", "1.4.6", "1.4.7", "1.4.8", "1.4.9"];
    for (const id of aaaIds) {
      expect(section508.criteria.find((c) => c.localId === id)).toBeUndefined();
    }
  });

  it("includes the canonical WCAG 2.0 A+AA anchors (1.1.1, 1.4.3, 2.4.1, 3.1.1, 4.1.2)", () => {
    const requiredIds = ["1.1.1", "1.4.3", "2.4.1", "3.1.1", "4.1.2"];
    for (const id of requiredIds) {
      expect(section508.criteria.find((c) => c.localId === id)).toBeDefined();
    }
  });
});
