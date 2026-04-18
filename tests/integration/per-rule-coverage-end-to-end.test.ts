/**
 * End-to-end scanner coverage-confidence test.
 *
 * Runs the full scanner over a JSX-only file set and confirms that the
 * `PerRuleCoverage` rows + `ruleCoverage` derivative the MCP response
 * will surface correctly classify CSS-targeted rules as
 * `lowConfidenceClean` — the canonical Tailwind-pre-build shape.
 *
 * Counterpart high-confidence direction: a scan with CSS files present
 * pushes those same rules into `confidentlyClean` on a clean result,
 * confirming that the transition `low → high` tracks what actually
 * ran.
 */

import { describe, expect, it } from "bun:test";
import { type ParsedFile, runScan } from "../../src/engine/scanner.ts";
import { parseCss, parseTsx } from "../../src/input/parsers/index.ts";
import { buildRuleCoverageDerivative } from "../../src/mcp/rule-coverage-derivative.ts";
import { BUILTIN_RULES } from "../../src/rules/index.ts";
import { wcag22 } from "../../src/standards/wcag22/standard.ts";
import type { Ast } from "../../src/types/ast.ts";

function tsxFile(path: string, source: string): ParsedFile {
  const parsed = parseTsx(source);
  const ast: Ast = { language: "tsx", root: parsed.root, errors: parsed.errors };
  return { filePath: path, source, ast };
}

function cssFile(path: string, source: string): ParsedFile {
  const parsed = parseCss(source);
  const ast: Ast = { language: "css", root: parsed.root, errors: parsed.errors };
  return { filePath: path, source, ast };
}

describe("per-rule coverage end-to-end", () => {
  it("JSX-only scan surfaces CSS-targeted rules in lowConfidenceClean", () => {
    const files = [
      tsxFile(
        "src/App.tsx",
        `export function App() { return <main><h1>Hello</h1><p>world</p></main>; }`,
      ),
      tsxFile(
        "src/Button.tsx",
        `export function Button({ label }: { label: string }) { return <button>{label}</button>; }`,
      ),
    ];
    const { result, perRuleCoverage } = runScan({
      standards: [wcag22],
      rules: BUILTIN_RULES,
      enabled: ["wcag22"],
      files,
    });

    const cssRuleRows = perRuleCoverage.filter((r) => r.ruleId.startsWith("contrast/"));
    // Every contrast rule targets `.css`; with no CSS files scanned
    // they must all show 0 eligible + low confidence.
    expect(cssRuleRows.length).toBeGreaterThan(0);
    for (const row of cssRuleRows) {
      expect(row.filesEligible).toBe(0);
      expect(row.coverageConfidence).toBe("low");
      expect(row.reason).toBeDefined();
      expect(row.remediation).toBeDefined();
    }

    const derivative = buildRuleCoverageDerivative(perRuleCoverage, result.violations);
    expect(derivative).not.toBeNull();
    // contrast/minimum is the canonical acute case — verify it's in the
    // low-confidence bucket and not in confidentlyClean.
    expect(derivative!.lowConfidenceClean).toContain("contrast/minimum");
    expect(derivative!.lowConfidenceClean).toContain("contrast/enhanced");
    expect(derivative!.confidentlyClean).not.toContain("contrast/minimum");
  });

  it("scan that includes CSS files promotes those rules to confidentlyClean", () => {
    const files = [
      tsxFile("src/App.tsx", `export function App() { return <main><h1>Hi</h1></main>; }`),
      cssFile("src/styles.css", `body { color: #000; background: #fff; }`),
    ];
    const { perRuleCoverage } = runScan({
      standards: [wcag22],
      rules: BUILTIN_RULES,
      enabled: ["wcag22"],
      files,
    });

    const contrastMinRow = perRuleCoverage.find((r) => r.ruleId === "contrast/minimum");
    expect(contrastMinRow).toBeDefined();
    expect(contrastMinRow!.filesEligible).toBeGreaterThan(0);
    expect(contrastMinRow!.coverageConfidence).toBe("high");
  });
});
