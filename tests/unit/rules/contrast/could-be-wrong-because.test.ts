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
