/**
 * Unit tests for buildAnalysisCoverage — the MCP-surface telemetry
 * that tells agents what static analysis couldn't reach. The hints
 * block is load-bearing: it's the single actionable "what to do next"
 * an agent uses to unblock a thin scan without reading docs.
 */

import { describe, expect, it } from "bun:test";
import type { ParsedFile } from "../../../src/engine/scanner.ts";
import { buildAnalysisCoverage } from "../../../src/mcp/analysis-coverage.ts";
import type { Rule } from "../../../src/types/rule.ts";

function tsxFile(path: string, tagNames: readonly string[]): ParsedFile {
  const source = tagNames.map((t) => `<${t} />`).join("\n");
  const jsxElements = tagNames.map((tagName) => ({
    kind: "JsxElement" as const,
    range: { start: 0, end: 0 },
    loc: {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 1, offset: 0 },
    },
    tagName,
    attributes: [],
    children: [],
    selfClosing: true,
    hasSpreadProps: false,
  }));
  return {
    filePath: path,
    source,
    ast: {
      language: "tsx",
      root: {
        kind: "TsxModule",
        range: { start: 0, end: source.length },
        loc: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 1, offset: source.length },
        },
        jsxElements,
      },
      errors: [],
    },
  };
}

function tsxFileWithClassName(path: string, className: string): ParsedFile {
  const source = `<div className="${className}" />`;
  return {
    filePath: path,
    source,
    ast: {
      language: "tsx",
      root: {
        kind: "TsxModule",
        range: { start: 0, end: source.length },
        loc: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 1, offset: source.length },
        },
        jsxElements: [
          {
            kind: "JsxElement",
            range: { start: 0, end: source.length },
            loc: {
              start: { line: 1, column: 1, offset: 0 },
              end: { line: 1, column: 1, offset: source.length },
            },
            tagName: "div",
            attributes: [
              {
                kind: "JsxAttribute",
                range: { start: 0, end: 0 },
                loc: {
                  start: { line: 1, column: 1, offset: 0 },
                  end: { line: 1, column: 1, offset: 0 },
                },
                name: "className",
                value: { kind: "StringLiteral", value: className },
              },
            ],
            children: [],
            selfClosing: true,
            hasSpreadProps: false,
          },
        ],
      },
      errors: [],
    },
  };
}

function cssFile(path: string): ParsedFile {
  return {
    filePath: path,
    source: ".foo { color: red; }",
    ast: {
      language: "css",
      root: {
        kind: "CssStylesheet",
        range: { start: 0, end: 0 },
        loc: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 1, offset: 0 },
        },
        rules: [],
      },
      errors: [],
    },
  };
}

function htmlFile(path: string, source: string): ParsedFile {
  return {
    filePath: path,
    source,
    ast: {
      language: "html",
      root: {
        kind: "HtmlDocument",
        range: { start: 0, end: 0 },
        loc: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 1, offset: 0 },
        },
        elements: [],
      },
      errors: [],
    },
  };
}

const NO_RULES: readonly Rule[] = [];

