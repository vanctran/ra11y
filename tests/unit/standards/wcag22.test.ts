import { describe, expect, it } from "bun:test";
import { wcag22 } from "../../../src/standards/wcag22/standard.ts";
import { WCAG22_CRITERIA } from "../../../src/standards/wcag22/criteria.ts";

describe("WCAG 2.2 standard module", () => {
  describe("identity and metadata", () => {
    it("exports the standard with the canonical id 'wcag22'", () => {
      expect(wcag22.id).toBe("wcag22");
      expect(wcag22.name).toBe("WCAG 2.2");
      expect(wcag22.version).toBe("2.2");
      expect(wcag22.publisher).toBe("W3C");
    });

    it("publishes the canonical W3C URL", () => {
      expect(wcag22.url).toBe("https://www.w3.org/TR/WCAG22/");
    });

    it("defines the three WCAG levels in order A → AA → AAA", () => {
      expect([...wcag22.levels]).toEqual(["A", "AA", "AAA"]);
    });
  });

  describe("criteria list", () => {
    it("contains all 87 criteria (86 active + 4.1.1 historical)", () => {
      // WCAG 2.2 has 86 active SCs after removing the obsolete 4.1.1 Parsing.
      // We include 4.1.1 as a historical entry so the ID resolves for
      // older rules and docs — marked automatable: "manual" to keep it
      // out of the automated-coverage report.
      expect(wcag22.criteria.length).toBe(87);
      expect(WCAG22_CRITERIA.length).toBe(87);
    });

    it("distributes criteria across levels", () => {
      const byLevel = { A: 0, AA: 0, AAA: 0 };
      for (const c of wcag22.criteria) {
        if (c.level === "A") byLevel.A += 1;
        else if (c.level === "AA") byLevel.AA += 1;
        else if (c.level === "AAA") byLevel.AAA += 1;
      }
      // Golden numbers: 32 A, 24 AA, 31 AAA (including historical 4.1.1 at level A).
      expect(byLevel).toEqual({ A: 32, AA: 24, AAA: 31 });
    });

    it("uses globally unique criterion IDs", () => {
      const ids = new Set(wcag22.criteria.map((c) => c.id));
      expect(ids.size).toBe(wcag22.criteria.length);
    });

    it("prefixes every criterion ID with 'wcag22:'", () => {
      for (const c of wcag22.criteria) {
        expect(c.id.startsWith("wcag22:")).toBe(true);
        expect(c.standardId).toBe("wcag22");
      }
    });

    it("uses valid https WCAG 2.2 URLs for every criterion", () => {
      for (const c of wcag22.criteria) {
        expect(c.url).toMatch(/^https:\/\/www\.w3\.org\/TR\/WCAG22\/#[a-z0-9-]+$/);
      }
    });

    it("includes the nine criteria introduced in WCAG 2.2", () => {
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
      for (const localId of newInWcag22) {
        const found = wcag22.criteria.find((c) => c.localId === localId);
        expect(found).toBeDefined();
      }
    });

    it("marks 4.1.1 Parsing as obsolete but still present", () => {
      const parsing = wcag22.criteria.find((c) => c.localId === "4.1.1");
      expect(parsing).toBeDefined();
      expect(parsing?.title.toLowerCase()).toContain("parsing");
      // Obsolete → manual so coverage reports don't treat it as missing.
      expect(parsing?.automatable).toBe("manual");
    });
  });

  describe("cross-standard equivalentTo", () => {
    it("maps WCAG 2.1-equivalent criteria to wcag21:*", () => {
      const contrastMin = wcag22.criteria.find((c) => c.localId === "1.4.3");
      expect(contrastMin?.equivalentTo).toContain("wcag21:1.4.3");
    });

    it("does NOT map the nine WCAG 2.2 additions to wcag21", () => {
      // These didn't exist in 2.1, so they can't have a wcag21 equivalent.
      const newOnly = ["2.4.11", "2.5.7", "2.5.8", "3.2.6", "3.3.7", "3.3.8"];
      for (const id of newOnly) {
        const c = wcag22.criteria.find((cx) => cx.localId === id);
        const equivalents = c?.equivalentTo ?? [];
        expect(equivalents.some((e) => e.startsWith("wcag21:"))).toBe(false);
      }
    });
  });

  describe("automatable distribution", () => {
    it("has at least some full-automatable criteria", () => {
      const full = wcag22.criteria.filter((c) => c.automatable === "full");
      expect(full.length).toBeGreaterThan(0);
    });

    it("classifies media and cognitive SCs as manual", () => {
      const manualIds = ["1.2.1", "1.4.1", "2.1.2", "3.2.1"];
      for (const id of manualIds) {
        const c = wcag22.criteria.find((cx) => cx.localId === id);
        expect(c?.automatable).toBe("manual");
      }
    });
  });
});
