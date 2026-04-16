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

function tsxFile(
  path: string,
  tagNames: readonly string[],
  options: { readonly interactive?: boolean } = {},
): ParsedFile {
  const source = tagNames.map((t) => `<${t} />`).join("\n");
  const interactive = options.interactive === true;
  // An `onClick` attribute makes the scanner treat the component as a
  // wrapper candidate (used in an interactive context). Tests that
  // exercise the top-N ranking set interactive: true; tests that
  // exercise the total opaque count or the "never interactive"
  // structural filter leave it off.
  const interactiveAttr = interactive
    ? [
        {
          kind: "JsxAttribute" as const,
          range: { start: 0, end: 0 },
          loc: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 1, offset: 0 },
          },
          name: "onClick",
          value: { kind: "Expression" as const, raw: "{() => {}}" },
        },
      ]
    : [];
  const jsxElements = tagNames.map((tagName) => ({
    kind: "JsxElement" as const,
    range: { start: 0, end: 0 },
    loc: {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 1, offset: 0 },
    },
    tagName,
    attributes: interactiveAttr,
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
      const files = [tsxFile("a.tsx", tags, { interactive: true })];
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
      // 3 call sites of Button, 2 of Card, 1 of Widget. All used with
      // onClick so the structural "wrapper candidate" filter keeps them
      // in the ranking.
      const files = [
        tsxFile("a.tsx", ["Button", "Button", "Button", "Card", "Card", "Widget"], {
          interactive: true,
        }),
      ];
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
      // 10 unique components, one call site each, all interactive.
      const tags = Array.from({ length: 10 }, (_, i) => `Comp${i}`);
      const files = [tsxFile("a.tsx", tags, { interactive: true })];
      const { analysisCoverage } = buildAnalysisCoverage(files, [], NO_RULES, false);
      const top = analysisCoverage?.["opaqueCustomComponentsTop"] as { name: string }[] | undefined;
      expect(top?.length).toBe(5);
    });

    it("breaks ties alphabetically so output is deterministic across runs", () => {
      const files = [tsxFile("a.tsx", ["Zeta", "Alpha", "Mike"], { interactive: true })];
      const { analysisCoverage } = buildAnalysisCoverage(files, [], NO_RULES, false);
      const top = analysisCoverage?.["opaqueCustomComponentsTop"] as { name: string }[] | undefined;
      expect(top?.map((e) => e.name)).toEqual(["Alpha", "Mike", "Zeta"]);
    });

    it("excludes components never used with an interactive attribute from the top-N", () => {
      // Route-style non-DOM components: appear plenty but never get
      // onClick/role/tabIndex/href. Previously dominated the top-5;
      // now the structural usage filter drops them. Genuine wrapper
      // candidates (Button with onClick) stay ranked.
      const nonInteractive = Array.from({ length: 20 }, () => "Route");
      const interactive = ["Button", "Button", "Button"];
      const files = [
        tsxFile("a.tsx", nonInteractive, { interactive: false }),
        tsxFile("b.tsx", interactive, { interactive: true }),
      ];
      const { analysisCoverage } = buildAnalysisCoverage(files, [], NO_RULES, false);
      const top = analysisCoverage?.["opaqueCustomComponentsTop"] as
        | { name: string; callSites: number }[]
        | undefined;
      expect(top?.map((e) => e.name)).toEqual(["Button"]);
      // Total count still reports both — Route remains "opaque", it's
      // just not a wrapper candidate. Don't hide the inventory signal.
      expect(analysisCoverage?.["opaqueCustomComponents"]).toBe(2);
    });

    it("keeps a component in the ranking when ANY call site is interactive", () => {
      // Mixed usage: <MyBtn /> bare in file A, <MyBtn onClick=...> in
      // file B. Still a wrapper candidate on the strength of file B.
      const files = [
        tsxFile("a.tsx", ["MyBtn", "MyBtn"], { interactive: false }),
        tsxFile("b.tsx", ["MyBtn"], { interactive: true }),
      ];
      const { analysisCoverage } = buildAnalysisCoverage(files, [], NO_RULES, false);
      const top = analysisCoverage?.["opaqueCustomComponentsTop"] as
        | { name: string; callSites: number }[]
        | undefined;
      expect(top).toEqual([{ name: "MyBtn", callSites: 3 }]);
    });

    it("treats {...spread} props as possibly interactive (conservative)", () => {
      // Static analysis can't see inside spread, so the component
      // stays ranked rather than silently dropping a design-system
      // wrapper that forwards interactivity via spread.
      const files: ParsedFile[] = [
        {
          filePath: "a.tsx",
          source: "<Wrapper {...props} />",
          ast: {
            language: "tsx",
            root: {
              kind: "TsxModule",
              range: { start: 0, end: 22 },
              loc: {
                start: { line: 1, column: 1, offset: 0 },
                end: { line: 1, column: 1, offset: 22 },
              },
              jsxElements: [
                {
                  kind: "JsxElement",
                  range: { start: 0, end: 22 },
                  loc: {
                    start: { line: 1, column: 1, offset: 0 },
                    end: { line: 1, column: 1, offset: 22 },
                  },
                  tagName: "Wrapper",
                  attributes: [],
                  children: [],
                  selfClosing: true,
                  hasSpreadProps: true,
                },
              ],
            },
            errors: [],
          },
        },
      ];
      const { analysisCoverage } = buildAnalysisCoverage(files, [], NO_RULES, false);
      const top = analysisCoverage?.["opaqueCustomComponentsTop"] as
        | { name: string; callSites: number }[]
        | undefined;
      expect(top).toEqual([{ name: "Wrapper", callSites: 1 }]);
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
