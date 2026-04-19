/**
 * `couldBeWrongBecause` opt-in tests for the contrast rules.
 *
 * Covers the cross-file Tailwind cross-reference surface added per
 * docs/adr/0009-violation-could-be-wrong-because.md: when a CSS
 * contrast failure targets a class and a JSX or HTML consumer carries
 * the same class AND a `text-*` / `bg-*` Tailwind utility on the same
 * element, the finding gets `couldBeWrongBecause:
 * ["tailwind_class_on_consumer"]`. Deterministic class-token link,
 * never heuristic suppression.
 *
 * Shape hygiene (CLAUDE.md §1): the field is present-when-meaningful.
 * A finding without a Tailwind override omits the field entirely — no
 * `couldBeWrongBecause: []` sentinel.
 */

import { describe, expect, it } from "bun:test";
import { type ParsedFile, runScan } from "../../../../src/engine/scanner.ts";
import { parseCss, parseHtml, parseTsx } from "../../../../src/input/parsers/index.ts";
import { rule as contrastEnhanced } from "../../../../src/rules/contrast/enhanced.ts";
import { rule as contrastMinimum } from "../../../../src/rules/contrast/minimum.ts";
import { rule as contrastNonText } from "../../../../src/rules/contrast/non-text.ts";
import { wcag22 } from "../../../../src/standards/wcag22/standard.ts";
import type { Rule } from "../../../../src/types/rule.ts";
import type { Violation } from "../../../../src/types/violation.ts";

function cssFile(filePath: string, source: string): ParsedFile {
  const r = parseCss(source);
  return { filePath, source, ast: { language: "css", root: r.root, errors: r.errors } };
}

function tsxFile(filePath: string, source: string): ParsedFile {
  const r = parseTsx(source);
  return { filePath, source, ast: { language: "tsx", root: r.root, errors: r.errors } };
}

function htmlFile(filePath: string, source: string): ParsedFile {
  const r = parseHtml(source);
  return { filePath, source, ast: { language: "html", root: r.root, errors: r.errors } };
}

function scanWithRule(rule: Rule, files: readonly ParsedFile[]): readonly Violation[] {
  const { result } = runScan({
    standards: [wcag22],
    rules: [rule],
    enabled: ["wcag22"],
    files,
  });
  return result.violations.filter((v) => v.ruleId === rule.id);
}

