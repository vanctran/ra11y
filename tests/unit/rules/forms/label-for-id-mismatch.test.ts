import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/forms/label-for-id-mismatch.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule forms/label-for-id-mismatch", () => {
  describe("HTML: does NOT fire when", () => {
    it("label[for] matches an existing id", () => {
      const v = runRule(rule, `<label for="email">Email</label><input id="email" type="email">`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(0);
    });

    it("multiple labels reference the same (existing) id", () => {
      const v = runRule(
        rule,
        `<label for="tos">Agree</label><label for="tos">I agree</label><input id="tos" type="checkbox">`,
        { filePath: "index.html" },
      );
      expect(v).toHaveLength(0);
    });

    it("label has no `for` at all (wrapping form handled by labels-required)", () => {
      const v = runRule(rule, `<label>Name<input type="text"></label>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(0);
    });

    it("label has empty for='' (nothing to resolve)", () => {
      const v = runRule(rule, `<label for="">Orphan</label><input id="email" type="email">`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(0);
    });

    it("label[for] points at a non-input element that still has the id", () => {
      // HTML allows `<label for>` to point at any "labelable" element; we
      // don't validate that target is actually a form control — the rule
      // is specifically about dangling references. Other rules handle
      // wrong-target semantics.
      const v = runRule(rule, `<label for="thing">Thing</label><div id="thing"></div>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(0);
    });
  });

  describe("HTML: fires when", () => {
    it("for= has a typo vs the target id", () => {
      const v = runRule(rule, `<label for="emai">Email</label><input id="email" type="email">`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(1);
      expect(v[0]?.severity).toBe("error");
      expect(v[0]?.message).toContain("emai");
    });

    it("for= points at an id that does not exist at all", () => {
      const v = runRule(
        rule,
        `<label for="nonexistent">Orphan</label><input id="email" type="email">`,
        { filePath: "index.html" },
      );
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("nonexistent");
    });

    it("for= is case-different from the target id (ids are case-sensitive)", () => {
      const v = runRule(rule, `<label for="Email">Email</label><input id="email" type="email">`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(1);
    });

    it("still flags broken for= even when the label also wraps a control", () => {
      const v = runRule(rule, `<label for="ghost">Name<input id="name" type="text"></label>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(1);
      expect(v[0]?.suggestion).toContain("implicit association");
    });

    it("suggestion offers the nearest existing id as a typo hint", () => {
      const v = runRule(rule, `<label for="emai">Email</label><input id="email" type="email">`, {
        filePath: "index.html",
      });
      expect(v[0]?.suggestion).toContain(`id="email"`);
    });

    it("reports each broken label independently", () => {
      const v = runRule(
        rule,
        `<label for="a1">A</label><label for="b1">B</label><input id="a" type="text"><input id="b" type="text">`,
        { filePath: "index.html" },
      );
      expect(v).toHaveLength(2);
    });
  });

  describe("JSX", () => {
    it("does not fire when label[htmlFor] matches input id", () => {
      const v = runRule(
        rule,
        `const Form = () => <form><label htmlFor="email">Email</label><input id="email" type="email" /></form>;`,
      );
      expect(v).toHaveLength(0);
    });

    it("fires when htmlFor has a typo vs input id", () => {
      const v = runRule(
        rule,
        `const Form = () => <form><label htmlFor="emai">Email</label><input id="email" type="email" /></form>;`,
      );
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("emai");
    });

    it("also accepts `for` (non-React JSX) and flags dangling references", () => {
      const v = runRule(
        rule,
        `const Form = () => <form><label for="ghost">Email</label><input id="email" type="email" /></form>;`,
      );
      expect(v).toHaveLength(1);
    });
  });

  it("cites wcag22:1.3.1, 3.3.2, 4.1.2 and their 2.1 equivalents", () => {
    expect(rule.satisfies).toContain("wcag22:1.3.1");
    expect(rule.satisfies).toContain("wcag21:1.3.1");
    expect(rule.satisfies).toContain("wcag22:3.3.2");
    expect(rule.satisfies).toContain("wcag21:3.3.2");
    expect(rule.satisfies).toContain("wcag22:4.1.2");
    expect(rule.satisfies).toContain("wcag21:4.1.2");
  });
});
