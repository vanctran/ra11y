#!/usr/bin/env bun
/**
 * Minimal smoke test for the slack-markdown formatter. Proves the
 * formatter loads, accepts a ScanResult + ReportData, and produces
 * non-empty output. The CI plugin-examples job runs this to verify
 * the plugin API surface didn't drift under us.
 */

import slackMarkdown from "./formatter.ts";

const result = {
  violations: [
    {
      ruleId: "media/alt-text-missing",
      criteria: ["wcag22:1.1.1"],
      severity: "error" as const,
      location: { filePath: "src/a.tsx", line: 12, column: 3 },
      message: "img missing alt",
    },
  ],
  filesScanned: 1,
  durationMs: 5,
  enabledStandards: ["wcag22"],
  isTTY: false,
};
const report = {
  coverage: [],
  manualReviewNeeded: [],
};

const out = slackMarkdown.format(result, report);
if (!out.includes("ra11y accessibility report")) {
  console.error("✗ output missing header");
  process.exit(1);
}
if (!out.includes("media/alt-text-missing")) {
  console.error("✗ output missing rule ID");
  process.exit(1);
}
console.log("✓ slack-markdown formatter produced expected output");
