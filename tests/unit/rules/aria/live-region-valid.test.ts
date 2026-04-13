import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/aria/live-region-valid.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule aria/live-region-valid", () => {
  describe("HTML: fires when", () => {
    it("aria-live has an invalid value", () => {
      const v = runRule(rule, `<div aria-live="loud">Saved.</div>`, { filePath: "index.html" });
      expect(v).toHaveLength(1);
      expect(v[0]?.severity).toBe("error");
      expect(v[0]?.message).toContain('aria-live="loud"');
      expect(v[0]?.suggestion).toContain('"polite"');
    });

    it('role="status" pairs with aria-live="assertive"', () => {
      const v = runRule(rule, `<div role="status" aria-live="assertive">Saved.</div>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain('role="status"');
      expect(v[0]?.message).toContain("polite");
      expect(v[0]?.suggestion).toContain('role="alert"');
    });

    it('role="alert" pairs with aria-live="polite"', () => {
      const v = runRule(rule, `<div role="alert" aria-live="polite">Boom.</div>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain('role="alert"');
      expect(v[0]?.message).toContain("assertive");
    });

    it("aria-atomic has an invalid value", () => {
      const v = runRule(rule, `<div aria-live="polite" aria-atomic="yes">Saved.</div>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain('aria-atomic="yes"');
    });

    it("aria-relevant contains an unknown token", () => {
      const v = runRule(rule, `<div aria-live="polite" aria-relevant="updates">x</div>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain('"updates"');
    });

    it('aria-live is set on an aria-hidden="true" element', () => {
      const v = runRule(rule, `<div aria-live="polite" aria-hidden="true">Saved.</div>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("aria-hidden");
    });

    it('role="status" combined with aria-hidden="true"', () => {
      const v = runRule(rule, `<div role="status" aria-hidden="true">Saved.</div>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("aria-hidden");
    });

    it("aria-relevant is empty string", () => {
      const v = runRule(rule, `<div aria-live="polite" aria-relevant="">x</div>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("empty aria-relevant");
    });
  });

  describe("HTML: does NOT fire when", () => {
    it('aria-live="polite"', () => {
      const v = runRule(rule, `<div aria-live="polite">Saved.</div>`, { filePath: "index.html" });
      expect(v).toHaveLength(0);
    });

    it('aria-live="assertive" with no contradicting role', () => {
      const v = runRule(rule, `<div aria-live="assertive">Boom.</div>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(0);
    });

    it('role="status" with no explicit aria-live', () => {
      const v = runRule(rule, `<div role="status">Saved.</div>`, { filePath: "index.html" });
      expect(v).toHaveLength(0);
    });

    it('role="status" reinforced by aria-live="polite"', () => {
      const v = runRule(rule, `<div role="status" aria-live="polite">Saved.</div>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(0);
    });

    it("aria-atomic is true and aria-relevant uses multiple valid tokens", () => {
      const v = runRule(
        rule,
        `<div aria-live="polite" aria-atomic="true" aria-relevant="additions text">x</div>`,
        { filePath: "index.html" },
      );
      expect(v).toHaveLength(0);
    });

    it("element has no live-region attributes at all", () => {
      const v = runRule(rule, `<div>plain</div>`, { filePath: "index.html" });
      expect(v).toHaveLength(0);
    });

    it('aria-live="off" is permitted on any role', () => {
      const v = runRule(rule, `<div role="status" aria-live="off">Silent.</div>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(0);
    });

    it('aria-relevant="all" alone is valid', () => {
      const v = runRule(rule, `<div aria-live="polite" aria-relevant="all">x</div>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(0);
    });
  });

  describe("HTML edge cases", () => {
    it("aria-relevant with all four tokens in any order is valid", () => {
      const v = runRule(
        rule,
        `<div aria-live="polite" aria-relevant="text removals additions all">x</div>`,
        { filePath: "index.html" },
      );
      expect(v).toHaveLength(0);
    });

    it("an invalid aria-live short-circuits subsequent checks (one violation, not two)", () => {
      const v = runRule(
        rule,
        `<div aria-live="bogus" aria-atomic="bogus" aria-relevant="bogus">x</div>`,
        { filePath: "index.html" },
      );
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("aria-live");
    });

    it("uppercase aria-live values are accepted (HTML attribute values are not case-sensitive for ARIA tokens)", () => {
      const v = runRule(rule, `<div aria-live="POLITE">x</div>`, { filePath: "index.html" });
      expect(v).toHaveLength(0);
    });

    it('role="log" with aria-live="assertive" is flagged (log implies polite)', () => {
      const v = runRule(rule, `<div role="log" aria-live="assertive">x</div>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain('role="log"');
    });
  });

  describe("JSX: fires when", () => {
    it("aria-live has an invalid value", () => {
      const v = runRule(rule, `export const C = () => <div aria-live="loud">Saved.</div>;`, {
        filePath: "C.tsx",
      });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain('aria-live="loud"');
    });

    it('role="alert" pairs with aria-live="polite"', () => {
      const v = runRule(
        rule,
        `export const C = () => <div role="alert" aria-live="polite">Boom.</div>;`,
        { filePath: "C.tsx" },
      );
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain('role="alert"');
    });

    it("aria-atomic is invalid", () => {
      const v = runRule(
        rule,
        `export const C = () => <div aria-live="polite" aria-atomic="maybe">x</div>;`,
        { filePath: "C.tsx" },
      );
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("aria-atomic");
    });
  });

  describe("JSX: does NOT fire when", () => {
    it("a valid live region is declared", () => {
      const v = runRule(
        rule,
        `export const C = () => <div role="status" aria-atomic="true">Saved.</div>;`,
        { filePath: "C.tsx" },
      );
      expect(v).toHaveLength(0);
    });

    it("aria-live value is an expression (cannot be statically validated)", () => {
      const v = runRule(rule, `export const C = ({ p }) => <div aria-live={p}>x</div>;`, {
        filePath: "C.tsx",
      });
      expect(v).toHaveLength(0);
    });
  });
});
