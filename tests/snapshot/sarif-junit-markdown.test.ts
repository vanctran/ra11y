import { describe, expect, it } from "bun:test";
import {
  htmlFormatter,
  junitFormatter,
  markdownFormatter,
  sarifFormatter,
} from "../../src/output/formatters/index.ts";
import type { ReportData, ScanResult } from "../../src/types/violation.ts";
import { withFindingIds } from "../helpers/make-violation.ts";

const RESULT: ScanResult = {
  violations: withFindingIds([
    {
      ruleId: "media/alt-text-missing",
      criteria: ["wcag22:1.1.1", "wcag21:1.1.1"],
      severity: "error",
      location: { filePath: "src/ui/Card.tsx", line: 12, column: 5 },
      message: "<img> 'chart.png' is missing a text alternative.",
      suggestion: "Add alt describing what the image communicates.",
    },
    {
      ruleId: "navigation/link-descriptive-text",
      criteria: ["wcag22:2.4.4"],
      severity: "warning",
      location: { filePath: "src/ui/Card.tsx", line: 45, column: 9 },
      message: "Link text 'here' is not descriptive.",
      suggestion: "Describe the destination, e.g. 'view settings'.",
    },
    {
      ruleId: "media/alt-text-missing",
      criteria: ["wcag22:1.1.1"],
      severity: "error",
      location: { filePath: "src/ui/Header.tsx", line: 4, column: 3 },
      message: "<img> 'logo.png' is missing a text alternative.",
      suggestion: "Add alt='Acme Co.' or alt='' if decorative.",
    },
  ]),
  filesScanned: 12,
  durationMs: 42,
  enabledStandards: ["wcag22"],
  isTTY: false,
};

const REPORT: ReportData = {
  coverage: [{ standardId: "wcag22", automated: 22, total: 87, passing: 20, failing: 2 }],
  manualReviewNeeded: ["wcag22:1.2.1", "wcag22:1.4.1", "wcag22:2.1.2"],
};

describe("formatter: sarif", () => {
  it("produces valid parseable SARIF 2.1.0 JSON", () => {
    const output = sarifFormatter.format(RESULT, REPORT);
    const parsed = JSON.parse(output) as {
      $schema: string;
      version: string;
      runs: Array<{
        tool: { driver: { name: string; version: string; rules: Array<{ id: string }> } };
        results: Array<{ ruleId: string; level: string; message: { text: string } }>;
      }>;
    };
    expect(parsed.version).toBe("2.1.0");
    expect(parsed.$schema).toContain("sarif-schema-2.1.0.json");
    expect(parsed.runs).toHaveLength(1);
    expect(parsed.runs[0]?.tool.driver.name).toBe("ra11y");
    expect(parsed.runs[0]?.tool.driver.rules.length).toBe(2); // 2 distinct rule IDs
    expect(parsed.runs[0]?.results).toHaveLength(3);
    expect(parsed.runs[0]?.results[0]?.level).toBe("error");
    expect(parsed.runs[0]?.results[1]?.level).toBe("warning");
  });

  it("deduplicates rules in the driver.rules list", () => {
    const output = sarifFormatter.format(RESULT, REPORT);
    const parsed = JSON.parse(output) as {
      runs: Array<{ tool: { driver: { rules: Array<{ id: string }> } } }>;
    };
    const ruleIds = parsed.runs[0]?.tool.driver.rules.map((r) => r.id) ?? [];
    const unique = new Set(ruleIds);
    expect(ruleIds.length).toBe(unique.size);
  });

  it("emits stable partialFingerprints for deduplication", () => {
    const a = sarifFormatter.format(RESULT, REPORT);
    const b = sarifFormatter.format(RESULT, REPORT);
    expect(a).toBe(b);
    const parsed = JSON.parse(a) as {
      runs: Array<{
        results: Array<{ partialFingerprints: Record<string, string> }>;
      }>;
    };
    for (const result of parsed.runs[0]?.results ?? []) {
      expect(result.partialFingerprints.primary).toMatch(/^[0-9a-f]+$/);
    }
  });

  it("emits a rule entry tagged with the criteria", () => {
    const output = sarifFormatter.format(RESULT, REPORT);
    const parsed = JSON.parse(output) as {
      runs: Array<{
        tool: { driver: { rules: Array<{ id: string; properties: { tags: string[] } }> } };
      }>;
    };
    const rule = parsed.runs[0]?.tool.driver.rules.find((r) => r.id === "media/alt-text-missing");
    expect(rule?.properties.tags).toContain("accessibility");
    expect(rule?.properties.tags).toContain("wcag22:1.1.1");
  });
});

