import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/forms/labels-required.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule forms/labels-required", () => {
  describe("HTML: fires when", () => {
    it("bare <input> has no label", () => {
      const v = runRule(rule, `<form><input type="text"></form>`, { filePath: "index.html" });
      expect(v).toHaveLength(1);
      expect(v[0]?.severity).toBe("error");
      expect(v[0]?.message).toContain("accessible name");
    });

    it("<select> has no label", () => {
      const v = runRule(rule, `<form><select><option>A</option></select></form>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(1);
    });

    it("<textarea> has no label", () => {
      const v = runRule(rule, `<form><textarea></textarea></form>`, { filePath: "index.html" });
      expect(v).toHaveLength(1);
    });

    it("<input> id doesn't match any <label for=>", () => {
      const v = runRule(
        rule,
        `<form><label for="name">Name</label><input id="email" type="email"></form>`,
        { filePath: "index.html" },
      );
      expect(v).toHaveLength(1);
    });
  });

  describe("HTML: does NOT fire when", () => {
    it("input has aria-label", () => {
      const v = runRule(rule, `<input type="text" aria-label="Name">`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(0);
    });

    it("input is inside a <label>", () => {
      const v = runRule(rule, `<label>Name<input type="text"></label>`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(0);
    });

    it("input id matches a <label for>", () => {
      const v = runRule(rule, `<label for="name">Name</label><input id="name" type="text">`, {
        filePath: "index.html",
      });
      expect(v).toHaveLength(0);
    });

    it("input has aria-labelledby", () => {
      const v = runRule(
        rule,
        `<h2 id="section">Profile</h2><input type="text" aria-labelledby="section">`,
        { filePath: "index.html" },
      );
      expect(v).toHaveLength(0);
    });

    it("input type=hidden", () => {
      const v = runRule(rule, `<input type="hidden" name="csrf">`, { filePath: "index.html" });
      expect(v).toHaveLength(0);
    });

    it("input type=submit", () => {
      const v = runRule(rule, `<input type="submit" value="Save">`, { filePath: "index.html" });
      expect(v).toHaveLength(0);
    });
  });

  describe("JSX: fires when", () => {
    it("input has no label and no htmlFor association", () => {
      const v = runRule(rule, `const Form = () => <form><input type="email" /></form>;`);
      expect(v).toHaveLength(1);
    });
  });

  describe("JSX: does NOT fire when", () => {
    it("label[htmlFor] matches input id", () => {
      const v = runRule(
        rule,
        `const Form = () => <form><label htmlFor="e">Email</label><input id="e" type="email" /></form>;`,
      );
      expect(v).toHaveLength(0);
    });

    it("input wrapped in <label>", () => {
      const v = runRule(rule, `const Form = () => <label>Name<input type="text" /></label>;`);
      expect(v).toHaveLength(0);
    });

    it("input has aria-label prop", () => {
      const v = runRule(rule, `const X = <input type="text" aria-label="Name" />;`);
      expect(v).toHaveLength(0);
    });
  });

  it("cites wcag22:3.3.2 and wcag21:3.3.2", () => {
    expect(rule.satisfies).toContain("wcag22:3.3.2");
    expect(rule.satisfies).toContain("wcag21:3.3.2");
  });
});
