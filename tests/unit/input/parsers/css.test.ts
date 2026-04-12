import { describe, expect, it } from "bun:test";
import { parseCss } from "../../../../src/input/parsers/css.ts";
import type { CssAtRule, CssDeclaration, CssRule } from "../../../../src/types/ast.ts";

function asRule(node: unknown): CssRule {
  return node as CssRule;
}

function asAtRule(node: unknown): CssAtRule {
  return node as CssAtRule;
}

describe("parseCss", () => {
  it("parses an empty string without error", () => {
    const { root, errors } = parseCss("");
    expect(root.kind).toBe("CssStylesheet");
    expect(root.rules).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it("parses a simple rule with one declaration", () => {
    const { root, errors } = parseCss("p { color: red; }");
    expect(errors).toHaveLength(0);
    expect(root.rules).toHaveLength(1);
    const rule = asRule(root.rules[0]);
    expect(rule.selector).toBe("p");
    expect(rule.declarations).toHaveLength(1);
    const decl = rule.declarations[0] as CssDeclaration;
    expect(decl.property).toBe("color");
    expect(decl.value).toBe("red");
    expect(decl.important).toBe(false);
  });

  it("parses multiple declarations with and without trailing semicolons", () => {
    const { root } = parseCss(".btn { color: white; background: blue; padding: 8px }");
    const rule = asRule(root.rules[0]);
    expect(rule.declarations).toHaveLength(3);
    expect(rule.declarations[0]?.property).toBe("color");
    expect(rule.declarations[1]?.property).toBe("background");
    expect(rule.declarations[2]?.property).toBe("padding");
  });

  it("parses !important", () => {
    const { root } = parseCss("p { color: red !important; }");
    const rule = asRule(root.rules[0]);
    const decl = rule.declarations[0] as CssDeclaration;
    expect(decl.value).toBe("red");
    expect(decl.important).toBe(true);
  });

  it("parses !important with weird spacing", () => {
    const { root } = parseCss("p { color:red!important }");
    const rule = asRule(root.rules[0]);
    expect(rule.declarations[0]?.important).toBe(true);
  });

  it("parses complex selectors", () => {
    const { root } = parseCss("a:hover, .nav > .item { color: #036; }");
    const rule = asRule(root.rules[0]);
    expect(rule.selector).toBe("a:hover, .nav > .item");
  });

  it("parses multiple top-level rules", () => {
    const { root } = parseCss("a { color: red; } p { color: blue; }");
    expect(root.rules).toHaveLength(2);
    expect(asRule(root.rules[0]).selector).toBe("a");
    expect(asRule(root.rules[1]).selector).toBe("p");
  });

  it("parses block comments", () => {
    const { root } = parseCss("/* header */ p { /* inline */ color: red; }");
    expect(root.rules[0]?.kind).toBe("CssComment");
    const rule = asRule(root.rules[1]);
    expect(rule.selector).toBe("p");
    expect(rule.declarations).toHaveLength(1);
  });

  it("parses @media at-rule with nested rule", () => {
    const { root } = parseCss("@media (max-width: 600px) { p { color: red; } }");
    const atRule = asAtRule(root.rules[0]);
    expect(atRule.kind).toBe("CssAtRule");
    expect(atRule.name).toBe("media");
    expect(atRule.params).toBe("(max-width: 600px)");
    expect(atRule.children).toHaveLength(1);
    const innerRule = asRule(atRule.children[0]);
    expect(innerRule.selector).toBe("p");
  });

  it("parses @import at-rule without a block", () => {
    const { root } = parseCss("@import 'reset.css';");
    const atRule = asAtRule(root.rules[0]);
    expect(atRule.name).toBe("import");
    expect(atRule.params).toBe("'reset.css'");
    expect(atRule.children).toHaveLength(0);
  });

  it("parses calc() and function values with parens", () => {
    const { root } = parseCss("div { width: calc(100% - 32px); color: rgb(10, 20, 30); }");
    const rule = asRule(root.rules[0]);
    expect(rule.declarations[0]?.value).toBe("calc(100% - 32px)");
    expect(rule.declarations[1]?.value).toBe("rgb(10, 20, 30)");
  });

  it("parses selectors containing parens (e.g., :not())", () => {
    const { root } = parseCss("a:not([href]) { color: gray; }");
    const rule = asRule(root.rules[0]);
    expect(rule.selector).toBe("a:not([href])");
  });

  it("records recoverable error on unclosed block but returns partial", () => {
    const { root, errors } = parseCss("p { color: red;");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.recoverable).toBe(true);
    const rule = asRule(root.rules[0]);
    expect(rule.declarations).toHaveLength(1);
  });

  it("never throws on random garbage", () => {
    const garbage = "{{{}}}@@@;;;::::;/* unclosed";
    expect(() => parseCss(garbage)).not.toThrow();
  });

  it("skips declaration lines missing a colon", () => {
    const { root } = parseCss("p { oops; color: red; }");
    const rule = asRule(root.rules[0]);
    // The malformed `oops` is dropped; the valid declaration survives.
    expect(rule.declarations.some((d) => d.property === "color" && d.value === "red")).toBe(true);
  });

  it("parses line/column positions correctly", () => {
    const { root } = parseCss("p {\n  color: red;\n}");
    const rule = asRule(root.rules[0]);
    expect(rule.loc.start.line).toBe(1);
    expect(rule.declarations[0]?.loc.start.line).toBe(2);
  });
});
