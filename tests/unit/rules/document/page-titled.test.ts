import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/document/page-titled.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule document/page-titled", () => {
  it("fires when <head> has no <title>", () => {
    const v = runRule(
      rule,
      `<!DOCTYPE html><html lang="en"><head></head><body><p>x</p></body></html>`,
      { filePath: "index.html" },
    );
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain("missing a <title>");
  });

  it("fires when <title> is empty", () => {
    const v = runRule(
      rule,
      `<!DOCTYPE html><html lang="en"><head><title></title></head><body></body></html>`,
      { filePath: "index.html" },
    );
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain("empty");
  });

  it("fires when <title> contains only whitespace", () => {
    const v = runRule(
      rule,
      `<!DOCTYPE html><html lang="en"><head><title>   </title></head><body></body></html>`,
      { filePath: "index.html" },
    );
    expect(v).toHaveLength(1);
  });

  it("does not fire when <title> has meaningful text", () => {
    const v = runRule(
      rule,
      `<!DOCTYPE html><html lang="en"><head><title>Settings — Acme</title></head><body></body></html>`,
      { filePath: "index.html" },
    );
    expect(v).toHaveLength(0);
  });

  it("does not fire on HTML fragments", () => {
    const v = runRule(rule, `<p>just a fragment</p>`, { filePath: "fragment.html" });
    expect(v).toHaveLength(0);
  });

  it("cites wcag22:2.4.2", () => {
    expect(rule.satisfies).toContain("wcag22:2.4.2");
  });
});
