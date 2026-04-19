import { describe, expect, it } from "bun:test";
import { type ParsedFile, runScan } from "../../../../src/engine/scanner.ts";
import { parseTsx } from "../../../../src/input/parsers/index.ts";
import { rule } from "../../../../src/rules/wrapper/drift.ts";
import { wcag22 } from "../../../../src/standards/wcag22/standard.ts";
import type { Violation } from "../../../../src/types/violation.ts";

function tsxFile(filePath: string, source: string): ParsedFile {
  const r = parseTsx(source);
  return { filePath, source, ast: { language: "tsx", root: r.root, errors: r.errors } };
}

function scan(
  files: readonly ParsedFile[],
  nativeWrapperElements: Readonly<Record<string, string>>,
): readonly Violation[] {
  const { result } = runScan({
    standards: [wcag22],
    rules: [rule],
    enabled: ["wcag22"],
    files,
    nativeWrapperElements,
  });
  return result.violations.filter((v) => v.ruleId === rule.id);
}

describe("rule wrapper/drift", () => {
  describe("fires when", () => {
    it("declared <button> wrapper renders <div>", () => {
      const v = scan(
        [
          tsxFile(
            "src/components/Button.tsx",
            `export function Button(props) { return <div role="button" {...props} />; }`,
          ),
        ],
        { Button: "button" },
      );
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("<Button>");
      expect(v[0]?.message).toContain("<button>");
      expect(v[0]?.message).toContain("<div>");
      expect(v[0]?.location.filePath).toBe("src/components/Button.tsx");
    });

    it("declared <a> wrapper renders <span>", () => {
      const v = scan(
        [
          tsxFile(
            "src/widgets/Link.tsx",
            `export function Link(props) { return <span {...props} />; }`,
          ),
        ],
        { Link: "a" },
      );
      expect(v).toHaveLength(1);
      expect(v[0]?.location.filePath).toBe("src/widgets/Link.tsx");
    });

    it("declared <input> wrapper renders <textarea>", () => {
      const v = scan(
        [
          tsxFile(
            "src/forms/TextInput.tsx",
            `export function TextInput(props) { return <textarea {...props} />; }`,
          ),
        ],
        { TextInput: "input" },
      );
      expect(v).toHaveLength(1);
      expect(v[0]?.message).toContain("<textarea>");
    });

    it("points the suggestion at both the definition file and the config entry", () => {
      const v = scan(
        [
          tsxFile(
            "src/ui/Button.tsx",
            `export function Button(props) { return <div {...props} />; }`,
          ),
        ],
        { Button: "button" },
      );
      expect(v).toHaveLength(1);
      expect(v[0]?.suggestion).toContain("src/ui/Button.tsx");
      expect(v[0]?.suggestion).toContain("ra11y.config.ts");
      expect(v[0]?.suggestion).toContain("Button");
    });

    it("fires per drifted declaration in a mixed-status project", () => {
      const v = scan(
        [
          tsxFile("a/Button.tsx", `export function Button() { return <button />; }`),
          tsxFile("a/Link.tsx", `export function Link() { return <div />; }`),
          tsxFile("a/TextInput.tsx", `export function TextInput() { return <span />; }`),
        ],
        { Button: "button", Link: "a", TextInput: "input" },
      );
      expect(v).toHaveLength(2);
      const files = v.map((x) => x.location.filePath).sort();
      expect(files).toEqual(["a/Link.tsx", "a/TextInput.tsx"]);
    });
  });

  describe("does NOT fire when", () => {
    it("the wrapper's root matches the declared element", () => {
      const v = scan(
        [
          tsxFile(
            "src/components/Button.tsx",
            `export function Button(props) { return <button {...props} />; }`,
          ),
        ],
        { Button: "button" },
      );
      expect(v).toHaveLength(0);
    });

    it("the declared element matches case-insensitively (BUTTON vs button)", () => {
      const v = scan(
        [
          tsxFile(
            "src/components/Button.tsx",
            `export function Button(props) { return <button {...props} />; }`,
          ),
        ],
        { Button: "BUTTON" },
      );
      expect(v).toHaveLength(0);
    });

    it("nativeWrapperElements is empty", () => {
      const v = scan(
        [
          tsxFile(
            "src/components/Button.tsx",
            `export function Button(props) { return <div {...props} />; }`,
          ),
        ],
        {},
      );
      expect(v).toHaveLength(0);
    });

    it("multiple good wrappers with matching roots", () => {
      const v = scan(
        [
          tsxFile("a/Button.tsx", `export function Button() { return <button />; }`),
          tsxFile("a/Link.tsx", `export function Link() { return <a href="#" />; }`),
          tsxFile("a/TextInput.tsx", `export function TextInput() { return <input />; }`),
        ],
        { Button: "button", Link: "a", TextInput: "input" },
      );
      expect(v).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    // Silent-skip policy: missing definition = no evidence either way.
    // Emitting would guess; staying quiet preserves honesty.
    it("silently skips declarations whose definition file is not in the scan set", () => {
      const v = scan([tsxFile("src/Other.tsx", `export function Other() { return <div />; }`)], {
        Button: "button",
      });
      expect(v).toHaveLength(0);
    });

    it("silently skips declarations whose defining file has no JSX at all", () => {
      const v = scan([tsxFile("src/Button.tsx", `export const Button = () => null;`)], {
        Button: "button",
      });
      expect(v).toHaveLength(0);
    });

    // Glob-pattern wrappers don't land on nativeWrapperElements by
    // construction, so the rule never sees them. Smoke-test: wrappers
    // that happen to look glob-like as plain keys DO produce drift
    // signals against their literal basename (we don't short-circuit
    // on `*` in keys because by the time we're here the config loader
    // has already normalised).
    it("does not error when the declaration map is empty but files exist", () => {
      const v = scan(
        [tsxFile("src/Button.tsx", `export function Button() { return <div />; }`)],
        {},
      );
      expect(v).toHaveLength(0);
    });

    it("emits at the first JSX element's line, not line 1, when JSX is below imports", () => {
      const src = [
        `import type { HTMLAttributes } from "react";`,
        ``,
        `export function Button(props: HTMLAttributes<HTMLDivElement>) {`,
        `  return <div role="button" {...props} />;`,
        `}`,
      ].join("\n");
      const v = scan([tsxFile("src/Button.tsx", src)], { Button: "button" });
      expect(v).toHaveLength(1);
      expect(v[0]?.location.line).toBeGreaterThan(1);
    });
  });

  it("cites wcag22:4.1.2 and wcag21:4.1.2", () => {
    expect(rule.satisfies).toContain("wcag22:4.1.2");
    expect(rule.satisfies).toContain("wcag21:4.1.2");
  });

  it("has fixClass: guidance (agent must read the source to pick the right fix)", () => {
    expect(rule.fixClass).toBe("guidance");
  });
});
