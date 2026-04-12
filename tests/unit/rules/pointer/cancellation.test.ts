import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/pointer/cancellation.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule pointer/cancellation", () => {
  describe("JSX: fires when", () => {
    it("onMouseDown without onClick or onMouseUp", () => {
      const v = runRule(rule, `const X = <div onMouseDown={activate}>Go</div>;`);
      expect(v).toHaveLength(1);
      expect(v[0]?.severity).toBe("warning");
      expect(v[0]?.message).toContain("onMouseDown");
    });

    it("onTouchStart without onTouchEnd or onClick", () => {
      const v = runRule(rule, `const X = <div onTouchStart={activate}>Go</div>;`);
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("onTouchStart");
    });

    it("both onMouseDown and onTouchStart without any up-event", () => {
      const v = runRule(
        rule,
        `const X = <div onMouseDown={activate} onTouchStart={activate}>Go</div>;`,
      );
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("onMouseDown");
      expect(v[0]?.message).toContain("onTouchStart");
    });

    it("onMouseDown on a button element (still flagged — down-only is the antipattern)", () => {
      const v = runRule(rule, `const X = <button onMouseDown={activate}>Go</button>;`);
      expect(v).toHaveLength(1);
    });
  });

  describe("JSX: does NOT fire when", () => {
    it("onMouseDown with onClick", () => {
      const v = runRule(
        rule,
        `const X = <div onMouseDown={highlight} onClick={activate}>Go</div>;`,
      );
      expect(v).toHaveLength(0);
    });

    it("onMouseDown with onMouseUp", () => {
      const v = runRule(
        rule,
        `const X = <div onMouseDown={highlight} onMouseUp={activate}>Go</div>;`,
      );
      expect(v).toHaveLength(0);
    });

    it("onTouchStart with onTouchEnd", () => {
      const v = runRule(
        rule,
        `const X = <div onTouchStart={highlight} onTouchEnd={activate}>Go</div>;`,
      );
      expect(v).toHaveLength(0);
    });

    it("no down-event handlers at all", () => {
      const v = runRule(rule, `const X = <div onClick={activate}>Go</div>;`);
      expect(v).toHaveLength(0);
    });

    it("onMouseDown with onClick on span", () => {
      const v = runRule(rule, `const X = <span onMouseDown={press} onClick={act}>x</span>;`);
      expect(v).toHaveLength(0);
    });
  });

  describe("HTML: fires when", () => {
    it("onmousedown without onclick or onmouseup", () => {
      const v = runRule(rule, `<div onmousedown="activate()">Go</div>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("onmousedown");
    });

    it("ontouchstart without ontouchend", () => {
      const v = runRule(rule, `<div ontouchstart="activate()">Go</div>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(1);
    });
  });

  describe("HTML: does NOT fire when", () => {
    it("onmousedown with onclick", () => {
      const v = runRule(rule, `<div onmousedown="highlight()" onclick="activate()">Go</div>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(0);
    });

    it("onmousedown with onmouseup", () => {
      const v = runRule(rule, `<div onmousedown="highlight()" onmouseup="activate()">Go</div>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(0);
    });

    it("no down-event handlers", () => {
      const v = runRule(rule, `<div onclick="go()">Go</div>`, { filePath: "index.html" });
      expect(v).toHaveLength(0);
    });
  });

  describe("suggestion quality", () => {
    it("mentions the element tag and suggests adding up-event", () => {
      const v = runRule(rule, `const X = <div onMouseDown={activate}>Go</div>;`);
      expect(v[0]?.suggestion).toContain("<div>");
      expect(v[0]?.suggestion).toContain("onClick");
    });

    it("mentions onTouchEnd for onTouchStart violations", () => {
      const v = runRule(rule, `const X = <div onTouchStart={activate}>Go</div>;`);
      expect(v[0]?.suggestion).toContain("onTouchEnd");
    });
  });

  it("cites wcag22:2.5.2 and wcag21:2.5.2", () => {
    expect(rule.satisfies).toContain("wcag22:2.5.2");
    expect(rule.satisfies).toContain("wcag21:2.5.2");
  });
});
