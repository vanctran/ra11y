import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/document/lang-attribute.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule document/lang-attribute", () => {
  it("fires when <html> has no lang attribute", () => {
    const v = runRule(
      rule,
      `<!DOCTYPE html><html><head><title>x</title></head><body></body></html>`,
      {
        filePath: "index.html",
      },
    );
    expect(v).toHaveLength(1);
    expect(v[0]?.severity).toBe("error");
    expect(v[0]?.message).toContain("missing the lang attribute");
  });

  it("fires when <html> has an empty lang", () => {
    const v = runRule(rule, `<html lang=""><body></body></html>`, { filePath: "index.html" });
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain("empty");
  });

  it("fires when <html> has whitespace-only lang", () => {
    const v = runRule(rule, `<html lang="   "><body></body></html>`, { filePath: "index.html" });
    expect(v).toHaveLength(1);
  });

  it("does not fire when <html lang='en'>", () => {
    const v = runRule(rule, `<html lang="en"><body></body></html>`, { filePath: "index.html" });
    expect(v).toHaveLength(0);
  });

  it("does not fire when <html lang='ja'>", () => {
    const v = runRule(rule, `<html lang="ja"><body></body></html>`, { filePath: "index.html" });
    expect(v).toHaveLength(0);
  });

  it("accepts xml:lang as a fallback", () => {
    const v = runRule(rule, `<html xml:lang="en"><body></body></html>`, { filePath: "index.html" });
    expect(v).toHaveLength(0);
  });

  it("does not fire on HTML fragments (no <html> root)", () => {
    const v = runRule(rule, `<p>just a fragment</p>`, { filePath: "fragment.html" });
    expect(v).toHaveLength(0);
  });

  it("suggestion mentions BCP 47", () => {
    const v = runRule(rule, `<html><body></body></html>`, { filePath: "index.html" });
    expect(v[0]?.suggestion).toContain("BCP 47");
  });

  it("cites wcag22:3.1.1 and wcag21:3.1.1", () => {
    expect(rule.satisfies).toContain("wcag22:3.1.1");
    expect(rule.satisfies).toContain("wcag21:3.1.1");
  });
});