describe("contrast/minimum couldBeWrongBecause", () => {
  it("tags finding with tailwind_class_on_consumer when a JSX element uses the class plus a text-* utility", () => {
    const css = cssFile("src/styles.css", `.caption { color: #aaa; background: #fff; }`);
    const tsx = tsxFile(
      "src/Card.tsx",
      `export function Card() { return <span className="caption text-slate-900">hi</span>; }`,
    );
    const violations = scanWithRule(contrastMinimum, [css, tsx]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.couldBeWrongBecause).toEqual(["tailwind_class_on_consumer"]);
  });

  it("tags finding when the consumer uses a bg-* utility on the same element", () => {
    const css = cssFile("src/styles.css", `.banner { color: #999; background: #eee; }`);
    const tsx = tsxFile(
      "src/Banner.tsx",
      `export function Banner() { return <div className="banner bg-blue-500">hi</div>; }`,
    );
    const violations = scanWithRule(contrastMinimum, [css, tsx]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.couldBeWrongBecause).toEqual(["tailwind_class_on_consumer"]);
  });

  it("tags finding when the consumer is HTML with a class plus a bg-* utility", () => {
    const css = cssFile("src/styles.css", `.tip { color: #bbb; background: #fff; }`);
    const html = htmlFile(
      "src/index.html",
      `<!doctype html><html><body><p class="tip bg-white">hi</p></body></html>`,
    );
    const violations = scanWithRule(contrastMinimum, [css, html]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.couldBeWrongBecause).toEqual(["tailwind_class_on_consumer"]);
  });

  it("omits the field when the consumer has the class but no text-*/bg-* utility", () => {
    const css = cssFile("src/styles.css", `.caption { color: #aaa; background: #fff; }`);
    const tsx = tsxFile(
      "src/Card.tsx",
      `export function Card() { return <span className="caption p-2">hi</span>; }`,
    );
    const violations = scanWithRule(contrastMinimum, [css, tsx]);
    expect(violations).toHaveLength(1);
    expect("couldBeWrongBecause" in violations[0]!).toBe(false);
  });

  it("omits the field when no consumer uses the class", () => {
    const css = cssFile("src/styles.css", `.ghost { color: #aaa; background: #fff; }`);
    const tsx = tsxFile(
      "src/Card.tsx",
      `export function Card() { return <span className="other text-slate-900">hi</span>; }`,
    );
    const violations = scanWithRule(contrastMinimum, [css, tsx]);
    expect(violations).toHaveLength(1);
    expect("couldBeWrongBecause" in violations[0]!).toBe(false);
  });

  it("omits the field when the selector is bare-element (no class to cross-reference)", () => {
    const css = cssFile("src/styles.css", `p { color: #aaa; background: #fff; }`);
    const tsx = tsxFile(
      "src/Card.tsx",
      `export function Card() { return <p className="bg-blue-500">hi</p>; }`,
    );
    const violations = scanWithRule(contrastMinimum, [css, tsx]);
    expect(violations).toHaveLength(1);
    expect("couldBeWrongBecause" in violations[0]!).toBe(false);
  });

  it("omits the field when the override utility is under a variant only (no unqualified qualifier)", () => {
    // `md:text-slate-900` alone doesn't qualify — the utility is
    // variant-scoped and can't override at all viewport widths. A
    // plain `text-*` is required to tag.
    const css = cssFile("src/styles.css", `.caption { color: #aaa; background: #fff; }`);
    const tsx = tsxFile(
      "src/Card.tsx",
      `export function Card() { return <span className="caption md:text-slate-900">hi</span>; }`,
    );
    const violations = scanWithRule(contrastMinimum, [css, tsx]);
    expect(violations).toHaveLength(1);
    expect("couldBeWrongBecause" in violations[0]!).toBe(false);
  });

  it("tags only the matching finding when one class has a tailwind override and another does not", () => {
    const css = cssFile(
      "src/styles.css",
      `.one { color: #aaa; background: #fff; }
       .two { color: #aaa; background: #fff; }`,
    );
    const tsx = tsxFile(
      "src/App.tsx",
      `export function App() {
         return (
           <div>
             <span className="one text-slate-900">a</span>
             <span className="two">b</span>
           </div>
         );
       }`,
    );
    const violations = scanWithRule(contrastMinimum, [css, tsx]);
    expect(violations).toHaveLength(2);
    const byClass = new Map(violations.map((v) => [v.message, v]));
    const one = [...byClass.values()].find((v) => v.message.includes(".one"));
    const two = [...byClass.values()].find((v) => v.message.includes(".two"));
    expect(one?.couldBeWrongBecause).toEqual(["tailwind_class_on_consumer"]);
    expect("couldBeWrongBecause" in (two ?? {})).toBe(false);
  });
});

describe("contrast/enhanced couldBeWrongBecause", () => {
  it("tags finding with tailwind_class_on_consumer when a JSX element uses the class plus a text-* utility", () => {
    // #6a6a6a on #fff is ~5.4:1 — passes AA (4.5:1) but fails AAA (7:1).
    const css = cssFile("src/styles.css", `.caption { color: #6a6a6a; background: #fff; }`);
    const tsx = tsxFile(
      "src/Card.tsx",
      `export function Card() { return <span className="caption text-slate-900">hi</span>; }`,
    );
    const violations = scanWithRule(contrastEnhanced, [css, tsx]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.couldBeWrongBecause).toEqual(["tailwind_class_on_consumer"]);
  });

  it("omits the field when no consumer carries the class", () => {
    const css = cssFile("src/styles.css", `.ghost { color: #6a6a6a; background: #fff; }`);
    const violations = scanWithRule(contrastEnhanced, [css]);
    expect(violations).toHaveLength(1);
    expect("couldBeWrongBecause" in violations[0]!).toBe(false);
  });
});