describe("buildAnalysisCoverage — hints", () => {
  describe("opaque custom components", () => {
    it("does not hint when the count is below threshold", () => {
      const files = [tsxFile("a.tsx", ["Foo", "Bar", "Baz"])];
      const { analysisCoverage } = buildAnalysisCoverage(files, [], NO_RULES, false);
      expect(analysisCoverage?.["opaqueCustomComponents"]).toBe(3);
      expect(analysisCoverage?.["hints"]).toBeUndefined();
    });

    it("hints with example names when opaque components are plentiful", () => {
      const tags = Array.from({ length: 10 }, (_, i) => `Comp${i}`);
      const files = [tsxFile("a.tsx", tags)];
      const { analysisCoverage } = buildAnalysisCoverage(files, [], NO_RULES, false);
      const hints = analysisCoverage?.["hints"] as string[] | undefined;
      expect(hints).toBeDefined();
      expect(hints?.[0]).toContain("nativeWrappers");
      expect(hints?.[0]).toContain("detect_native_wrappers");
      expect(hints?.[0]).toContain("Comp0");
    });

    it("excludes wrappers already registered from the opaque set", () => {
      const tags = Array.from({ length: 10 }, (_, i) => `Comp${i}`);
      const wrappers = tags.slice(0, 4); // register 4 — remaining 6 under threshold
      const files = [tsxFile("a.tsx", tags)];
      const { analysisCoverage } = buildAnalysisCoverage(files, wrappers, NO_RULES, false);
      expect(analysisCoverage?.["opaqueCustomComponents"]).toBe(6);
      expect(analysisCoverage?.["hints"]).toBeUndefined();
    });

    it("always surfaces the top-by-call-site list inline (no verboseMeta needed)", () => {
      // 3 call sites of Button, 2 of Card, 1 of Widget.
      const files = [tsxFile("a.tsx", ["Button", "Button", "Button", "Card", "Card", "Widget"])];
      const { analysisCoverage } = buildAnalysisCoverage(files, [], NO_RULES, false);
      const top = analysisCoverage?.["opaqueCustomComponentsTop"] as
        | { name: string; callSites: number }[]
        | undefined;
      expect(top).toEqual([
        { name: "Button", callSites: 3 },
        { name: "Card", callSites: 2 },
        { name: "Widget", callSites: 1 },
      ]);
    });

    it("caps the top list at 5 entries so the response stays compact", () => {
      // 10 unique components, one call site each.
      const tags = Array.from({ length: 10 }, (_, i) => `Comp${i}`);
      const files = [tsxFile("a.tsx", tags)];
      const { analysisCoverage } = buildAnalysisCoverage(files, [], NO_RULES, false);
      const top = analysisCoverage?.["opaqueCustomComponentsTop"] as { name: string }[] | undefined;
      expect(top?.length).toBe(5);
    });

    it("breaks ties alphabetically so output is deterministic across runs", () => {
      const files = [tsxFile("a.tsx", ["Zeta", "Alpha", "Mike"])];
      const { analysisCoverage } = buildAnalysisCoverage(files, [], NO_RULES, false);
      const top = analysisCoverage?.["opaqueCustomComponentsTop"] as { name: string }[] | undefined;
      expect(top?.map((e) => e.name)).toEqual(["Alpha", "Mike", "Zeta"]);
    });

    it("omits the top list when no opaque components were seen", () => {
      const files = [tsxFile("a.tsx", [])];
      const { analysisCoverage } = buildAnalysisCoverage(files, [], NO_RULES, false);
      expect(analysisCoverage?.["opaqueCustomComponentsTop"]).toBeUndefined();
    });
  });

  describe("thin CSS coverage", () => {
    it("does not hint when the project is small", () => {
      const files = [tsxFile("a.tsx", []), cssFile("a.css")];
      const { analysisCoverage } = buildAnalysisCoverage(files, [], NO_RULES, false);
      expect(analysisCoverage).toBeUndefined();
    });

    it("hints when CSS is absent from a React-sized codebase", () => {
      const files = Array.from({ length: 60 }, (_, i) => tsxFile(`c${i}.tsx`, []));
      const { analysisCoverage } = buildAnalysisCoverage(files, [], NO_RULES, false);
      const hints = (analysisCoverage?.["hints"] as string[] | undefined) ?? [];
      expect(hints.some((h) => h.includes("CSS"))).toBe(true);
      expect(hints.some((h) => h.includes("Tailwind") || h.includes("post-compile"))).toBe(true);
    });

    it("does not hint when CSS coverage is proportionate", () => {
      const jsx = Array.from({ length: 40 }, (_, i) => tsxFile(`c${i}.tsx`, []));
      const css = Array.from({ length: 10 }, (_, i) => cssFile(`c${i}.css`));
      const files = [...jsx, ...css];
      const { analysisCoverage } = buildAnalysisCoverage(files, [], NO_RULES, false);
      const hints = (analysisCoverage?.["hints"] as string[] | undefined) ?? [];
      expect(hints.some((h) => h.includes("CSS"))).toBe(false);
    });

    it("strengthens the hint with additionalPaths when Tailwind usage is detected", () => {
      // 60 Tailwind-looking JSX files + 0 CSS → thin-CSS hint fires
      // AND the Tailwind-specific strengthening kicks in.
      const files = Array.from({ length: 60 }, (_, i) =>
        tsxFileWithClassName(`c${i}.tsx`, "flex items-center bg-red-500 text-white"),
      );
      const { analysisCoverage } = buildAnalysisCoverage(files, [], NO_RULES, false);
      const hints = (analysisCoverage?.["hints"] as string[] | undefined) ?? [];
      const cssHint = hints.find((h) => h.includes("CSS file(s)"));
      expect(cssHint).toBeDefined();
      expect(cssHint).toContain("Tailwind usage detected");
      expect(cssHint).toContain('additionalPaths: ["dist/assets"]');
    });

    it("does not flip to the Tailwind variant when class names aren't utility-shaped", () => {
      const files = Array.from({ length: 60 }, (_, i) =>
        tsxFileWithClassName(`c${i}.tsx`, "site-header active"),
      );
      const { analysisCoverage } = buildAnalysisCoverage(files, [], NO_RULES, false);
      const hints = (analysisCoverage?.["hints"] as string[] | undefined) ?? [];
      const cssHint = hints.find((h) => h.includes("CSS file(s)"));
      expect(cssHint).toBeDefined();
      expect(cssHint).not.toContain("Tailwind usage detected");
    });
  });

  describe("template directive handling", () => {
    it("surfaces a plain-English handling note alongside the engines list", () => {
      const jinja = htmlFile("t.html", "{% extends 'base.html' %}<p>{{ x }}</p>");
      const { analysisCoverage } = buildAnalysisCoverage([jinja], [], NO_RULES, false);
      expect(analysisCoverage?.["templateDirectivesFound"]).toEqual(["jinja-or-liquid"]);
      const handling = analysisCoverage?.["templateDirectiveHandling"] as string | undefined;
      expect(handling).toBeDefined();
      expect(handling).toContain("parsed as literal");
      expect(handling).toContain("rendered output is not reconstructed");
    });

    it("omits the handling note when no directives are detected", () => {
      const plain = htmlFile("p.html", "<p>hello</p>");
      const { analysisCoverage } = buildAnalysisCoverage([plain], [], NO_RULES, false);
      expect(analysisCoverage?.["templateDirectiveHandling"]).toBeUndefined();
    });
  });
});
