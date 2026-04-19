/**
 * Unit tests for `src/mcp/warnings.ts` — the `computeScanWarnings`
 * mapping from scan-meta inputs to the structured `ScanWarningCode[]`
 * surfaced on `scan_project` / `scan` responses.
 *
 * Two invariants guard the silent-success failure mode:
 *   1. Every code fires on its named condition and only its named
 *      condition (over-surfacing is the cheap failure mode per
 *      CLAUDE.md §1 "Failure modes are asymmetric").
 *   2. When NO condition holds, the function returns an empty array so
 *      callers can conditional-spread and omit the field (CLAUDE.md §1
 *      "Ambiguous field shapes are dishonest" — never emit `warnings: []`).
 */

import { describe, expect, it } from "bun:test";
import { computeScanWarnings, warningsFromScanMeta } from "../../../src/mcp/warnings.ts";

describe("computeScanWarnings", () => {
  it("returns no codes on a healthy scan", () => {
    const codes = computeScanWarnings({
      filesScanned: 42,
      rootSource: "explicit",
      configSource: "/proj/ra11y.config.ts",
      analysisCoverage: {},
      filesByExtension: { ".tsx": 40, ".css": 5 },
    });
    expect(codes).toEqual([]);
  });

  it("fires `scanned_zero_files` when filesScanned is zero — the canonical `cwd: wrong-path` silent-success case", () => {
    const codes = computeScanWarnings({
      filesScanned: 0,
      rootSource: "explicit",
      configSource: "/proj/ra11y.config.ts",
      analysisCoverage: undefined,
      filesByExtension: undefined,
    });
    expect(codes).toContain("scanned_zero_files");
  });

  it("fires `root_source_defaulted` when rootSource is `git` (spawn-cwd was auto-promoted without the caller's say-so)", () => {
    const codes = computeScanWarnings({
      filesScanned: 10,
      rootSource: "git",
      configSource: "/proj/ra11y.config.ts",
      analysisCoverage: undefined,
      filesByExtension: undefined,
    });
    expect(codes).toContain("root_source_defaulted");
  });

  it("fires `root_source_defaulted` when rootSource is `spawn-cwd` (plain spawn directory, no git root either)", () => {
    const codes = computeScanWarnings({
      filesScanned: 10,
      rootSource: "spawn-cwd",
      configSource: "/proj/ra11y.config.ts",
      analysisCoverage: undefined,
      filesByExtension: undefined,
    });
    expect(codes).toContain("root_source_defaulted");
  });

  it("does NOT fire `root_source_defaulted` when the caller passed cwd (rootSource: explicit)", () => {
    const codes = computeScanWarnings({
      filesScanned: 10,
      rootSource: "explicit",
      configSource: "/proj/ra11y.config.ts",
      analysisCoverage: undefined,
      filesByExtension: undefined,
    });
    expect(codes).not.toContain("root_source_defaulted");
  });

  it("does NOT fire `root_source_defaulted` when the host declared a root (rootSource: host-root)", () => {
    const codes = computeScanWarnings({
      filesScanned: 10,
      rootSource: "host-root",
      configSource: "/proj/ra11y.config.ts",
      analysisCoverage: undefined,
      filesByExtension: undefined,
    });
    expect(codes).not.toContain("root_source_defaulted");
  });

  it("does NOT fire `root_source_defaulted` when the tool has no root-resolution step (rootSource: null for `scan`)", () => {
    const codes = computeScanWarnings({
      filesScanned: 10,
      rootSource: null,
      configSource: "/proj/ra11y.config.ts",
      analysisCoverage: undefined,
      filesByExtension: undefined,
    });
    expect(codes).not.toContain("root_source_defaulted");
  });

  it("fires `no_config_found` when configSource is null (walk-up completed empty)", () => {
    const codes = computeScanWarnings({
      filesScanned: 10,
      rootSource: "explicit",
      configSource: null,
      analysisCoverage: undefined,
      filesByExtension: undefined,
    });
    expect(codes).toContain("no_config_found");
  });

  it("does NOT fire `no_config_found` when configSource is undefined (tool did not attempt resolution)", () => {
    const codes = computeScanWarnings({
      filesScanned: 10,
      rootSource: "explicit",
      configSource: undefined,
      analysisCoverage: undefined,
      filesByExtension: undefined,
    });
    expect(codes).not.toContain("no_config_found");
  });

  it("fires `tailwind_detected_css_undercounted` when the Tailwind hint is present and .css files < 3", () => {
    const codes = computeScanWarnings({
      filesScanned: 60,
      rootSource: "explicit",
      configSource: "/proj/ra11y.config.ts",
      analysisCoverage: {
        hints: [
          "Only 1 CSS file(s) scanned vs 60 JSX/HTML file(s). Tailwind usage detected: run the build...",
        ],
      },
      filesByExtension: { ".tsx": 60, ".css": 1 },
    });
    expect(codes).toContain("tailwind_detected_css_undercounted");
  });

  it("does NOT fire `tailwind_detected_css_undercounted` when Tailwind was detected but CSS coverage is fine", () => {
    const codes = computeScanWarnings({
      filesScanned: 60,
      rootSource: "explicit",
      configSource: "/proj/ra11y.config.ts",
      analysisCoverage: {
        hints: ["Tailwind usage detected: run the build..."],
      },
      filesByExtension: { ".tsx": 60, ".css": 5 },
    });
    expect(codes).not.toContain("tailwind_detected_css_undercounted");
  });

  it("does NOT fire `tailwind_detected_css_undercounted` when hints exist but none name Tailwind", () => {
    const codes = computeScanWarnings({
      filesScanned: 60,
      rootSource: "explicit",
      configSource: "/proj/ra11y.config.ts",
      analysisCoverage: {
        hints: ["Build the site and point scan at the emitted .css..."],
      },
      filesByExtension: { ".tsx": 60 },
    });
    expect(codes).not.toContain("tailwind_detected_css_undercounted");
  });

  it("fires `template_files_parsed_as_literal` when templateDirectivesFound is populated", () => {
    const codes = computeScanWarnings({
      filesScanned: 5,
      rootSource: "explicit",
      configSource: "/proj/ra11y.config.ts",
      analysisCoverage: {
        templateDirectivesFound: ["jinja-or-liquid"],
      },
      filesByExtension: { ".html": 5 },
    });
    expect(codes).toContain("template_files_parsed_as_literal");
  });

  it("does NOT fire `template_files_parsed_as_literal` when templateDirectivesFound is empty/absent", () => {
    const codes = computeScanWarnings({
      filesScanned: 5,
      rootSource: "explicit",
      configSource: "/proj/ra11y.config.ts",
      analysisCoverage: { templateDirectivesFound: [] },
      filesByExtension: { ".html": 5 },
    });
    expect(codes).not.toContain("template_files_parsed_as_literal");
  });

  it("preserves declaration order when multiple codes fire at once — the Leela-class silent-failure stack", () => {
    const codes = computeScanWarnings({
      filesScanned: 0,
      rootSource: "spawn-cwd",
      configSource: null,
      analysisCoverage: undefined,
      filesByExtension: undefined,
    });
    expect([...codes]).toEqual(["scanned_zero_files", "root_source_defaulted", "no_config_found"]);
  });

  it("fires `scanned_build_artifacts_present` when the caller signals that the detector labeled ≥1 file", () => {
    const codes = computeScanWarnings({
      filesScanned: 42,
      rootSource: "explicit",
      configSource: "/proj/ra11y.config.ts",
      analysisCoverage: undefined,
      filesByExtension: { ".css": 2 },
      scannedBuildArtifactsPresent: true,
    });
    expect(codes).toContain("scanned_build_artifacts_present");
  });

  it("does NOT fire `scanned_build_artifacts_present` when the flag is false (hand-written CSS only)", () => {
    const codes = computeScanWarnings({
      filesScanned: 42,
      rootSource: "explicit",
      configSource: "/proj/ra11y.config.ts",
      analysisCoverage: undefined,
      filesByExtension: { ".css": 2 },
      scannedBuildArtifactsPresent: false,
    });
    expect(codes).not.toContain("scanned_build_artifacts_present");
  });

  it("does NOT fire `scanned_build_artifacts_present` when the flag is omitted (tool doesn't run the detector)", () => {
    const codes = computeScanWarnings({
      filesScanned: 42,
      rootSource: "explicit",
      configSource: "/proj/ra11y.config.ts",
      analysisCoverage: undefined,
      filesByExtension: { ".css": 2 },
    });
    expect(codes).not.toContain("scanned_build_artifacts_present");
  });
});

