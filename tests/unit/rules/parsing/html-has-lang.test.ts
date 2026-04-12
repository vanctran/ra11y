import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/parsing/html-has-lang.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule parsing/html-has-lang", () => {
  it("accepts a simple two-letter primary subtag (en)", () => {
    const v = runRule(rule, `<html lang="en"><body><p>hi</p></body></html>`, {
      filePath: "index.html",
    });
    expect(v).toHaveLength(0);
  });

  it("accepts en-US (language + region)", () => {
    const v = runRule(rule, `<html lang="en-US"><body><p>hi</p></body></html>`, {
      filePath: "index.html",
    });
    expect(v).toHaveLength(0);
  });

  it("accepts zh-Hans (language + script)", () => {
    const v = runRule(rule, `<html lang="zh-Hans"><body><p>你好</p></body></html>`, {
      filePath: "index.html",
    });
    expect(v).toHaveLength(0);
  });

  it("accepts es-419 (language + UN M.49 region)", () => {
    const v = runRule(rule, `<html lang="es-419"><body><p>hola</p></body></html>`, {
      filePath: "index.html",
    });
    expect(v).toHaveLength(0);
  });

  it("accepts de-CH-1901 and sr-Latn-RS (long multi-subtag tags)", () => {
    const v = runRule(
      rule,
      `<html lang="de-CH-1901"><body><p lang="sr-Latn-RS">x</p></body></html>`,
      { filePath: "index.html" },
    );
    expect(v).toHaveLength(0);
  });

  it('flags lang="english" as invalid BCP 47', () => {
    const v = runRule(rule, `<html lang="english"><body><p>hi</p></body></html>`, {
      filePath: "index.html",
    });
    expect(v).toHaveLength(1);
    expect(v[0]?.severity).toBe("error");
    expect(v[0]?.message).toContain("english");
    expect(v[0]?.message).toContain("not a valid BCP 47");
    // Context-aware suggestion: recognizes "english" and suggests "en".
    expect(v[0]?.suggestion).toContain('lang="en"');
  });

  it('flags lang="en_US" (underscore instead of dash)', () => {
    const v = runRule(rule, `<html lang="en_US"><body><p>hi</p></body></html>`, {
      filePath: "index.html",
    });
    expect(v).toHaveLength(1);
    expect(v[0]?.suggestion).toContain("dashes");
    expect(v[0]?.suggestion).toContain('lang="en-US"');
  });

  it("flags an empty lang attribute on <html>", () => {
    const v = runRule(rule, `<html lang=""><body><p>hi</p></body></html>`, {
      filePath: "index.html",
    });
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain("empty lang");
  });

  it("flags an empty lang attribute on a non-html element", () => {
    const v = runRule(rule, `<html lang="en"><body><p lang="">hi</p></body></html>`, {
      filePath: "index.html",
    });
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain("<p>");
    expect(v[0]?.message).toContain("empty lang");
  });

  it("does not flag elements without a lang attribute", () => {
    // That's document/lang-attribute's job at the root; this rule only
    // cares about present-but-broken lang values.
    const v = runRule(rule, `<html><body><p>hi</p><span>there</span></body></html>`, {
      filePath: "index.html",
    });
    expect(v).toHaveLength(0);
  });

  it("reports multiple violations when multiple elements are broken", () => {
    const v = runRule(
      rule,
      `<html lang="english"><body><p lang="">a</p><span lang="en_GB">b</span></body></html>`,
      { filePath: "index.html" },
    );
    expect(v).toHaveLength(3);
    expect(v.map((x) => x.message).join("\n")).toContain("english");
    expect(v.map((x) => x.message).join("\n")).toContain("<p>");
    expect(v.map((x) => x.message).join("\n")).toContain("<span>");
  });

  it("accepts a mix of valid lang values across nested elements", () => {
    const v = runRule(
      rule,
      `<html lang="en-US"><body><p lang="fr">Bonjour</p><span lang="ja">こんにちは</span></body></html>`,
      { filePath: "index.html" },
    );
    expect(v).toHaveLength(0);
  });

  it("cites wcag22:3.1.2 and wcag21:3.1.2", () => {
    expect(rule.satisfies).toContain("wcag22:3.1.2");
    expect(rule.satisfies).toContain("wcag21:3.1.2");
  });

  it("points at the offending element's line/column", () => {
    const v = runRule(rule, `<html lang="en">\n<body>\n<p lang="english">x</p>\n</body>\n</html>`, {
      filePath: "index.html",
    });
    expect(v).toHaveLength(1);
    expect(v[0]?.location.line).toBe(3);
  });
});
