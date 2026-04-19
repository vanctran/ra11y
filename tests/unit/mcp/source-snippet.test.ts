/**
 * Unit tests for buildSnippet — the shared helper that produces the
 * `snippet` field on review_candidates / checklist responses from
 * the source text already held in ParsedFile cache.
 *
 * Invariants under test:
 *   - normal case returns ±3 lines around the target, de-indented
 *   - out-of-bounds / empty source / bad inputs return undefined
 *     (NOT empty string — see CLAUDE.md §1 "Ambiguous field shapes")
 *   - 300-char cap is hard; snippet never exceeds it
 *   - common indent is stripped across all included lines
 */

import { describe, expect, it } from "bun:test";
import {
  buildSnippet,
  buildSnippetForReason,
  findEnclosingBlock,
  sourceIndex,
} from "../../../src/mcp/source-snippet.ts";

const CAP = 300;

describe("buildSnippet: normal path", () => {
  it("returns ±3 lines around the target line", () => {
    const source = [
      "line 1",
      "line 2",
      "line 3",
      "line 4",
      "line 5",
      "line 6",
      "line 7",
      "line 8",
      "line 9",
    ].join("\n");
    const snippet = buildSnippet(source, 5);
    expect(snippet).toBe(
      ["line 2", "line 3", "line 4", "line 5", "line 6", "line 7", "line 8"].join("\n"),
    );
  });

  it("clamps to file start when target line is near the top", () => {
    const source = ["a", "b", "c", "d", "e"].join("\n");
    const snippet = buildSnippet(source, 1);
    expect(snippet).toBe(["a", "b", "c", "d"].join("\n"));
  });

  it("clamps to file end when target line is near the bottom", () => {
    const source = ["a", "b", "c", "d", "e"].join("\n");
    const snippet = buildSnippet(source, 5);
    expect(snippet).toBe(["b", "c", "d", "e"].join("\n"));
  });
});

describe("buildSnippet: de-indent", () => {
  it("strips common leading whitespace across all non-blank lines", () => {
    const source = [
      "    function Foo() {",
      "      return (",
      '        <img src="x" />',
      "      );",
      "    }",
    ].join("\n");
    // Target line 3 — ±3 is lines 1..5 here.
    const snippet = buildSnippet(source, 3);
    // Common leading whitespace across the included lines is 4 spaces.
    expect(snippet).toBe(
      ["function Foo() {", "  return (", '    <img src="x" />', "  );", "}"].join("\n"),
    );
  });

  it("treats blank lines as not contributing to the indent floor", () => {
    const source = ["  a", "", "  b", "  c"].join("\n");
    const snippet = buildSnippet(source, 2);
    // Blank lines don't collapse the strip — the 2-space common indent
    // still gets removed.
    expect(snippet).toBe(["a", "", "b", "c"].join("\n"));
  });
});

describe("buildSnippet: 300-char cap", () => {
  it("never exceeds the cap even when the window is long", () => {
    // Make every line 80 chars — 7-line window would be ~ 560 chars.
    const wideLine = "x".repeat(80);
    const source = Array.from({ length: 20 }, () => wideLine).join("\n");
    const snippet = buildSnippet(source, 10);
    expect(snippet).toBeDefined();
    expect((snippet ?? "").length).toBeLessThanOrEqual(CAP);
  });

  it("keeps the anchor line when the window is shrunk", () => {
    const wideLine = "y".repeat(80);
    const anchorLine = '<anchor attr="value" />';
    const lines = [wideLine, wideLine, wideLine, anchorLine, wideLine, wideLine, wideLine];
    const source = lines.join("\n");
    const snippet = buildSnippet(source, 4);
    expect(snippet).toBeDefined();
    expect(snippet).toContain(anchorLine);
    expect((snippet ?? "").length).toBeLessThanOrEqual(CAP);
  });

  it("truncates a single line that alone exceeds the cap", () => {
    const huge = "z".repeat(500);
    const source = `${huge}\n${huge}\n${huge}`;
    const snippet = buildSnippet(source, 2);
    expect(snippet).toBeDefined();
    expect((snippet ?? "").length).toBeLessThanOrEqual(CAP);
    expect((snippet ?? "").endsWith("…")).toBe(true);
  });
});

describe("buildSnippet: dishonest shapes forbidden", () => {
  it("returns undefined (not empty string) for an empty source", () => {
    expect(buildSnippet("", 1)).toBeUndefined();
  });

  it("returns undefined for an out-of-bounds line", () => {
    const source = ["a", "b", "c"].join("\n");
    expect(buildSnippet(source, 99)).toBeUndefined();
  });

  it("returns undefined for a non-positive line number", () => {
    const source = "a\nb\nc";
    expect(buildSnippet(source, 0)).toBeUndefined();
    expect(buildSnippet(source, -3)).toBeUndefined();
  });

  it("returns undefined for non-integer line numbers", () => {
    const source = "a\nb\nc";
    expect(buildSnippet(source, 1.5)).toBeUndefined();
  });
});