describe("warningsFromScanMeta", () => {
  it("reads filesScanned + analysisCoverage + filesByExtension out of a formatted.meta block", () => {
    const codes = warningsFromScanMeta({
      meta: {
        filesScanned: 60,
        filesByExtension: { ".tsx": 60, ".css": 1 },
        analysisCoverage: {
          hints: ["Tailwind usage detected: run the build"],
        },
      },
      rootSource: "explicit",
      configSource: "/proj/ra11y.config.ts",
    });
    expect(codes).toContain("tailwind_detected_css_undercounted");
  });

  it("returns an empty array when the meta block is empty and no other warning conditions hold", () => {
    const codes = warningsFromScanMeta({
      meta: { filesScanned: 10 },
      rootSource: "explicit",
      configSource: "/proj/ra11y.config.ts",
    });
    expect(codes).toEqual([]);
  });

  it("fires `storybook_preset_active` when the preset flag is set", () => {
    const codes = computeScanWarnings({
      filesScanned: 10,
      rootSource: "explicit",
      configSource: "/proj/ra11y.config.ts",
      analysisCoverage: undefined,
      filesByExtension: undefined,
      storybookPresetActive: true,
    });
    expect(codes).toContain("storybook_preset_active");
  });

  it("does not fire `storybook_preset_active` when the flag is absent or false", () => {
    const codesAbsent = computeScanWarnings({
      filesScanned: 10,
      rootSource: "explicit",
      configSource: "/proj/ra11y.config.ts",
      analysisCoverage: undefined,
      filesByExtension: undefined,
    });
    expect(codesAbsent).not.toContain("storybook_preset_active");

    const codesFalse = computeScanWarnings({
      filesScanned: 10,
      rootSource: "explicit",
      configSource: "/proj/ra11y.config.ts",
      analysisCoverage: undefined,
      filesByExtension: undefined,
      storybookPresetActive: false,
    });
    expect(codesFalse).not.toContain("storybook_preset_active");
  });
});
