import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/keyboard/character-shortcuts.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule keyboard/character-shortcuts", () => {
  describe("fires when", () => {
    it("inline arrow on window matches a single printable key with no modifier", () => {
      const v = runRule(
        rule,
        `function App() {
           window.addEventListener("keydown", (e) => {
             if (e.key === "s") save();
           });
           return <div />;
         }`,
      );
      expect(v).toHaveLength(1);
      expect(v[0]?.severity).toBe("warning");
      expect(v[0]?.message).toContain("keydown");
      expect(v[0]?.message).toContain("window");
    });

    it("function expression on document matches a single key", () => {
      const v = runRule(
        rule,
        `function App() {
           document.addEventListener("keypress", function (e) {
             if (e.key === "/") openSearch();
           });
           return <div />;
         }`,
      );
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("document");
    });

    it("named handler resolved earlier in the file (keyCode form)", () => {
      const v = runRule(
        rule,
        `const onKey = (e) => {
           if (e.keyCode === 83) save();
         };
         function App() {
           window.addEventListener("keydown", onKey);
           return <div />;
         }`,
      );
      expect(v).toHaveLength(1);
      expect(v[0]?.suggestion).toContain("modifier");
    });
  });

  describe("does NOT fire when", () => {
    it("handler also checks a modifier key", () => {
      const v = runRule(
        rule,
        `function App() {
           window.addEventListener("keydown", (e) => {
             if ((e.ctrlKey || e.metaKey) && e.key === "s") save();
           });
           return <div />;
         }`,
      );
      expect(v).toHaveLength(0);
    });

    it("handler inspects event.target (focus guard)", () => {
      const v = runRule(
        rule,
        `function App() {
           document.addEventListener("keydown", (e) => {
             if (e.target.tagName !== "BODY") return;
             if (e.key === "s") save();
           });
           return <div />;
         }`,
      );
      expect(v).toHaveLength(0);
    });

    it("listener is attached to a specific element, not window/document", () => {
      const v = runRule(
        rule,
        `function App() {
           const input = document.querySelector("input");
           input.addEventListener("keydown", (e) => {
             if (e.key === "s") save();
           });
           return <input />;
         }`,
      );
      expect(v).toHaveLength(0);
    });

    it("matches a non-printable key (Escape, Enter, ArrowDown)", () => {
      const v = runRule(
        rule,
        `function App() {
           window.addEventListener("keydown", (e) => {
             if (e.key === "Escape") close();
           });
           return <div />;
         }`,
      );
      expect(v).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("keyCode numeric form for a printable code is flagged", () => {
      const v = runRule(
        rule,
        `function App() {
           window.addEventListener("keyup", (e) => {
             if (e.which === 65) doA();
           });
           return <div />;
         }`,
      );
      expect(v).toHaveLength(1);
    });

    it("keyCode for a non-printable code (Escape=27) is not flagged", () => {
      const v = runRule(
        rule,
        `function App() {
           window.addEventListener("keydown", (e) => {
             if (e.keyCode === 27) close();
           });
           return <div />;
         }`,
      );
      expect(v).toHaveLength(0);
    });

    it("globalThis.addEventListener is also detected", () => {
      const v = runRule(
        rule,
        `function App() {
           globalThis.addEventListener("keydown", (e) => {
             if (e.key === "?") openHelp();
           });
           return <div />;
         }`,
      );
      expect(v).toHaveLength(1);
    });
  });

  describe("suggestion quality", () => {
    it("names the offending key in the suggestion", () => {
      const v = runRule(
        rule,
        `function App() {
           window.addEventListener("keydown", (e) => {
             if (e.key === "j") nextItem();
           });
           return <div />;
         }`,
      );
      expect(v[0]?.suggestion).toContain('"j"');
      expect(v[0]?.suggestion).toContain("ctrlKey");
    });
  });

  it("cites wcag22:2.1.4 and wcag21:2.1.4", () => {
    expect(rule.satisfies).toContain("wcag22:2.1.4");
    expect(rule.satisfies).toContain("wcag21:2.1.4");
  });
});
