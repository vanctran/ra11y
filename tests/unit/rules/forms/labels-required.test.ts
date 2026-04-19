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

  describe("JSX: primitive component (info, not error)", () => {
    it("unlabeled <input> with spread props emits info, not error", () => {
      const v = runRule(rule, `const Input = (props) => <input {...props} />;`);
      expect(v).toHaveLength(1);
      expect(v[0]?.severity).toBe("info");
      expect(v[0]?.message).toContain("spread");
    });

    it("unlabeled <input> without spread stays an error", () => {
      const v = runRule(rule, `const X = <input type="text" />;`);
      expect(v).toHaveLength(1);
      expect(v[0]?.severity).toBe("error");
    });
  });

  it("cites wcag22:3.3.2 and wcag21:3.3.2", () => {
    expect(rule.satisfies).toContain("wcag22:3.3.2");
    expect(rule.satisfies).toContain("wcag21:3.3.2");
  });

  describe("nativeWrapperElements mapping (Q2-WRAPMAP-RULES)", () => {
    it("opts in to the native `input` tag so mapped wrappers fire", () => {
      expect(rule.wrapperTreatsAsElement).toBe("input");
    });

    it("fires on a wrapper declared to render `<input>` via the mapping", () => {
      const v = runRule(rule, `const X = <TextField />;`, {
        nativeWrapperElements: { TextField: "input" },
      });
      expect(v.length).toBeGreaterThan(0);
      expect(v[0]?.ruleId).toBe("forms/labels-required");
    });

    it("silences when the mapped wrapper call site has aria-label", () => {
      const v = runRule(rule, `const X = <TextField aria-label="Email" />;`, {
        nativeWrapperElements: { TextField: "input" },
      });
      expect(v).toHaveLength(0);
    });

    it("silences when the mapped wrapper is wrapped in a JSX <label>", () => {
      const v = runRule(rule, `const X = <label>Email<TextField /></label>;`, {
        nativeWrapperElements: { TextField: "input" },
      });
      expect(v).toHaveLength(0);
    });

    it("does not fire on a wrapper mapped to a non-form tag", () => {
      const v = runRule(rule, `const X = <Row />;`, {
        nativeWrapperElements: { Row: "div" },
      });
      expect(v).toHaveLength(0);
    });

    it("does not fire on an unmapped PascalCase component", () => {
      const v = runRule(rule, `const X = <UnknownInput />;`);
      expect(v).toHaveLength(0);
    });
  });

  describe("polymorphic as/asChild resolution (Q2R2-POLYMORPHIC)", () => {
    it('fires on <Field as="input" /> with no label', () => {
      const v = runRule(rule, `const X = <Field as="input" />;`);
      expect(v.length).toBeGreaterThan(0);
      expect(v[0]?.ruleId).toBe("forms/labels-required");
    });

    it('does not fire when polymorphic `as="input"` call site has aria-label', () => {
      const v = runRule(rule, `const X = <Field as="input" aria-label="Email" />;`);
      expect(v).toHaveLength(0);
    });

    it('does not fire when polymorphic `as="input"` is wrapped in <label>', () => {
      const v = runRule(rule, `const X = <label>Email<Field as="input" /></label>;`);
      expect(v).toHaveLength(0);
    });

    it("does not re-dispatch when `as` is a non-literal expression (honest — agent reads)", () => {
      // `as={inputTag}` is dynamic — the rule stays off this call site
      // and the agent reading the code decides.
      const v = runRule(rule, `const X = <Field as={inputTag} />;`);
      expect(v).toHaveLength(0);
    });

    it('does not re-dispatch when `as="div"` resolves to a non-target tag', () => {
      const v = runRule(rule, `const X = <Field as="div" />;`);
      expect(v).toHaveLength(0);
    });

    it("does not re-dispatch when `as` is absent", () => {
      const v = runRule(rule, `const X = <Field />;`);
      expect(v).toHaveLength(0);
    });
  });
});