describe("findEnclosingBlock: TSX/JSX/TS/JS brace-balance walker", () => {
  it("finds the function body enclosing the target line", () => {
    const source = [
      "function outer() {", // line 1
      "  const x = 1;", // line 2
      "  const y = 2;", // line 3
      "  return x + y;", // line 4
      "}", // line 5
    ].join("\n");
    const block = findEnclosingBlock(source, 3);
    expect(block).toEqual({ startLine: 1, endLine: 5 });
  });

  it("picks the innermost enclosing block when nested", () => {
    const source = [
      "function outer() {", // 1
      "  if (cond) {", // 2
      "    doSomething();", // 3
      "  }", // 4
      "  other();", // 5
      "}", // 6
    ].join("\n");
    const block = findEnclosingBlock(source, 3);
    expect(block).toEqual({ startLine: 2, endLine: 4 });
  });

  it("ignores braces inside string literals", () => {
    const source = [
      "function f() {", // 1
      "  const a = '{';", // 2  — single-quote brace should NOT open a block
      '  const b = "}";', // 3  — nor double-quote
      "  return a + b;", // 4
      "}", // 5
    ].join("\n");
    const block = findEnclosingBlock(source, 3);
    expect(block).toEqual({ startLine: 1, endLine: 5 });
  });

  it("ignores braces inside line and block comments", () => {
    const source = [
      "function f() {", // 1
      "  // { fake open", // 2
      "  /* } fake close */", // 3
      "  return 1;", // 4
      "}", // 5
    ].join("\n");
    const block = findEnclosingBlock(source, 3);
    expect(block).toEqual({ startLine: 1, endLine: 5 });
  });

  it("counts braces in template-literal expressions", () => {
    // The `${...}` expression's own braces balance normally; the outer
    // function body should still be the enclosing block.
    const source = [
      "function f(x) {", // 1
      "  const s = `hello ${x + 1} world`;", // 2
      "  return s;", // 3
      "}", // 4
    ].join("\n");
    const block = findEnclosingBlock(source, 2);
    expect(block).toEqual({ startLine: 1, endLine: 4 });
  });

  it("returns undefined when the target is outside any enclosing block", () => {
    const source = ["const x = 1;", "const y = 2;", "const z = 3;"].join("\n");
    expect(findEnclosingBlock(source, 2)).toBeUndefined();
  });

  it("returns undefined for empty source or bad line numbers", () => {
    expect(findEnclosingBlock("", 1)).toBeUndefined();
    expect(findEnclosingBlock("function f() {}", 0)).toBeUndefined();
    expect(findEnclosingBlock("function f() {}", 999)).toBeUndefined();
  });
});