describe("contrast/non-text couldBeWrongBecause", () => {
  // The boundary-override family set is `{border, outline, ring}`.
  // `text-*` / `bg-*` do NOT qualify here — they override the
  // text-vs-background axis that `contrast/minimum` checks, not the
  // border/outline/ring axis this rule evaluates. `divide-*` also
  // does not qualify (applies to children of a container, not the
  // element itself).
  //
  // The rule's selector classifier requires the CSS selector to
  // identify an interactive element or role (`button`, `input`,
  // `[role="button"]`, `svg`, …) before it fires. The tests below
  // use selectors like `button.btn` / `input.email` / `svg.icon` so
  // both the rule classifies the selector as interactive AND the
  // class token is available for cross-reference against the
  // consumer's Tailwind utilities.

  it("tags finding when a JSX element uses the class plus a bare `border` utility", () => {
    const css = cssFile(
      "src/ui.css",
      `button.primary { background: #ffffff; border: 1px solid #d0d0d0; }`,
    );
    const tsx = tsxFile(
      "src/Btn.tsx",
      `export function Btn() { return <button className="primary border">go</button>; }`,
    );
    const violations = scanWithRule(contrastNonText, [css, tsx]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.couldBeWrongBecause).toEqual(["tailwind_class_on_consumer"]);
  });

  it("tags finding when a JSX element uses the class plus a `border-{color}` utility", () => {
    const css = cssFile(
      "src/ui.css",
      `input.email { background: #ffffff; border-color: #e0e0e0; }`,
    );
    const tsx = tsxFile(
      "src/Email.tsx",
      `export function Email() { return <input className="email border-slate-900" />; }`,
    );
    const violations = scanWithRule(contrastNonText, [css, tsx]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.couldBeWrongBecause).toEqual(["tailwind_class_on_consumer"]);
  });

  it("tags finding when a JSX element uses the class plus an `outline-*` utility", () => {
    const css = cssFile(
      "src/ui.css",
      `button.chip { background: #ffffff; outline: 2px solid #e8e8e8; }`,
    );
    const tsx = tsxFile(
      "src/Chip.tsx",
      `export function Chip() { return <button className="chip outline-red-500">go</button>; }`,
    );
    const violations = scanWithRule(contrastNonText, [css, tsx]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.couldBeWrongBecause).toEqual(["tailwind_class_on_consumer"]);
  });

  it("tags finding when a JSX element uses the class plus a `ring-*` utility", () => {
    const css = cssFile("src/ui.css", `svg.icon { background: #ffffff; stroke: #d8d8d8; }`);
    const tsx = tsxFile(
      "src/Icon.tsx",
      `export function Icon() { return <svg className="icon ring-2" />; }`,
    );
    const violations = scanWithRule(contrastNonText, [css, tsx]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.couldBeWrongBecause).toEqual(["tailwind_class_on_consumer"]);
  });

  it("tags finding when the consumer uses an arbitrary-value `border-[3px]` utility", () => {
    const css = cssFile(
      "src/ui.css",
      `button.primary { background: #ffffff; border: 1px solid #dcdcdc; }`,
    );
    const tsx = tsxFile(
      "src/Btn.tsx",
      `export function Btn() { return <button className="primary border-[3px]">go</button>; }`,
    );
    const violations = scanWithRule(contrastNonText, [css, tsx]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.couldBeWrongBecause).toEqual(["tailwind_class_on_consumer"]);
  });

  it("tags finding when the consumer is HTML with a class plus a boundary utility", () => {
    const css = cssFile(
      "src/ui.css",
      `button.primary { background: #ffffff; border-color: #e4e4e4; }`,
    );
    const html = htmlFile(
      "src/index.html",
      `<!doctype html><html><body><button class="primary border-2">go</button></body></html>`,
    );
    const violations = scanWithRule(contrastNonText, [css, html]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.couldBeWrongBecause).toEqual(["tailwind_class_on_consumer"]);
  });

  it("omits the field when the consumer carries only text-*/bg-* (wrong axis)", () => {
    // `text-*` / `bg-*` override color/background — NOT the border.
    // The non-text rule evaluated the border-vs-background pair, so
    // the text/bg utility is not a credible escape hatch here.
    const css = cssFile(
      "src/ui.css",
      `button.primary { background: #ffffff; border: 1px solid #d0d0d0; }`,
    );
    const tsx = tsxFile(
      "src/Btn.tsx",
      `export function Btn() { return <button className="primary text-slate-900 bg-blue-500">go</button>; }`,
    );
    const violations = scanWithRule(contrastNonText, [css, tsx]);
    expect(violations).toHaveLength(1);
    expect("couldBeWrongBecause" in violations[0]!).toBe(false);
  });

  it("omits the field when the consumer has the class but no tailwind class at all", () => {
    const css = cssFile(
      "src/ui.css",
      `button.primary { background: #ffffff; border: 1px solid #d0d0d0; }`,
    );
    const tsx = tsxFile(
      "src/Btn.tsx",
      `export function Btn() { return <button className="primary">go</button>; }`,
    );
    const violations = scanWithRule(contrastNonText, [css, tsx]);
    expect(violations).toHaveLength(1);
    expect("couldBeWrongBecause" in violations[0]!).toBe(false);
  });

  it("omits the field when the consumer className is empty", () => {
    const css = cssFile(
      "src/ui.css",
      `button.primary { background: #ffffff; border: 1px solid #d0d0d0; }`,
    );
    const tsx = tsxFile(
      "src/Btn.tsx",
      `export function Btn() { return <button className="">go</button>; }`,
    );
    const violations = scanWithRule(contrastNonText, [css, tsx]);
    expect(violations).toHaveLength(1);
    expect("couldBeWrongBecause" in violations[0]!).toBe(false);
  });

  it("omits the field when the boundary utility is variant-scoped only", () => {
    // `hover:border-*` is conditional — it doesn't override the
    // declared border at rest. Only unqualified utilities qualify.
    const css = cssFile(
      "src/ui.css",
      `button.primary { background: #ffffff; border: 1px solid #d0d0d0; }`,
    );
    const tsx = tsxFile(
      "src/Btn.tsx",
      `export function Btn() { return <button className="primary hover:border-slate-900">go</button>; }`,
    );
    const violations = scanWithRule(contrastNonText, [css, tsx]);
    expect(violations).toHaveLength(1);
    expect("couldBeWrongBecause" in violations[0]!).toBe(false);
  });

  it("omits the field when a `divide-*` utility (wrong-element axis) is the only qualifier", () => {
    // `divide-*` applies between children of the element, not on
    // the element itself. It does NOT override the boundary this
    // rule evaluated. Intentionally excluded from the family set.
    const css = cssFile(
      "src/ui.css",
      `button.primary { background: #ffffff; border: 1px solid #d0d0d0; }`,
    );
    const tsx = tsxFile(
      "src/Btn.tsx",
      `export function Btn() { return <button className="primary divide-y divide-gray-500">go</button>; }`,
    );
    const violations = scanWithRule(contrastNonText, [css, tsx]);
    expect(violations).toHaveLength(1);
    expect("couldBeWrongBecause" in violations[0]!).toBe(false);
  });

  it("omits the field when the selector is bare-element (no class to cross-reference)", () => {
    const css = cssFile("src/ui.css", `button { background: #ffffff; border: 1px solid #d0d0d0; }`);
    const tsx = tsxFile(
      "src/Btn.tsx",
      `export function Btn() { return <button className="border">go</button>; }`,
    );
    const violations = scanWithRule(contrastNonText, [css, tsx]);
    expect(violations).toHaveLength(1);
    expect("couldBeWrongBecause" in violations[0]!).toBe(false);
  });

  it("tags only the matching finding when one class has a boundary override and another does not", () => {
    const css = cssFile(
      "src/ui.css",
      `button.one { background: #ffffff; border: 1px solid #d0d0d0; }
       button.two { background: #ffffff; border: 1px solid #d0d0d0; }`,
    );
    const tsx = tsxFile(
      "src/App.tsx",
      `export function App() {
         return (
           <div>
             <button className="one border-2">a</button>
             <button className="two">b</button>
           </div>
         );
       }`,
    );
    const violations = scanWithRule(contrastNonText, [css, tsx]);
    expect(violations.length).toBeGreaterThanOrEqual(2);
    const one = violations.find((v) => v.message.includes(".one"));
    const two = violations.find((v) => v.message.includes(".two"));
    expect(one?.couldBeWrongBecause).toEqual(["tailwind_class_on_consumer"]);
    expect("couldBeWrongBecause" in (two ?? {})).toBe(false);
  });
});
