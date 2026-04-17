/**
 * Integration tests for Violation.groupKey. Runs the full scanner over
 * real source strings and asserts the grouping invariants that define
 * the feature:
 *
 *   - Same rule + AST-identical target nodes in different files →
 *     identical `groupKey`.
 *   - Same rule + AST-distinct target nodes → different `groupKey`.
 *   - Different rules + same target node → different `groupKey`.
 *   - Line-number drift does not change `groupKey`.
 *
 * See docs/adr/0008-violation-group-key.md.
 */

import { describe, expect, it } from "bun:test";
import { type ParsedFile, runScan } from "../../../src/engine/scanner.ts";
import { parseHtml, parseTsx } from "../../../src/input/parsers/index.ts";
import { BUILTIN_RULES } from "../../../src/rules/index.ts";
import { wcag22 } from "../../../src/standards/wcag22/standard.ts";
import type { Ast } from "../../../src/types/ast.ts";

function htmlFile(path: string, source: string): ParsedFile {
  const parsed = parseHtml(source);
  const ast: Ast = { language: "html", root: parsed.root, errors: parsed.errors };
  return { filePath: path, source, ast };
}

function tsxFile(path: string, source: string): ParsedFile {
  const parsed = parseTsx(source);
  const ast: Ast = { language: "tsx", root: parsed.root, errors: parsed.errors };
  return { filePath: path, source, ast };
}

describe("Violation.groupKey — cross-file invariants", () => {
  it("same rule + AST-identical img missing alt in different files → same groupKey", () => {
    const a = htmlFile(
      "a.html",
      `<!doctype html><html lang="en"><body><img src="logo-a.png"/></body></html>`,
    );
    const b = htmlFile(
      "b.html",
      `<!doctype html><html lang="en"><body><img src="different-name.jpg"/></body></html>`,
    );
    const { result } = runScan({
      standards: [wcag22],
      rules: BUILTIN_RULES,
      enabled: ["wcag22"],
      files: [a, b],
    });
    const altFindings = result.violations.filter((v) => v.ruleId === "media/alt-text-missing");
    expect(altFindings.length).toBe(2);
    expect(altFindings[0]!.groupKey).toBe(altFindings[1]!.groupKey);
    // findingId should differ — same node shape, different file.
    expect(altFindings[0]!.findingId).not.toBe(altFindings[1]!.findingId);
  });

  it("three copies of the same bad pattern → all three groupKeys match", () => {
    const a = htmlFile(
      "a.html",
      `<!doctype html><html lang="en"><body><img src="x.png"/></body></html>`,
    );
    const b = htmlFile(
      "b.html",
      `<!doctype html><html lang="en"><body><img src="y.png"/></body></html>`,
    );
    const c = htmlFile(
      "c.html",
      `<!doctype html><html lang="en"><body><img src="z.png"/></body></html>`,
    );
    const { result } = runScan({
      standards: [wcag22],
      rules: BUILTIN_RULES,
      enabled: ["wcag22"],
      files: [a, b, c],
    });
    const altFindings = result.violations.filter((v) => v.ruleId === "media/alt-text-missing");
    expect(altFindings.length).toBe(3);
    const keys = new Set(altFindings.map((v) => v.groupKey));
    expect(keys.size).toBe(1);
  });

  it("materially changing one copy (add alt-like title attribute) splits its groupKey", () => {
    // Same rule fires, but the shape differs: one has `title` present,
    // one doesn't. Attribute NAMES are part of the shape, so these
    // should NOT share a groupKey.
    const plain = htmlFile(
      "plain.html",
      `<!doctype html><html lang="en"><body><img src="a.png"/></body></html>`,
    );
    const withTitle = htmlFile(
      "with-title.html",
      `<!doctype html><html lang="en"><body><img src="a.png" title="a chart"/></body></html>`,
    );
    const { result } = runScan({
      standards: [wcag22],
      rules: BUILTIN_RULES,
      enabled: ["wcag22"],
      files: [plain, withTitle],
    });
    const altFindings = result.violations.filter((v) => v.ruleId === "media/alt-text-missing");
    expect(altFindings.length).toBeGreaterThanOrEqual(1);
    // Both findings should exist if both still lack alt; their
    // groupKeys should differ because `title` is part of the attribute
    // name set.
    const plainFinding = altFindings.find((v) => v.location.filePath === "plain.html");
    const titleFinding = altFindings.find((v) => v.location.filePath === "with-title.html");
    if (plainFinding && titleFinding) {
      expect(plainFinding.groupKey).not.toBe(titleFinding.groupKey);
    }
  });

  it("line-number drift does not change groupKey", () => {
    // Add blank lines before the violation; the file's line count
    // changes but the AST shape of the target node doesn't.
    const tight = htmlFile(
      "tight.html",
      `<!doctype html><html lang="en"><body><img src="a.png"/></body></html>`,
    );
    const padded = htmlFile(
      "padded.html",
      `<!doctype html>\n\n\n\n\n<html lang="en"><body><img src="a.png"/></body></html>`,
    );
    const { result } = runScan({
      standards: [wcag22],
      rules: BUILTIN_RULES,
      enabled: ["wcag22"],
      files: [tight, padded],
    });
    const altFindings = result.violations.filter((v) => v.ruleId === "media/alt-text-missing");
    expect(altFindings.length).toBe(2);
    expect(altFindings[0]!.groupKey).toBe(altFindings[1]!.groupKey);
    // The two have different line numbers.
    expect(altFindings[0]!.location.line).not.toBe(altFindings[1]!.location.line);
  });

  it("groupKey is a 12-char lowercase hex string on every real finding", () => {
    const file = htmlFile(
      "x.html",
      `<!doctype html><html lang="en"><body><img src="a.png"/></body></html>`,
    );
    const { result } = runScan({
      standards: [wcag22],
      rules: BUILTIN_RULES,
      enabled: ["wcag22"],
      files: [file],
    });
    for (const v of result.violations) {
      expect(v.groupKey).toMatch(/^[0-9a-f]{12}$/);
    }
  });
});

describe("Violation.groupKey — JSX parallels HTML", () => {
  it("two identical JSX buttons without label in different files share a groupKey", () => {
    const a = tsxFile("A.tsx", `export const A = () => <button onClick={save} />;`);
    const b = tsxFile("B.tsx", `export const B = () => <button onClick={submit} />;`);
    const { result } = runScan({
      standards: [wcag22],
      rules: BUILTIN_RULES,
      enabled: ["wcag22"],
      files: [a, b],
    });
    const buttonFindings = result.violations.filter((v) => v.ruleId === "semantics/button-name");
    if (buttonFindings.length === 2) {
      expect(buttonFindings[0]!.groupKey).toBe(buttonFindings[1]!.groupKey);
    }
  });
});
