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

  describe("whitespace normalization", () => {
    it("visible text split across lines by JSX indentation still matches aria-label", () => {
      const v = runRule(
        rule,
        `const X = <button aria-label="Save changes">\n  Save\n  changes\n</button>;`,
      );
      expect(v).toHaveLength(0);
    });

    it("reports whitespace-normalized visible text in the message", () => {
      const v = runRule(
        rule,
        `const X = <a aria-label="Go home">\n            Home\n            Page\n          </a>;`,
      );
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("Home Page");
      expect(v[0]?.message).not.toContain("\n");
    });

    it("suggestion mentions aria-hidden as a resolution path", () => {
      const v = runRule(rule, `<button aria-label="Submit">Send</button>`, {
        filePath: "index.html",
      });
      expect(v[0]?.suggestion).toContain("aria-hidden");
    });
  });

  it("cites wcag22:2.5.3 and wcag21:2.5.3", () => {
    expect(rule.satisfies).toContain("wcag22:2.5.3");
    expect(rule.satisfies).toContain("wcag21:2.5.3");
  });

  describe("ranked fix paths (deterministic fix-verify)", () => {
    it("leads with widen-aria-label by default", () => {
      const v = runRule(rule, `<button aria-label="Close dialog">Cancel</button>`, {
        filePath: "index.html",
      });
      expect(v[0]?.suggestion).toMatch(/^Primary fix: widen aria-label/);
      expect(v[0]?.suggestion).toContain("Alternatives (less likely)");
    });

    it("promotes mark-icon-hidden when visible text has an arrow glyph", () => {
      const v = runRule(rule, `<button aria-label="Next slide">→ Continue</button>`, {
        filePath: "index.html",
      });
      expect(v[0]?.suggestion).toMatch(
        /^Primary fix: if the visible text contains a decorative icon/,
      );
    });

    it("promotes mark-icon-hidden when visible text has an emoji", () => {
      const v = runRule(rule, `<button aria-label="Submit form">Send 📤</button>`, {
        filePath: "index.html",
      });
      expect(v[0]?.suggestion).toMatch(
        /^Primary fix: if the visible text contains a decorative icon/,
      );
    });

    it("always lists exactly 2 alternatives so the agent can pipe them in order", () => {
      const v = runRule(rule, `<button aria-label="Submit form">Send</button>`, {
        filePath: "index.html",
      });
      const matches = v[0]?.suggestion?.match(/\([ab]\) /g);
      expect(matches).toHaveLength(2);
    });

    it("acknowledges interleaved expansion when all visible-text words appear in aria-label in order with extras between", () => {
      // Real-world case: aria-label is an authored expansion of the visible
      // text — "Start the 8-question Perception Gap Assessment" contains
      // every word of "Start the Assessment" in order, with extras inserted.
      const v = runRule(
        rule,
        `<button aria-label="Start the 8-question Perception Gap Assessment">Start the Assessment</button>`,
        { filePath: "index.html" },
      );
      expect(v).toHaveLength(1);
      expect(v[0]?.suggestion).toContain("expanded label");
      expect(v[0]?.suggestion).toMatch(/Primary fix: rephrase aria-label/);
    });

    it("surfaces case mismatches on visible-text words (Assessment vs assessment)", () => {
      // Additive reason-text enrichment: detection is case-insensitive
      // per WCAG 2.5.3, but case divergence can matter for AT
      // pronunciation and voice-control. Surface the delta; the agent
      // decides whether this context cares.
      const v = runRule(
        rule,
        `<button aria-label="Start the 8-question Perception Gap assessment">Start the Assessment</button>`,
        { filePath: "index.html" },
      );
      expect(v).toHaveLength(1);
      expect(v[0]?.suggestion).toContain("case mismatch");
      expect(v[0]?.suggestion).toContain('"Assessment"');
    });
  });
});
