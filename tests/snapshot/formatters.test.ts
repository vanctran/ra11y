import { describe, expect, it } from "bun:test";
import {
  jsonFormatter,
  plainFormatter,
  terminalFormatter,
} from "../../src/output/formatters/index.ts";
import type { ReportData, ScanResult } from "../../src/types/violation.ts";
import { setColorEnabled } from "../../src/utils/ansi.ts";
import { withFindingIds } from "../helpers/make-violation.ts";

// Fixed input so snapshots are deterministic. Duration is zeroed to
// avoid wall-clock drift.
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
      ruleId: "link/descriptive-text",
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
  durationMs: 0,
  enabledStandards: ["wcag22"],
  isTTY: false,
};

const REPORT: ReportData = {
  coverage: [{ standardId: "wcag22", automated: 22, total: 87, passing: 20, failing: 2 }],
  manualReviewNeeded: ["wcag22:1.2.1", "wcag22:1.4.1", "wcag22:2.1.2"],
};

describe("formatter: terminal (no color)", () => {
  it("renders deterministic output with color disabled", () => {
    setColorEnabled(false);
    const output = terminalFormatter.format(RESULT, REPORT);
    // Assert structural invariants instead of the full string so small
    // layout tweaks don't churn the test — but still pin the shape.
    expect(output).toContain("ra11y");
    expect(output).toContain("src/ui/Card.tsx");
    expect(output).toContain("src/ui/Header.tsx");
    expect(output).toContain("media/alt-text-missing");
    expect(output).toContain("link/descriptive-text");
    expect(output).toContain("WCAG 2.2 · 1.1.1");
    expect(output).toContain("Fix:");
    expect(output).toContain("2 errors");
    expect(output).toContain("1 warning");
    expect(output).toContain("Coverage");
  });

  it("shows zero violations cleanly", () => {
    setColorEnabled(false);
    const empty: ScanResult = {
      violations: [],
      filesScanned: 5,
      durationMs: 0,
      enabledStandards: ["wcag22"],
      isTTY: false,
    };
    const output = terminalFormatter.format(empty, REPORT);
    expect(output).toContain("0 errors");
  });

  it("is deterministic across repeated calls", () => {
    setColorEnabled(false);
    const a = terminalFormatter.format(RESULT, REPORT);
    const b = terminalFormatter.format(RESULT, REPORT);
    expect(a).toBe(b);
  });
});

describe("formatter: plain", () => {
  it("emits one line per violation with no ANSI", () => {
    const output = plainFormatter.format(RESULT, REPORT);
    // No ANSI escape sequences. The ESC (0x1b) character is a literal
    // control char by definition, so biome-ignore is the right knob.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting absence of ANSI ESC sequences
    expect(output).not.toMatch(/\u001b\[/);
    // Each violation becomes a line.
    const lines = output.trim().split("\n");
    // 3 violations + 1 summary line.
    expect(lines.length).toBe(4);
    expect(lines[0]).toContain("src/ui/Card.tsx:12:5");
    expect(lines[0]).toContain("media/alt-text-missing");
    expect(lines[0]).toContain("error");
  });

  it("emits a single-line summary when clean", () => {
    const empty: ScanResult = {
      violations: [],
      filesScanned: 5,
      durationMs: 0,
      enabledStandards: ["wcag22"],
      isTTY: false,
    };
    const output = plainFormatter.format(empty, REPORT);
    expect(output.trim()).toBe("0 violations in 5 files (0ms)");
  });
});

describe("formatter: json", () => {
  it("emits valid parseable JSON with the expected shape", () => {
    const output = jsonFormatter.format(RESULT, REPORT);
    const parsed = JSON.parse(output) as {
      ra11y: { version: string };
      result: {
        enabledStandards: string[];
        filesScanned: number;
        violations: { ruleId: string; criteria: string[]; severity: string }[];
      };
      report: { coverage: unknown[] };
    };
    expect(parsed.ra11y.version).toBe("0.0.0");
    expect(parsed.result.enabledStandards).toEqual(["wcag22"]);
    expect(parsed.result.filesScanned).toBe(12);
    expect(parsed.result.violations).toHaveLength(3);
    expect(parsed.result.violations[0]?.ruleId).toBe("media/alt-text-missing");
    expect(parsed.result.violations[0]?.criteria).toContain("wcag22:1.1.1");
    expect(parsed.report.coverage).toHaveLength(1);
  });

  it("is deterministic across repeated calls", () => {
    const a = jsonFormatter.format(RESULT, REPORT);
    const b = jsonFormatter.format(RESULT, REPORT);
    expect(a).toBe(b);
  });
});
