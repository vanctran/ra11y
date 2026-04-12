import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/parsing/duplicate-id.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule parsing/duplicate-id", () => {
  it("fires when two elements share an id", () => {
    const v = runRule(rule, `<div id="main"></div><div id="main"></div>`, {
      filePath: "index.html",
    });
    expect(v).toHaveLength(1);
    expect(v[0]?.severity).toBe("error");
    expect(v[0]?.message).toContain("main");
  });

  it("reports one violation per additional occurrence", () => {
    const v = runRule(rule, `<div id="x"></div><div id="x"></div><div id="x"></div>`, {
      filePath: "index.html",
    });
    // First is seed; second and third are reported.
    expect(v).toHaveLength(2);
  });

  it("reports the line of the FIRST occurrence in the message", () => {
    const v = runRule(rule, `<div id="foo"></div>\n<p>filler</p>\n<div id="foo"></div>`, {
      filePath: "index.html",
    });
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain("line 1");
  });

  it("does not fire when all ids are unique", () => {
    const v = runRule(rule, `<div id="a"></div><div id="b"></div><div id="c"></div>`, {
      filePath: "index.html",
    });
    expect(v).toHaveLength(0);
  });

  it("does not fire when there are no ids at all", () => {
    const v = runRule(rule, `<p>hello</p><p>world</p>`, { filePath: "index.html" });
    expect(v).toHaveLength(0);
  });

  it("ignores empty id attributes", () => {
    const v = runRule(rule, `<div id=""></div><div id=""></div>`, { filePath: "index.html" });
    expect(v).toHaveLength(0);
  });

  it("catches duplicates across different element types", () => {
    const v = runRule(rule, `<h1 id="main"></h1><main id="main"></main>`, {
      filePath: "index.html",
    });
    expect(v).toHaveLength(1);
  });

  it("catches duplicates inside nested structures", () => {
    const v = runRule(
      rule,
      `<section><div id="target"></div></section><article><span id="target"></span></article>`,
      { filePath: "index.html" },
    );
    expect(v).toHaveLength(1);
  });

  it("suggestion mentions aria-labelledby and label[for] impact", () => {
    const v = runRule(rule, `<div id="dup"></div><div id="dup"></div>`, {
      filePath: "index.html",
    });
    expect(v[0]?.suggestion).toContain("aria-labelledby");
  });

  it("cites wcag21:4.1.1 (live in 2.1) but not wcag22:4.1.1 (obsolete)", () => {
    expect(rule.satisfies).toContain("wcag21:4.1.1");
    expect(rule.satisfies).not.toContain("wcag22:4.1.1");
  });

  it("maps to WCAG 2.2 via 4.1.2 Name, Role, Value", () => {
    expect(rule.satisfies).toContain("wcag22:4.1.2");
    expect(rule.satisfies).toContain("wcag21:4.1.2");
  });
});
