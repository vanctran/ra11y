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
