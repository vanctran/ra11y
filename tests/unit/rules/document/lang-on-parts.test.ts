import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/document/lang-on-parts.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule document/lang-on-parts", () => {
  // --- positive (should fire) -------------------------------------------------

  it("fires on empty lang attribute", () => {
    const v = runRule(rule, `<html lang="en"><body><span lang="">word</span></body></html>`, {
      filePath: "x.html",
    });
    expect(v).toHaveLength(1);
    expect(v[0]?.severity).toBe("error");
    expect(v[0]?.message).toContain("empty");
  });

  it("fires on underscore separator (en_US)", () => {
    const v = runRule(rule, `<html lang="en"><body><div lang="en_US">x</div></body></html>`, {
      filePath: "x.html",
    });
    expect(v).toHaveLength(1);
    expect(v[0]?.severity).toBe("error");
    expect(v[0]?.message).toContain("underscore");
    expect(v[0]?.suggestion).toContain('lang="en-US"');
  });

  it("fires on malformed tag (numbers in primary subtag)", () => {
    const v = runRule(rule, `<html lang="en"><body><cite lang="xyz123">x</cite></body></html>`, {
      filePath: "x.html",
    });
    expect(v).toHaveLength(1);
    expect(v[0]?.severity).toBe("error");
    expect(v[0]?.message).toContain("not a valid BCP 47 tag");
  });

  it("fires on word-as-language ('english')", () => {
    const v = runRule(rule, `<html lang="en"><body><p lang="english">hi</p></body></html>`, {
      filePath: "x.html",
    });
    expect(v).toHaveLength(1);
    expect(v[0]?.severity).toBe("error");
  });

  // --- negative (should not fire) ---------------------------------------------

  it("does not fire on valid 'en'", () => {
    const v = runRule(rule, `<html lang="en"><body><span lang="en">x</span></body></html>`, {
      filePath: "x.html",
    });
    expect(v).toHaveLength(0);
  });

  it("does not fire on valid 'fr-CA'", () => {
    const v = runRule(
      rule,
      `<html lang="en"><body><span lang="fr-CA">bonjour</span></body></html>`,
      { filePath: "x.html" },
    );
    expect(v).toHaveLength(0);
  });

  it("does not fire on valid 'zh-Hans'", () => {
    const v = runRule(rule, `<html lang="en"><body><span lang="zh-Hans">汉</span></body></html>`, {
      filePath: "x.html",
    });
    expect(v).toHaveLength(0);
  });

  it("does not fire on element without a lang attribute", () => {
    const v = runRule(rule, `<html lang="en"><body><span>hello</span></body></html>`, {
      filePath: "x.html",
    });
    expect(v).toHaveLength(0);
  });

  it("ignores <html> (covered by document/lang-attribute / 3.1.1)", () => {
    // Even with a malformed root lang, this rule should stay silent —
    // the 3.1.1 rule owns root-level reporting.
    const v = runRule(rule, `<html lang="en_US"><body></body></html>`, { filePath: "x.html" });
    expect(v).toHaveLength(0);
  });

  // --- edge cases -------------------------------------------------------------

  it("warns (not errors) on uppercase primary subtag", () => {
    const v = runRule(rule, `<html lang="en"><body><span lang="EN">x</span></body></html>`, {
      filePath: "x.html",
    });
    expect(v).toHaveLength(1);
    expect(v[0]?.severity).toBe("warning");
    expect(v[0]?.suggestion).toContain('lang="en"');
  });

  it("accepts private-use tag x-klingon", () => {
    const v = runRule(
      rule,
      `<html lang="en"><body><span lang="x-klingon">tlhIngan</span></body></html>`,
      { filePath: "x.html" },
    );
    expect(v).toHaveLength(0);
  });

  it("flags bare 'x' (private-use needs a subtag)", () => {
    const v = runRule(rule, `<html lang="en"><body><span lang="x">y</span></body></html>`, {
      filePath: "x.html",
    });
    expect(v).toHaveLength(1);
    expect(v[0]?.severity).toBe("error");
    expect(v[0]?.message).toContain("private-use");
  });

  it("flags xml:lang the same way as lang", () => {
    const v = runRule(rule, `<html lang="en"><body><span xml:lang="en_US">x</span></body></html>`, {
      filePath: "x.html",
    });
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain("xml:lang");
  });

  it("works on JSX with string-literal lang", () => {
    const v = runRule(rule, `export const X = () => (<section lang="en_US">hi</section>);`, {
      filePath: "x.tsx",
    });
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain("underscore");
  });

  it("ignores JSX expression-valued lang ({locale})", () => {
    const v = runRule(
      rule,
      `export const X = ({locale}: {locale: string}) => (<section lang={locale}>hi</section>);`,
      { filePath: "x.tsx" },
    );
    expect(v).toHaveLength(0);
  });

  it("cites wcag22:3.1.2 and wcag21:3.1.2", () => {
    expect(rule.satisfies).toContain("wcag22:3.1.2");
    expect(rule.satisfies).toContain("wcag21:3.1.2");
  });
});
