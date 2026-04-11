import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHtml, parseTsx } from "../../src/input/parsers/index.ts";
import { runScan, type ParsedFile } from "../../src/engine/scanner.ts";
import { BUILTIN_RULES } from "../../src/rules/index.ts";
import { wcag22 } from "../../src/standards/wcag22/standard.ts";
import type { Ast } from "../../src/types/ast.ts";

const FIXTURES = join(import.meta.dir, "..", "fixtures");

function loadFixture(category: "good" | "bad", file: string): ParsedFile {
  const filePath = join(FIXTURES, category, "alt-text-missing", file);
  const source = readFileSync(filePath, "utf8");
  const ast: Ast = file.endsWith(".html")
    ? (() => {
        const r = parseHtml(source);
        return { language: "html", root: r.root, errors: r.errors };
      })()
    : (() => {
        const r = parseTsx(source);
        return { language: "tsx", root: r.root, errors: r.errors };
      })();
  return { filePath, source, ast };
}

describe("end-to-end: alt-text-missing against real WCAG 2.2 pipeline", () => {
  it("runs a clean scan over good fixtures", () => {
    const files = [
      loadFixture("good", "img-with-alt.html"),
      loadFixture("good", "decorative-empty-alt.html"),
      loadFixture("good", "jsx-img-with-alt.tsx"),
    ];
    const { result, report } = runScan({
      standards: [wcag22],
      rules: BUILTIN_RULES,
      enabled: ["wcag22"],
      files,
    });
    expect(result.violations).toHaveLength(0);
    expect(result.filesScanned).toBe(3);
    expect(result.enabledStandards).toEqual(["wcag22"]);
    expect(report.coverage).toHaveLength(1);
    expect(report.coverage[0]?.standardId).toBe("wcag22");
  });

  it("surfaces violations on bad fixtures with WCAG citations", () => {
    const files = [
      loadFixture("bad", "img-no-alt.html"),
      loadFixture("bad", "input-image-no-alt.html"),
      loadFixture("bad", "jsx-img-no-alt.tsx"),
    ];
    const { result } = runScan({
      standards: [wcag22],
      rules: BUILTIN_RULES,
      enabled: ["wcag22"],
      files,
    });
    expect(result.violations.length).toBeGreaterThanOrEqual(3);
    for (const v of result.violations) {
      expect(v.ruleId).toBe("media/alt-text-missing");
      expect(v.criteria).toContain("wcag22:1.1.1");
      expect(v.severity).toBe("error");
    }
  });

  it("sorts violations deterministically by (file, line, column, ruleId)", () => {
    const files = [
      loadFixture("bad", "jsx-img-no-alt.tsx"),
      loadFixture("bad", "img-no-alt.html"),
    ];
    const { result } = runScan({
      standards: [wcag22],
      rules: BUILTIN_RULES,
      enabled: ["wcag22"],
      files,
    });
    // Files should sort alphabetically regardless of input order.
    const filePaths = result.violations.map((v) => v.location.filePath);
    const sortedPaths = [...filePaths].sort();
    expect(filePaths).toEqual(sortedPaths);
  });

  it("builds coverage with wcag22 counted correctly", () => {
    const files = [loadFixture("bad", "img-no-alt.html")];
    const { report } = runScan({
      standards: [wcag22],
      rules: BUILTIN_RULES,
      enabled: ["wcag22"],
      files,
    });
    const wcag22Coverage = report.coverage.find((c) => c.standardId === "wcag22");
    expect(wcag22Coverage).toBeDefined();
    expect(wcag22Coverage?.failing).toBeGreaterThan(0);
    // Manual-review list should include known-manual SCs like 1.2.1.
    expect(report.manualReviewNeeded).toContain("wcag22:1.2.1");
  });

  it("produces a context-aware suggestion that mentions the image filename", () => {
    const files = [loadFixture("bad", "img-no-alt.html")];
    const { result } = runScan({
      standards: [wcag22],
      rules: BUILTIN_RULES,
      enabled: ["wcag22"],
      files,
    });
    const violation = result.violations[0];
    expect(violation?.message).toContain("revenue-2026.png");
    expect(violation?.suggestion).toContain("revenue 2026");
  });

  it("throws a clear error if the user enables an unloaded standard", () => {
    const files = [loadFixture("good", "img-with-alt.html")];
    expect(() => {
      runScan({
        standards: [wcag22],
        rules: BUILTIN_RULES,
        enabled: ["wcag21"],
        files,
      });
    }).toThrow(/--standard 'wcag21' is not loaded/);
  });
});
