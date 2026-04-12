import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/semantics/label-in-name.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule semantics/label-in-name", () => {
  describe("HTML: fires when", () => {
    it("aria-label does not contain visible text", () => {
      const v = runRule(rule, `<button aria-label="Submit form">Send</button>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(1);
      expect(v[0]?.severity).toBe("error");
      expect(v[0]?.message).toContain("Send");
      expect(v[0]?.message).toContain("Submit form");
    });

    it("link aria-label does not contain visible text", () => {
      const v = runRule(rule, `<a href="/home" aria-label="Navigate">Home</a>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(1);
    });

    it("visible text is a different word entirely", () => {
      const v = runRule(rule, `<button aria-label="Close dialog">Cancel</button>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(1);
    });
  });

  describe("HTML: does NOT fire when", () => {
    it("aria-label contains visible text as substring", () => {
      const v = runRule(rule, `<button aria-label="Send message">Send</button>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(0);
    });

    it("aria-label exactly matches visible text", () => {
      const v = runRule(rule, `<button aria-label="Save">Save</button>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(0);
    });

    it("no aria-label present", () => {
      const v = runRule(rule, `<button>Click me</button>`, { filePath: "index.html" });
      expect(v).toHaveLength(0);
    });

    it("empty aria-label", () => {
      const v = runRule(rule, `<button aria-label="">Submit</button>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(0);
    });

    it("no visible text (icon-only button)", () => {
      const v = runRule(rule, `<button aria-label="Close"><svg></svg></button>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(0);
    });

    it("non-interactive element is ignored", () => {
      const v = runRule(rule, `<div aria-label="Something">Different</div>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(0);
    });
  });

  describe("JSX: fires when", () => {
    it("aria-label does not contain visible text", () => {
      const v = runRule(rule, `const X = <button aria-label="Submit form">Send</button>;`);
      expect(v).toHaveLength(1);
    });

    it("link text is not in aria-label", () => {
      const v = runRule(rule, `const X = <a aria-label="Navigate here">Home</a>;`);
      expect(v).toHaveLength(1);
    });
  });

  describe("JSX: does NOT fire when", () => {
    it("aria-label contains visible text", () => {
      const v = runRule(rule, `const X = <button aria-label="Send email">Send</button>;`);
      expect(v).toHaveLength(0);
    });

    it("aria-label is an expression (skipped)", () => {
      const v = runRule(rule, `const X = <button aria-label={label}>Send</button>;`);
      expect(v).toHaveLength(0);
    });

    it("no visible text", () => {
      const v = runRule(rule, `const X = <button aria-label="Close" />;`);
      expect(v).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("case-insensitive match passes", () => {
      const v = runRule(rule, `<button aria-label="send message">Send</button>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(0);
    });

    it("case-insensitive mismatch still fails", () => {
      const v = runRule(rule, `<button aria-label="CLOSE">Cancel</button>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(1);
    });

    it("suggestion includes the visible text", () => {
      const v = runRule(rule, `<button aria-label="Submit">Send</button>`, {
        filePath: "index.html",
      });
      expect(v[0]?.suggestion).toContain("Send");
    });
  });

  it("cites wcag22:2.5.3 and wcag21:2.5.3", () => {
    expect(rule.satisfies).toContain("wcag22:2.5.3");
    expect(rule.satisfies).toContain("wcag21:2.5.3");
  });
});
