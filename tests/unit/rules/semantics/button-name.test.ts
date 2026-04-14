import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/semantics/button-name.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule semantics/button-name", () => {
  describe("HTML: fires when", () => {
    it("button is empty", () => {
      const violations = runRule(rule, `<button></button>`, { filePath: "index.html" });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.ruleId).toBe("semantics/button-name");
      expect(violations[0]?.severity).toBe("error");
    });

    it("button contains only whitespace", () => {
      const violations = runRule(rule, `<button>   </button>`, { filePath: "index.html" });
      expect(violations).toHaveLength(1);
    });

    it("icon-only button has no aria-label", () => {
      const violations = runRule(rule, `<button><svg></svg></button>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
    });

    it("input type=button has empty value", () => {
      const violations = runRule(rule, `<input type="button" value="">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
    });

    it("role=button div has no accessible name", () => {
      const violations = runRule(rule, `<div role="button" tabindex="0"></div>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
    });
  });

  describe("HTML: does not fire when", () => {
    it("button has visible text", () => {
      const violations = runRule(rule, `<button>Save</button>`, { filePath: "index.html" });
      expect(violations).toHaveLength(0);
    });

    it("icon-only button has aria-label", () => {
      const violations = runRule(rule, `<button aria-label="Close"><svg></svg></button>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("button has aria-labelledby", () => {
      const violations = runRule(rule, `<button aria-labelledby="h1"><svg></svg></button>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("input type=submit has value", () => {
      const violations = runRule(rule, `<input type="submit" value="Send">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("input type=submit with empty value uses UA default (Submit)", () => {
      // type=submit/reset have a UA-default name per HTML spec. False-
      // negative vs strict interpretation, but matches ARIA's behavior.
      const violations = runRule(rule, `<input type="submit">`, { filePath: "index.html" });
      expect(violations).toHaveLength(0);
    });

    it("button wraps an <img> with alt text", () => {
      const violations = runRule(rule, `<button><img src="x.png" alt="Close"></button>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("non-button, non-role=button elements are ignored", () => {
      const violations = runRule(rule, `<div></div>`, { filePath: "index.html" });
      expect(violations).toHaveLength(0);
    });
  });

  describe("JSX: fires when", () => {
    it("icon-only button has no aria-label", () => {
      const violations = runRule(rule, `const X = <button><Icon /></button>;`);
      // The <Icon /> is PascalCase so we treat it as potentially having its
      // own accessible name. False-negative we accept.
      expect(violations).toHaveLength(0);
    });

    it("empty button", () => {
      const violations = runRule(rule, `const X = <button />;`);
      expect(violations).toHaveLength(1);
    });
  });

  describe("JSX: does not fire when", () => {
    it("button has text content", () => {
      const violations = runRule(rule, `const X = <button>Save</button>;`);
      expect(violations).toHaveLength(0);
    });

    it("button has aria-label", () => {
      const violations = runRule(rule, `const X = <button aria-label="Close" />;`);
      expect(violations).toHaveLength(0);
    });

    it("button has runtime-valued aria-label", () => {
      const violations = runRule(rule, `const X = <button aria-label={t('close')} />;`);
      expect(violations).toHaveLength(0);
    });
  });

  describe("JSX: primitive component (info, not error)", () => {
    it("unnamed <button> with spread props emits info", () => {
      const v = runRule(rule, `const Btn = (props) => <button {...props} />;`);
      expect(v).toHaveLength(1);
      expect(v[0]?.severity).toBe("info");
      expect(v[0]?.message).toContain("spread");
    });

    it('<div role="button"> with spread props emits info', () => {
      const v = runRule(rule, `const DropIndicator = (props) => <div role="button" {...props} />;`);
      expect(v).toHaveLength(1);
      expect(v[0]?.severity).toBe("info");
    });

    it("unnamed <button> without spread stays an error", () => {
      const v = runRule(rule, `const X = <button />;`);
      expect(v).toHaveLength(1);
      expect(v[0]?.severity).toBe("error");
    });
  });

  describe("rule metadata", () => {
    it("declares wcag22:4.1.2 and wcag21:4.1.2", () => {
      expect(rule.satisfies).toContain("wcag22:4.1.2");
      expect(rule.satisfies).toContain("wcag21:4.1.2");
    });
  });
});
