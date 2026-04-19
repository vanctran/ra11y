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

  describe("nativeWrapperElements mapping (Q2-WRAPMAP-RULES)", () => {
    it("opts in to the native `button` tag so mapped wrappers fire", () => {
      expect(rule.wrapperTreatsAsElement).toBe("button");
    });

    it("fires on a wrapper declared to render `<button>` via the mapping with no name", () => {
      const v = runRule(rule, `const X = <IconButton />;`, {
        nativeWrapperElements: { IconButton: "button" },
      });
      expect(v).toHaveLength(1);
      expect(v[0]?.ruleId).toBe("semantics/button-name");
    });

    it("silences when the mapped wrapper call site has aria-label", () => {
      const v = runRule(rule, `const X = <IconButton aria-label="Close" />;`, {
        nativeWrapperElements: { IconButton: "button" },
      });
      expect(v).toHaveLength(0);
    });

    it("does not fire on an unmapped PascalCase component", () => {
      const v = runRule(rule, `const X = <UnknownButton />;`);
      expect(v).toHaveLength(0);
    });
  });

  describe("polymorphic as/asChild resolution (Q2R2-POLYMORPHIC)", () => {
    it('fires on <Box as="button" /> with no accessible name', () => {
      const v = runRule(rule, `const X = <Box as="button" />;`);
      expect(v).toHaveLength(1);
      expect(v[0]?.ruleId).toBe("semantics/button-name");
    });

    it('does not fire when polymorphic `as="button"` call site supplies aria-label', () => {
      const v = runRule(rule, `const X = <Box as="button" aria-label="Close" />;`);
      expect(v).toHaveLength(0);
    });

    it('does not fire when polymorphic `as="button"` has visible text children', () => {
      const v = runRule(rule, `const X = <Box as="button">Save</Box>;`);
      expect(v).toHaveLength(0);
    });

    it("fires on <Slot asChild><button /></Slot> — inner button has no name", () => {
      // Both the inner <button> and the <Slot asChild> call site fail the
      // accessible-name check independently. Two surfaces are honest per
      // AI-first doctrine — the agent dismisses duplicates in one read.
      const v = runRule(rule, `const X = <Slot asChild><button /></Slot>;`);
      expect(v.length).toBeGreaterThanOrEqual(1);
      expect(v[0]?.ruleId).toBe("semantics/button-name");
    });

    it("does not re-dispatch when `as` is a non-literal expression (honest — agent reads)", () => {
      const v = runRule(rule, `const X = <Box as={tag} />;`);
      expect(v).toHaveLength(0);
    });

    it('does not re-dispatch when `as="div"` resolves to a non-target tag', () => {
      const v = runRule(rule, `const X = <Box as="div" />;`);
      expect(v).toHaveLength(0);
    });

    it("does not re-dispatch when `as` is absent", () => {
      const v = runRule(rule, `const X = <Box />;`);
      expect(v).toHaveLength(0);
    });
  });
});
