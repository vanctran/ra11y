import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/semantics/list-structure.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule semantics/list-structure", () => {
  describe("HTML: fires when", () => {
    it("li is inside a div", () => {
      const violations = runRule(rule, `<div><li>Home</li><li>About</li></div>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(2);
      expect(violations[0]?.ruleId).toBe("semantics/list-structure");
    });

    it("ul has a div child instead of li", () => {
      const violations = runRule(rule, `<ul><div>Home</div></ul>`, { filePath: "index.html" });
      expect(violations).toHaveLength(1);
    });

    it("ol has a span child", () => {
      const violations = runRule(rule, `<ol><span>first</span></ol>`, { filePath: "index.html" });
      expect(violations).toHaveLength(1);
    });
  });

  describe("HTML: does not fire when", () => {
    it("li is inside a ul", () => {
      const violations = runRule(rule, `<ul><li>Home</li><li>About</li></ul>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("li is inside an ol", () => {
      const violations = runRule(rule, `<ol><li>First</li><li>Second</li></ol>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("li is inside a menu", () => {
      const violations = runRule(rule, `<menu><li>Copy</li></menu>`, { filePath: "index.html" });
      expect(violations).toHaveLength(0);
    });

    it("ul contains a script tag (HTML spec allows this)", () => {
      const violations = runRule(rule, `<ul><li>x</li><script>init();</script></ul>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });
  });

  describe("JSX: fires when", () => {
    it("li is inside a div", () => {
      const violations = runRule(rule, `const X = <div><li>Home</li></div>;`);
      expect(violations).toHaveLength(1);
    });

    it("ul has a div child", () => {
      const violations = runRule(rule, `const X = <ul><div>Home</div></ul>;`);
      expect(violations).toHaveLength(1);
    });
  });

  describe("JSX: does not fire when", () => {
    it("li is inside a ul", () => {
      const violations = runRule(rule, `const X = <ul><li>Home</li></ul>;`);
      expect(violations).toHaveLength(0);
    });

    it("ul has a PascalCase component child (may render li internally)", () => {
      const violations = runRule(rule, `const X = <ul><ListItem>x</ListItem></ul>;`);
      expect(violations).toHaveLength(0);
    });

    it("li has a PascalCase parent (mirror of child-side handling — wrapper may render <ul>)", () => {
      const violations = runRule(
        rule,
        `const X = <NavigationMenuList><li>Home</li></NavigationMenuList>;`,
      );
      expect(violations).toHaveLength(0);
    });
  });

  describe("JSX: primitive component definition (info, not warning)", () => {
    it("top-level <li> in a component return emits info, not warning", () => {
      const violations = runRule(
        rule,
        `function GridItem(props) { return <li {...props}>{props.children}</li>; }`,
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.severity).toBe("info");
      expect(violations[0]?.message).toContain("primitive");
    });

    it("top-level <li> inside an MDX-style component map emits info", () => {
      const violations = runRule(rule, `export const li = ({children}) => <li>{children}</li>;`);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.severity).toBe("info");
    });

    it("<li> wrapped in a <div> stays a warning (real stray-li, not a primitive)", () => {
      const violations = runRule(rule, `const X = <div><li>Home</li></div>;`);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.severity).toBe("warning");
    });
  });

  describe("rule metadata", () => {
    it("declares wcag22:1.3.1 and wcag21:1.3.1", () => {
      expect(rule.satisfies).toContain("wcag22:1.3.1");
      expect(rule.satisfies).toContain("wcag21:1.3.1");
    });
  });
});
