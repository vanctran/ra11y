/**
 * Integration: uniquePerCriterion dedup across the scanner.
 *
 * Regression for field feedback: a Flask-serves-React codebase had
 * `base.html`, `index.html`, and `App.tsx` all matching the
 * multiple-ways root-layout heuristic, so WCAG 2.4.5 appeared three
 * times with the same question. Since 2.4.5 is a page-set-level
 * criterion, one candidate per project is the correct surface.
 */

import { describe, expect, it } from "bun:test";
import { type ParsedFile, runScan } from "../../src/engine/scanner.ts";
import { parseHtml, parseTsx } from "../../src/input/parsers/index.ts";
import { finder as multipleWays } from "../../src/review/finders/multiple-ways.ts";
import { wcag22 } from "../../src/standards/wcag22/standard.ts";

function htmlFile(filePath: string, source: string): ParsedFile {
  const r = parseHtml(source);
  return { filePath, source, ast: { language: "html", root: r.root, errors: r.errors } };
}

function tsxFile(filePath: string, source: string): ParsedFile {
  const r = parseTsx(source);
  return { filePath, source, ast: { language: "tsx", root: r.root, errors: r.errors } };
}

describe("candidate-runner — inline-disable suppresses candidates", () => {
  it("`<!-- ra11y-disable -->` at top of file silences WCAG-based review candidates", async () => {
    // Jinja templates and LLM prompt fragments aren't rendered UI but
    // trip manual-review heuristics (sensory wording, logo alt text,
    // etc.). A file-level disable must quiet WCAG-based candidates,
    // not just violations. The `ra11y:suppression-no-reason` process-
    // rule candidate still fires on the bare pragma itself — that
    // accountability signal is load-bearing and explicitly not gated
    // by the wildcard suppression (see `suppression-no-reason` finder
    // docstring for the self-suppression semantics).
    const { parseInlineDisables } = await import("../../src/config/inline-disables.ts");
    const source = "<!-- ra11y-disable -->\n<p>consider the view above</p>\n";
    const r = parseHtml(source);
    const file: ParsedFile = {
      filePath: "/p/prompt.html",
      source,
      ast: { language: "html", root: r.root, errors: r.errors },
      disableMap: parseInlineDisables(source),
    };
    const { report } = runScan({
      standards: [wcag22],
      rules: [],
      enabled: ["wcag22"],
      files: [file],
      finders: (await import("../../src/review/index.ts")).BUILTIN_CANDIDATE_FINDERS,
    });
    const wcagCandidates = (report.candidates ?? []).filter((c) =>
      c.criterionId.startsWith("wcag"),
    );
    expect(wcagCandidates).toEqual([]);
  });

  it("`<!-- ra11y-disable wcag22:1.3.3 -->` silences one criterion without touching others", async () => {
    // Agent-iterative use: after investigating a 1.3.3 candidate and
    // judging it acceptable, a source-level dismissal keyed by
    // criterion ID keeps the next scan from re-surfacing it — without
    // also silencing the 1.4.5 image-of-text prompt on the line.
    const { parseInlineDisables } = await import("../../src/config/inline-disables.ts");
    const source =
      "<!-- ra11y-disable wcag22:1.3.3 -->\n" +
      "<p>consider the view above</p>\n" +
      '<img src="logo.png" class="logo" alt="Brand" />\n';
    const r = parseHtml(source);
    const file: ParsedFile = {
      filePath: "/p/mixed.html",
      source,
      ast: { language: "html", root: r.root, errors: r.errors },
      disableMap: parseInlineDisables(source),
    };
    const { report } = runScan({
      standards: [wcag22],
      rules: [],
      enabled: ["wcag22"],
      files: [file],
      finders: (await import("../../src/review/index.ts")).BUILTIN_CANDIDATE_FINDERS,
    });
    const ids = new Set((report.candidates ?? []).map((c) => c.criterionId));
    expect(ids.has("wcag22:1.3.3")).toBe(false);
    expect(ids.has("wcag22:1.4.5")).toBe(true);
  });
});

describe("multiple-ways finder — uniquePerCriterion dedup", () => {
  it("emits one candidate per criterion even when multiple root layouts match", () => {
    const files: ParsedFile[] = [
      htmlFile("/p/app/templates/base.html", "<html><body><main>x</main></body></html>"),
      htmlFile("/p/frontend/index.html", "<html><body><main>x</main></body></html>"),
      tsxFile("/p/frontend/src/App.tsx", "export const App = () => <Layout><main/></Layout>;"),
    ];
    const { report } = runScan({
      standards: [wcag22],
      rules: [],
      enabled: ["wcag22"],
      files,
      finders: [multipleWays],
    });

    const candidates = report.candidates ?? [];
    const for245 = candidates.filter((c) => c.criterionId === "wcag22:2.4.5");
    expect(for245.length).toBe(1);
    // Sorted path order — base.html comes first alphabetically.
    expect(for245[0]?.location.filePath).toBe("/p/app/templates/base.html");
  });
});
