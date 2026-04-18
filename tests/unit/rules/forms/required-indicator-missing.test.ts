import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/forms/required-indicator-missing.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule forms/required-indicator-missing", () => {
  describe("fires when", () => {
    it("component destructures required and forwards it to <input> with no marker or aria-required", () => {
      const v = runRule(
        rule,
        `function EmailField({ required, id }: { required: boolean; id: string }) {
           return (
             <label htmlFor={id}>
               Email
               <input id={id} type="email" required={required} />
             </label>
           );
         }`,
        { filePath: "email-field.tsx" },
      );
      expect(v).toHaveLength(1);
      expect(v[0]?.ruleId).toBe("forms/required-indicator-missing");
      expect(v[0]?.severity).toBe("error");
      expect(v[0]?.message).toContain("EmailField");
      expect(v[0]?.message).toContain("required");
      expect(v[0]?.message).toContain("<input>");
      expect(v[0]?.message).toContain("aria-required");
      expect(v[0]?.criteria).toContain("wcag22:3.3.2");
    });

    it("arrow-function component forwards required to <textarea>", () => {
      const v = runRule(
        rule,
        `const Notes = ({ required, value }: Props) => {
           return <textarea value={value} required={required} />;
         };`,
        { filePath: "notes.tsx" },
      );
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("Notes");
      expect(v[0]?.message).toContain("<textarea>");
    });

    it("component forwards required to <select> with no visible marker", () => {
      const v = runRule(
        rule,
        `function Country({ required, options }: Props) {
           return (
             <label>
               Country
               <select required={required}>
                 {options.map((o) => <option key={o}>{o}</option>)}
               </select>
             </label>
           );
         }`,
        { filePath: "country.tsx" },
      );
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("<select>");
    });

    it("component forwards required via spread props with no marker", () => {
      const v = runRule(
        rule,
        `function Field({ required, ...rest }: Props) {
           return (
             <label>
               Username
               <input type="text" {...rest} />
             </label>
           );
         }`,
        { filePath: "field.tsx" },
      );
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("spread");
    });

    it("suggestion mentions both aria-required and a visible indicator", () => {
      const v = runRule(
        rule,
        `function PhoneField({ required }: Props) {
           return <input type="tel" required={required} />;
         }`,
        { filePath: "phone.tsx" },
      );
      expect(v).toHaveLength(1);
      expect(v[0]?.suggestion).toContain("aria-required");
      expect(v[0]?.suggestion).toContain("aria-hidden");
    });

    it("forwarded shorthand required with no marker still fires", () => {
      const v = runRule(
        rule,
        `function NameField({ required }: Props) {
           return (
             <label>
               Name
               <input type="text" required />
             </label>
           );
         }`,
        { filePath: "name.tsx" },
      );
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("shorthand");
    });
  });

  describe("does NOT fire when", () => {
    it("component renders a visible <span>*</span> marker gated on required", () => {
      const v = runRule(
        rule,
        `function EmailField({ required, id }: Props) {
           return (
             <label htmlFor={id}>
               Email {required && <span aria-hidden="true">*</span>}
               <input id={id} type="email" required={required} />
             </label>
           );
         }`,
        { filePath: "email-field.tsx" },
      );
      expect(v).toHaveLength(0);
    });

    it("component sets aria-required on the native element", () => {
      const v = runRule(
        rule,
        `function EmailField({ required, id }: Props) {
           return (
             <label htmlFor={id}>
               Email
               <input id={id} type="email" required={required} aria-required={required} />
             </label>
           );
         }`,
        { filePath: "email-field.tsx" },
      );
      expect(v).toHaveLength(0);
    });

    it('component renders an <abbr title="required"> marker', () => {
      const v = runRule(
        rule,
        `function Field({ required, id }: Props) {
           return (
             <label htmlFor={id}>
               Phone <abbr title="required">*</abbr>
               <input id={id} type="tel" required={required} />
             </label>
           );
         }`,
        { filePath: "field.tsx" },
      );
      expect(v).toHaveLength(0);
    });

    it("component renders the literal word (required) as child text", () => {
      const v = runRule(
        rule,
        `function Field({ required, id }: Props) {
           return (
             <label htmlFor={id}>
               Phone <span>(required)</span>
               <input id={id} type="tel" required={required} />
             </label>
           );
         }`,
        { filePath: "field.tsx" },
      );
      expect(v).toHaveLength(0);
    });

    it("component accepts required but does NOT forward it to a native element", () => {
      const v = runRule(
        rule,
        `function Section({ required, children }: Props) {
           return <div data-required={required ? "yes" : "no"}>{children}</div>;
         }`,
        { filePath: "section.tsx" },
      );
      expect(v).toHaveLength(0);
    });

    it("component does not accept a `required` prop at all", () => {
      const v = runRule(
        rule,
        `function Field({ id }: Props) {
           return (
             <label htmlFor={id}>
               Email
               <input id={id} type="email" />
             </label>
           );
         }`,
        { filePath: "field.tsx" },
      );
      expect(v).toHaveLength(0);
    });

    it("bare native <input required /> at a call site is ignored (not a wrapper definition)", () => {
      const v = runRule(
        rule,
        `function Page() {
           return (
             <form>
               <label htmlFor="e">Email</label>
               <input id="e" type="email" required />
             </form>
           );
         }`,
        { filePath: "page.tsx" },
      );
      expect(v).toHaveLength(0);
    });

    it("component uses a ternary on `required` to render markup", () => {
      const v = runRule(
        rule,
        `function Field({ required, id }: Props) {
           return (
             <label htmlFor={id}>
               Phone {required ? <span>*</span> : null}
               <input id={id} type="tel" required={required} />
             </label>
           );
         }`,
        { filePath: "field.tsx" },
      );
      expect(v).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("spread-only forwarding with destructured `required` and a gated marker passes", () => {
      const v = runRule(
        rule,
        `function Field({ required, ...rest }: Props) {
           return (
             <label>
               Username {required && "*"}
               <input type="text" {...rest} />
             </label>
           );
         }`,
        { filePath: "field.tsx" },
      );
      expect(v).toHaveLength(0);
    });

    it("fires separately for each component definition in the same file", () => {
      const v = runRule(
        rule,
        `function Email({ required, id }: Props) {
           return <input id={id} type="email" required={required} />;
         }
         function Phone({ required, id }: Props) {
           return <input id={id} type="tel" required={required} />;
         }`,
        { filePath: "fields.tsx" },
      );
      expect(v).toHaveLength(2);
      const names = v.map((x) => x.message);
      expect(names.some((m) => m.includes("Email"))).toBe(true);
      expect(names.some((m) => m.includes("Phone"))).toBe(true);
    });

    it("non-Pascal function names (internal helpers) are not treated as components", () => {
      const v = runRule(
        rule,
        `function renderInput({ required, id }: Props) {
           return <input id={id} required={required} />;
         }`,
        { filePath: "helper.tsx" },
      );
      expect(v).toHaveLength(0);
    });
  });

  describe("rule metadata", () => {
    it("declares wcag22:3.3.2 and wcag21:3.3.2 in satisfies", () => {
      expect(rule.satisfies).toContain("wcag22:3.3.2");
      expect(rule.satisfies).toContain("wcag21:3.3.2");
    });

    it("has a normativeQuote citing WCAG", () => {
      expect(rule.docs.normativeQuote).toBeDefined();
      expect(rule.docs.normativeQuote.length).toBeGreaterThan(0);
      expect(rule.docs.references[0]).toContain("WCAG22");
    });

    it("only applies to TSX/JSX files", () => {
      expect(rule.appliesTo?.fileExtensions).toContain(".tsx");
      expect(rule.appliesTo?.fileExtensions).toContain(".jsx");
      expect(rule.appliesTo?.fileExtensions).not.toContain(".html");
    });
  });
});