describe("buildSnippetForReason: TSX/JSX/TS/JS wide path uses brace-balance", () => {
  const crossReason = "handler defined outside this line";

  it("returns the enclosing function body when wider than 10 lines", () => {
    // A 15-line function body — fixed ±10 would overshoot or undershoot;
    // brace-balance returns the tight function bounds.
    const bodyLines = Array.from({ length: 13 }, (_, i) => `  doStep${i}();`);
    const source = ["function handleClick() {", ...bodyLines, "}"].join("\n");
    // Target = middle of the body (line 8, 1-based)
    const snippet = buildSnippetForReason({
      source,
      line: 8,
      reason: crossReason,
      language: "tsx",
    });
    expect(snippet).toBeDefined();
    // First line should be the opener, last should be the closer —
    // brace-balance honored the function body.
    expect(snippet?.startsWith("function handleClick() {")).toBe(true);
    expect(snippet?.endsWith("}")).toBe(true);
  });

  it("returns the tight enclosing block when narrower than 10 lines", () => {
    const source = [
      "const x = 1;", // 1  — padding above, would be included by ±10 window
      "const y = 2;", // 2
      "const z = 3;", // 3
      "function tiny() {", // 4
      "  return 42;", // 5  ← target
      "}", // 6
      "const after = 7;", // 7  — padding below
      "const after2 = 8;", // 8
    ].join("\n");
    const snippet = buildSnippetForReason({
      source,
      line: 5,
      reason: crossReason,
      language: "ts",
    });
    // Brace-balance returns lines 4-6 only; the padding lines do not appear.
    expect(snippet).toBe(["function tiny() {", "  return 42;", "}"].join("\n"));
  });

  it("ignores braces inside strings when choosing the enclosing block", () => {
    const source = [
      "function f() {", // 1
      "  const pattern = '{ not a real open';", // 2  ← target
      "  return pattern;", // 3
      "}", // 4
    ].join("\n");
    const snippet = buildSnippetForReason({
      source,
      line: 2,
      reason: crossReason,
      language: "jsx",
    });
    expect(snippet).toBeDefined();
    // Must include the real function open and close — the `{` inside the
    // string must not have been mistaken for an enclosing block.
    expect(snippet?.startsWith("function f() {")).toBe(true);
    expect(snippet?.endsWith("}")).toBe(true);
  });

  it("picks the innermost block when nested", () => {
    const source = [
      "function outer() {", // 1
      "  if (cond) {", // 2
      "    inner();", // 3  ← target
      "  }", // 4
      "  after();", // 5
      "}", // 6
    ].join("\n");
    const snippet = buildSnippetForReason({
      source,
      line: 3,
      reason: crossReason,
      language: "js",
    });
    // Innermost = `if (cond) { inner(); }`.
    expect(snippet).toBe(["if (cond) {", "  inner();", "}"].join("\n"));
  });

  it("falls back to the 10-line window when the enclosing block exceeds the 600-char cap", () => {
    // Build a function body whose text (with indentation) blows past 600
    // chars — the walker would find it but renderLineRange returns
    // undefined, so we fall back to the fixed ±10 window.
    const bigLine = `  const longVariableName = ${JSON.stringify("x".repeat(120))};`;
    const source = ["function huge() {", ...Array.from({ length: 20 }, () => bigLine), "}"].join(
      "\n",
    );
    const snippet = buildSnippetForReason({
      source,
      line: 12,
      reason: crossReason,
      language: "ts",
    });
    expect(snippet).toBeDefined();
    // 600-char cap is honored — the fallback is the ±10-line window, not
    // the full function body (which would exceed the cap).
    expect((snippet ?? "").length).toBeLessThanOrEqual(600);
    // The fallback is line-based — it will NOT contain the opener
    // because line 1 is well outside the ±10 window around line 12.
    expect(snippet?.includes("function huge() {")).toBe(false);
  });

  it("uses the ±3-line narrow default when the reason does not cite cross-line context", () => {
    // Opener outside ±3 around line 6 so we can confirm brace-balance
    // did NOT run on the narrow path.
    const source = [
      "function outer() {", // 1
      "  const pre1 = 0;", // 2
      "  const pre2 = 0;", // 3
      "  const a = 1;", // 4
      "  const b = 2;", // 5
      "  const c = 3;", // 6 ← target
      "  const d = 4;", // 7
      "  const e = 5;", // 8
      "  const post1 = 0;", // 9
      "  return 0;", // 10
      "}", // 11
    ].join("\n");
    const narrow = buildSnippetForReason({
      source,
      line: 6,
      reason: "img missing alt", // not in CROSS_LINE_REASON_PATTERNS
      language: "tsx",
    });
    expect(narrow).toBeDefined();
    expect(narrow?.includes("function outer() {")).toBe(false);
    expect(narrow?.includes("const c = 3;")).toBe(true);
  });

  it("HTML and CSS paths use the 10-line fallback (no brace-balance)", () => {
    const htmlSource = [
      "<!doctype html>", // 1
      "<html>", // 2
      "  <body>", // 3
      "    <div>", // 4
      "      <p>hi</p>", // 5 ← target
      "    </div>", // 6
      "  </body>", // 7
      "</html>", // 8
    ].join("\n");
    const snippet = buildSnippetForReason({
      source: htmlSource,
      line: 5,
      reason: "handler defined outside this line",
      language: "html",
    });
    expect(snippet).toBeDefined();
    // ±10 fallback — the whole file fits in the window.
    expect(snippet?.includes("<!doctype html>")).toBe(true);
    expect(snippet?.includes("</html>")).toBe(true);
  });
});

describe("sourceIndex", () => {
  it("maps ParsedFile.filePath to its source + language", () => {
    const files = [
      {
        filePath: "/a.tsx",
        source: "hello",
        // biome-ignore lint/suspicious/noExplicitAny: unit test sees only filePath/source/ast.language
        ast: { language: "tsx", root: {} as any, errors: [] },
      },
      {
        filePath: "/b.html",
        source: "world",
        // biome-ignore lint/suspicious/noExplicitAny: unit test sees only filePath/source/ast.language
        ast: { language: "html", root: {} as any, errors: [] },
      },
    ] as const;
    // biome-ignore lint/suspicious/noExplicitAny: sourceIndex accepts ParsedFile; test subset suffices
    const idx = sourceIndex(files as any);
    expect(idx.get("/a.tsx")?.source).toBe("hello");
    expect(idx.get("/a.tsx")?.language).toBe("tsx");
    expect(idx.get("/b.html")?.source).toBe("world");
    expect(idx.get("/b.html")?.language).toBe("html");
    expect(idx.get("/missing.tsx")).toBeUndefined();
  });
});
