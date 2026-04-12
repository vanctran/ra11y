import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/semantics/table-headers.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule semantics/table-headers", () => {
  describe("HTML: fires when", () => {
    it("a table has td cells but no th cells", () => {
      const violations = runRule(
        rule,
        `<table>
          <tr><td>Product</td><td>Price</td></tr>
          <tr><td>Widget</td><td>$50</td></tr>
        </table>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.ruleId).toBe("semantics/table-headers");
      expect(violations[0]?.severity).toBe("warning");
      expect(violations[0]?.message).toContain("no <th>");
      expect(violations[0]?.message).toContain("4 <td> cells");
      expect(violations[0]?.suggestion).toContain('scope="col"');
    });

    it("a table has a caption but no th (caption is prose, not per-cell headers)", () => {
      const violations = runRule(
        rule,
        `<table>
          <caption>Quarterly sales</caption>
          <tr><td>Q1</td><td>$100</td></tr>
          <tr><td>Q2</td><td>$200</td></tr>
        </table>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("<td>");
    });

    it("a table wrapped in a figure still fires when it has no th", () => {
      const violations = runRule(
        rule,
        `<figure>
          <figcaption>Prices</figcaption>
          <table>
            <tr><td>Widget</td><td>$50</td></tr>
          </table>
        </figure>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(1);
    });

    it("nested tables are evaluated independently: inner lacks th, outer has th", () => {
      // Outer table has a th — not flagged. Inner table has only td — flagged.
      const violations = runRule(
        rule,
        `<table>
          <tr><th>Outer</th></tr>
          <tr><td>
            <table>
              <tr><td>InnerA</td><td>InnerB</td></tr>
            </table>
          </td></tr>
        </table>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("2 <td>");
    });

    it("nested tables are evaluated independently: outer lacks th, inner has th", () => {
      // Outer has one td containing another table (the inner table's td
      // doesn't count for the outer because we stop at nested tables).
      // The outer has 1 <td> with no <th> → flagged. Inner has <th> + <td>
      // → fine. Therefore one violation.
      const violations = runRule(
        rule,
        `<table>
          <tr><td>
            <table>
              <tr><th>Inner header</th><td>Inner value</td></tr>
            </table>
          </td></tr>
        </table>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(1);
    });
  });

  describe("HTML: does not fire when", () => {
    it("a table has th in thead and td in tbody", () => {
      const violations = runRule(
        rule,
        `<table>
          <thead><tr><th scope="col">Product</th><th scope="col">Price</th></tr></thead>
          <tbody><tr><td>Widget</td><td>$50</td></tr></tbody>
        </table>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(0);
    });

    it("a table has th in the first row and td afterwards", () => {
      const violations = runRule(
        rule,
        `<table>
          <tr><th>Product</th><th>Price</th></tr>
          <tr><td>Widget</td><td>$50</td></tr>
        </table>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(0);
    });

    it('the table is marked role="presentation" (layout table)', () => {
      const violations = runRule(
        rule,
        `<table role="presentation">
          <tr><td>Logo</td><td>Nav</td></tr>
          <tr><td>Content</td><td>Sidebar</td></tr>
        </table>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(0);
    });

    it('the table is marked role="none" (also layout)', () => {
      const violations = runRule(
        rule,
        `<table role="none">
          <tr><td>A</td><td>B</td></tr>
        </table>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(0);
    });

    it("the table has no td cells at all (empty/structural)", () => {
      const violations = runRule(rule, `<table></table>`, { filePath: "index.html" });
      expect(violations).toHaveLength(0);
    });

    it("the table has only th cells (all-header edge case)", () => {
      const violations = runRule(
        rule,
        `<table>
          <tr><th>A</th><th>B</th><th>C</th></tr>
        </table>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(0);
    });

    it('the table has row headers (scope="row") and td values', () => {
      const violations = runRule(
        rule,
        `<table>
          <tr><th scope="row">Widget</th><td>$50</td></tr>
          <tr><th scope="row">Gadget</th><td>$75</td></tr>
        </table>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(0);
    });
  });

  describe("JSX: fires when", () => {
    it("a JSX table has td but no th", () => {
      const violations = runRule(
        rule,
        `const X = (
          <table>
            <tr><td>Widget</td><td>$50</td></tr>
          </table>
        );`,
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.severity).toBe("warning");
      expect(violations[0]?.message).toContain("2 <td>");
    });
  });

  describe("JSX: does not fire when", () => {
    it("a JSX table has th in the first row", () => {
      const violations = runRule(
        rule,
        `const X = (
          <table>
            <tr><th>Product</th><th>Price</th></tr>
            <tr><td>Widget</td><td>$50</td></tr>
          </table>
        );`,
      );
      expect(violations).toHaveLength(0);
    });

    it('a JSX table is marked role="presentation"', () => {
      const violations = runRule(
        rule,
        `const X = (
          <table role="presentation">
            <tr><td>Logo</td><td>Nav</td></tr>
          </table>
        );`,
      );
      expect(violations).toHaveLength(0);
    });
  });

  describe("rule metadata", () => {
    it("declares wcag22:1.3.1 and wcag21:1.3.1", () => {
      expect(rule.satisfies).toContain("wcag22:1.3.1");
      expect(rule.satisfies).toContain("wcag21:1.3.1");
    });

    it("is node-scoped and severity=warning", () => {
      expect(rule.scope).toBe("node");
      expect(rule.severity).toBe("warning");
    });

    it("has a normativeQuote matching WCAG 1.3.1", () => {
      expect(rule.docs.normativeQuote).toContain("Information, structure, and relationships");
    });
  });
});
