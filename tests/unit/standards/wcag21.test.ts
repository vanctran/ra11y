import { describe, expect, it } from "bun:test";
import { wcag21 } from "../../../src/standards/wcag21/standard.ts";

describe("WCAG 2.1 standard module", () => {
  it("exports the standard with the canonical id 'wcag21'", () => {
    expect(wcag21.id).toBe("wcag21");
    expect(wcag21.name).toBe("WCAG 2.1");
    expect(wcag21.version).toBe("2.1");
    expect(wcag21.publisher).toBe("W3C");
    expect(wcag21.url).toBe("https://www.w3.org/TR/WCAG21/");
  });

  it("contains 78 criteria (WCAG 2.2's 87 minus the 9 new-in-2.2)", () => {
    expect(wcag21.criteria.length).toBe(78);
  });

  it("distributes criteria as WCAG 2.0+2.1 level counts", () => {
    const byLevel = { A: 0, AA: 0, AAA: 0 };
    for (const c of wcag21.criteria) {
      if (c.level === "A") byLevel.A += 1;
      else if (c.level === "AA") byLevel.AA += 1;
      else if (c.level === "AAA") byLevel.AAA += 1;
    }
    // Derived: wcag22 had 32 A, 24 AA, 31 AAA. Subtract 2.2 additions
    // (2 A: 3.2.6/3.3.7; 4 AA: 2.4.11/2.5.7/2.5.8/3.3.8; 3 AAA:
    // 2.4.12/2.4.13/3.3.9) → 30 A, 20 AA, 28 AAA.
    expect(byLevel).toEqual({ A: 30, AA: 20, AAA: 28 });
  });

  it("does NOT include any of the 9 WCAG 2.2 additions", () => {
    const newInWcag22 = [
      "2.4.11",
      "2.4.12",
      "2.4.13",
      "2.5.7",
      "2.5.8",
      "3.2.6",
      "3.3.7",
      "3.3.8",
      "3.3.9",
    ];
    for (const id of newInWcag22) {
      expect(wcag21.criteria.find((c) => c.localId === id)).toBeUndefined();
    }
  });

  it("points every criterion at its wcag22 equivalent", () => {
    for (const c of wcag21.criteria) {
      expect(c.equivalentTo).toContain(`wcag22:${c.localId}`);
    }
  });

  it("uses valid https WCAG 2.1 URLs", () => {
    for (const c of wcag21.criteria) {
      expect(c.url).toMatch(/^https:\/\/www\.w3\.org\/TR\/WCAG21\/#[a-z0-9-]+$/);
    }
  });

  it("keeps 4.1.1 Parsing as an active criterion (not obsolete)", () => {
    const parsing = wcag21.criteria.find((c) => c.localId === "4.1.1");
    expect(parsing).toBeDefined();
    expect(parsing?.title).toBe("Parsing");
    // WCAG 2.1 description does NOT contain the obsolete note.
    expect(parsing?.description).not.toContain("obsolete");
  });
});