describe("formatter: junit", () => {
  it("emits valid XML with the expected structure", () => {
    const output = junitFormatter.format(RESULT, REPORT);
    expect(output.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(output).toContain("<testsuites");
    expect(output).toContain("</testsuites>");
    expect(output).toContain('name="ra11y"');
  });

  it("groups testsuites by file and testcases by rule ID", () => {
    const output = junitFormatter.format(RESULT, REPORT);
    // Two files → two testsuites
    const suiteMatches = output.match(/<testsuite /g) ?? [];
    expect(suiteMatches.length).toBe(2);
    // Card.tsx has 2 rules, Header.tsx has 1 → 3 testcases total
    const caseMatches = output.match(/<testcase /g) ?? [];
    expect(caseMatches.length).toBe(3);
  });

  it("emits <failure> for error-severity violations", () => {
    const output = junitFormatter.format(RESULT, REPORT);
    expect(output).toContain("<failure");
    expect(output).toContain('type="media/alt-text-missing"');
  });

  it("escapes XML special characters in messages", () => {
    const withSpecials: ScanResult = {
      ...RESULT,
      violations: withFindingIds([
        {
          ruleId: "test/rule",
          criteria: ["wcag22:1.1.1"],
          severity: "error",
          location: { filePath: "a.html", line: 1, column: 1 },
          message: "contains <angle> & 'quotes' & \"double\"",
          suggestion: "fix it",
        },
      ]),
    };
    const output = junitFormatter.format(withSpecials, REPORT);
    expect(output).toContain("&lt;angle&gt;");
    expect(output).toContain("&amp;");
    expect(output).toContain("&apos;quotes&apos;");
    expect(output).toContain("&quot;double&quot;");
    expect(output).not.toContain("<angle>");
  });

  it("top-level counts roll up correctly", () => {
    const output = junitFormatter.format(RESULT, REPORT);
    // 2 unique rule IDs, but 3 violations — testsuites tests count
    // is the number of distinct rule IDs across all files: 2+1 = 3
    expect(output).toContain('tests="3"');
    // 2 error-severity violations
    expect(output).toContain('failures="2"');
  });
});

describe("formatter: markdown", () => {
  it("emits a markdown report with summary and table", () => {
    const output = markdownFormatter.format(RESULT, REPORT);
    expect(output).toContain("## ra11y accessibility report");
    expect(output).toContain("**2** errors");
    expect(output).toContain("**1** warnings");
    expect(output).toContain("| File | Line | Rule | Severity | Message |");
  });

  it("renders clean report when violations are empty", () => {
    const clean: ScanResult = { ...RESULT, violations: [] };
    const output = markdownFormatter.format(clean, REPORT);
    expect(output).toContain("_No accessibility violations found._");
  });

  it("uses <details> collapse when over threshold", () => {
    const many: ScanResult = {
      ...RESULT,
      violations: withFindingIds(
        Array.from({ length: 11 }, (_, i) => ({
          ruleId: "media/alt-text-missing",
          criteria: ["wcag22:1.1.1"],
          severity: "error" as const,
          location: { filePath: `file${i}.html`, line: 1, column: 1 },
          message: `violation ${i}`,
          suggestion: "fix",
        })),
      ),
    };
    const output = markdownFormatter.format(many, REPORT);
    expect(output).toContain("<details>");
    expect(output).toContain("</details>");
  });

  it("escapes pipe characters in file paths and messages", () => {
    const withPipe: ScanResult = {
      ...RESULT,
      violations: withFindingIds([
        {
          ruleId: "test/rule",
          criteria: ["wcag22:1.1.1"],
          severity: "error",
          location: { filePath: "weird|path.html", line: 1, column: 1 },
          message: "message with | pipe",
          suggestion: "fix",
        },
      ]),
    };
    const output = markdownFormatter.format(withPipe, REPORT);
    expect(output).toContain("weird\\|path.html");
    expect(output).toContain("message with \\| pipe");
  });

  it("emits coverage table", () => {
    const output = markdownFormatter.format(RESULT, REPORT);
    expect(output).toContain("### Coverage");
    expect(output).toContain("| WCAG 2.2 | 20/22");
  });

  it("is deterministic across repeated calls", () => {
    const a = markdownFormatter.format(RESULT, REPORT);
    const b = markdownFormatter.format(RESULT, REPORT);
    expect(a).toBe(b);
  });
});

describe("formatter: html", () => {
  it("produces a complete HTML document", () => {
    const out = htmlFormatter.format(RESULT, REPORT);
    expect(out).toContain("<!doctype html>");
    expect(out).toContain('<html lang="en">');
    expect(out).toContain("</html>");
  });

  it("escapes HTML-sensitive characters in messages", () => {
    const input: ScanResult = {
      ...RESULT,
      violations: withFindingIds([
        {
          ruleId: "media/alt-text-missing",
          criteria: ["wcag22:1.1.1"],
          severity: "error",
          location: { filePath: "src/a.tsx", line: 1, column: 1 },
          message: "<script>bad</script>",
        },
      ]),
    };
    const out = htmlFormatter.format(input, REPORT);
    expect(out).not.toContain("<script>bad</script>");
    expect(out).toContain("&lt;script&gt;bad&lt;/script&gt;");
  });

  it("renders a summary table and coverage section when there are findings", () => {
    const out = htmlFormatter.format(RESULT, REPORT);
    expect(out).toContain("Summary");
    expect(out).toContain("Findings");
    expect(out).toContain("Coverage");
    expect(out).toContain("<caption>");
  });

  it("handles the no-violations case gracefully", () => {
    const empty: ScanResult = { ...RESULT, violations: [] };
    const out = htmlFormatter.format(empty, REPORT);
    expect(out).toContain("No accessibility violations found.");
  });

  it("includes inline CSS (self-contained artifact)", () => {
    const out = htmlFormatter.format(RESULT, REPORT);
    expect(out).toContain("<style>");
    expect(out).toContain("system-ui");
    expect(out).not.toContain('<link rel="stylesheet"');
  });

  it("is deterministic across repeated calls", () => {
    const a = htmlFormatter.format(RESULT, REPORT);
    const b = htmlFormatter.format(RESULT, REPORT);
    expect(a).toBe(b);
  });
});
