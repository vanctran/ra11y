#!/usr/bin/env bun
/**
 * Benchmark runner for the a11y-tool comparison matrix.
 *
 * Scope (this revision): ra11y-self only. Runs the real scanner —
 * parsing + rule execution + review-candidate pipeline — against every
 * fixture under `tests/fixtures/real-world/` plus the three synthetic
 * corpus sizes (10 / 100 / 1000 files) that the comparison doc calls
 * out under "Performance (wall clock)". Competitor tools (axe-core,
 * pa11y, eslint-plugin-jsx-a11y) stay "pending" — they require their
 * own installs as isolated dev deps and land in a follow-up.
 *
 * Outputs:
 *   1. `benchmarks/data/ra11y-<date>.json` — a machine-readable record
 *      of the measurement. `ra11y-<date>.json` (not `latest.json`) so
 *      runs aren't clobbered silently; the comparison doc names the
 *      file it was generated from in its footer.
 *   2. Stdout summary table — for humans running the script locally.
 *   3. With `--update-doc`: rewrites the ra11y column cells in
 *      `benchmarks/a11y-tool-comparison.md`. Competitor cells stay
 *      "pending" untouched.
 *
 * Design notes (CLAUDE.md-relevant):
 *   - No new deps: Bun built-ins + what the test harness already uses.
 *   - No magic numbers: named constants for iteration counts and the
 *     synthetic-corpus sizes; fixture file count is measured at runtime.
 *   - `console.*` is acceptable in scripts/ per CLAUDE.md §3 / §17.
 *   - Paths computed from `import.meta.dir` so the script works when
 *     invoked from any cwd (matching the convention in `bench.ts`,
 *     `verify.ts`, `check-limits.ts`).
 *   - Reuses the real-world harness for fixture discovery + scanning
 *     so bench numbers reflect the same pipeline fixtures test against.
 *
 * Usage:
 *   bun scripts/benchmark-run.ts             # measure + write JSON
 *   bun scripts/benchmark-run.ts --update-doc # also rewrite the doc
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ParsedFile, runScan } from "../src/engine/scanner.ts";
import { parseHtml } from "../src/input/parsers/html.ts";
import { parseTsx } from "../src/input/parsers/tsx.ts";
import { BUILTIN_CANDIDATE_FINDERS } from "../src/review/index.ts";
import { BUILTIN_RULES } from "../src/rules/index.ts";
import { BUILTIN_STANDARDS } from "../src/standards/index.ts";
import {
  type DiscoveredFixture,
  discoverFixtures,
  loadAndScanFixture,
  loadAssertions,
} from "../tests/fixtures/real-world/runner.ts";

const ROOT = join(import.meta.dir ?? process.cwd(), "..");
const REAL_WORLD_DIR = join(ROOT, "tests/fixtures/real-world");
const DATA_DIR = join(ROOT, "benchmarks/data");
const DOC_PATH = join(ROOT, "benchmarks/a11y-tool-comparison.md");

/** Iterations per synthetic scenario; odd so median is unambiguous. */
const SYNTHETIC_ITERATIONS = 11;
/** Iterations for the cold-start subprocess measurement. */
const COLD_START_ITERATIONS = 5;
/** Synthetic corpus sizes matching the comparison-doc perf rows. */
const SYNTHETIC_SIZES = [10, 100, 1000] as const;
/** Characters to pad the "files" column in the summary table. */
const FILES_COL_WIDTH = 7;
/** Minimum column width for numeric table cells. */
const MIN_NUM_COL = 6;

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

interface FixtureMeasurement {
  readonly id: string;
  readonly filesScanned: number;
  readonly violations: {
    readonly total: number;
    readonly error: number;
    readonly warning: number;
    readonly info: number;
  };
  readonly reviewCandidates: number;
  readonly durationMs: number;
}

interface SyntheticMeasurement {
  readonly fileCount: number;
  readonly samples: readonly number[];
  readonly medianMs: number;
  readonly minMs: number;
  readonly maxMs: number;
}

interface ColdStartMeasurement {
  readonly samples: readonly number[];
  readonly medianMs: number;
  readonly minMs: number;
  readonly maxMs: number;
}

interface BenchmarkRecord {
  readonly tool: "ra11y";
  /** Full-precision ISO 8601 UTC timestamp. */
  readonly generatedAt: string;
  /** Local-time YYYY-MM-DD — used for filenames + the doc's disclosure note. */
  readonly generatedAtLocalDate: string;
  readonly generator: string;
  readonly coldStart: ColdStartMeasurement;
  readonly synthetic: readonly SyntheticMeasurement[];
  readonly realWorld: {
    readonly fixtures: readonly FixtureMeasurement[];
    readonly totalFiles: number;
    readonly totalViolations: number;
    readonly totalCandidates: number;
    readonly totalDurationMs: number;
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const updateDoc = process.argv.includes("--update-doc");

const record = await run();
const jsonPath = writeDataFile(record);
printSummary(record, jsonPath);
if (updateDoc) {
  updateComparisonDoc(record);
  console.log(`\n✓ updated ${DOC_PATH}`);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function run(): Promise<BenchmarkRecord> {
  const fixtures = await measureRealWorldFixtures();
  const synthetic = measureSyntheticSizes();
  const coldStart = measureColdStart();
  const totalFiles = fixtures.reduce((s, f) => s + f.filesScanned, 0);
  const totalViolations = fixtures.reduce((s, f) => s + f.violations.total, 0);
  const totalCandidates = fixtures.reduce((s, f) => s + f.reviewCandidates, 0);
  const totalDurationMs = fixtures.reduce((s, f) => s + f.durationMs, 0);
  return {
    tool: "ra11y",
    generatedAt: new Date().toISOString(),
    generatedAtLocalDate: localDateStamp(new Date()),
    generator: "scripts/benchmark-run.ts",
    coldStart,
    synthetic,
    realWorld: {
      fixtures,
      totalFiles,
      totalViolations,
      totalCandidates,
      totalDurationMs,
    },
  };
}

async function measureRealWorldFixtures(): Promise<readonly FixtureMeasurement[]> {
  const discovered = discoverFixtures(REAL_WORLD_DIR);
  const out: FixtureMeasurement[] = [];
  for (const fixture of discovered) {
    out.push(await measureOneFixture(fixture));
  }
  return out;
}

async function measureOneFixture(fixture: DiscoveredFixture): Promise<FixtureMeasurement> {
  // Honor the fixture's declared toolInput — some fixtures only make
  // sense with autoDetectWrappers on, verboseMeta on, etc. Bench
  // numbers should reflect the scan shape the fixture actually tests.
  const assertions = await loadAssertions(fixture);
  const start = performance.now();
  const ctx = await loadAndScanFixture(fixture, assertions.toolInput ?? {});
  const durationMs = performance.now() - start;
  const vs = ctx.result.violations;
  return {
    id: fixture.id,
    filesScanned: ctx.files.length,
    violations: {
      total: vs.length,
      error: vs.filter((v) => v.severity === "error").length,
      warning: vs.filter((v) => v.severity === "warning").length,
      info: vs.filter((v) => v.severity === "info").length,
    },
    reviewCandidates: (ctx.report.candidates ?? []).length,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Synthetic corpus
// ---------------------------------------------------------------------------

function measureSyntheticSizes(): readonly SyntheticMeasurement[] {
  return SYNTHETIC_SIZES.map(measureOneSize);
}

function measureOneSize(fileCount: number): SyntheticMeasurement {
  const files = buildSyntheticFiles(fileCount);
  // Warm-up pass primes the JIT the same way scripts/bench.ts does.
  runOneSyntheticScan(files);
  const samples: number[] = [];
  for (let i = 0; i < SYNTHETIC_ITERATIONS; i += 1) {
    samples.push(runOneSyntheticScan(files));
  }
  samples.sort((a, b) => a - b);
  return {
    fileCount,
    samples,
    medianMs: samples[Math.floor(samples.length / 2)] ?? 0,
    minMs: samples[0] ?? 0,
    maxMs: samples[samples.length - 1] ?? 0,
  };
}

function runOneSyntheticScan(files: readonly ParsedFile[]): number {
  const start = performance.now();
  runScan({
    standards: [...BUILTIN_STANDARDS],
    rules: [...BUILTIN_RULES],
    enabled: ["wcag22"],
    files,
    finders: BUILTIN_CANDIDATE_FINDERS,
  });
  return performance.now() - start;
}

/**
 * Generates `count` parsed files alternating HTML and TSX. Mirrors
 * the shape used by `scripts/bench.ts` so the two benches cover the
 * same ground — parsing happens once up front, the measurement is
 * the engine's hot path plus finder evaluation.
 */
function buildSyntheticFiles(count: number): readonly ParsedFile[] {
  const out: ParsedFile[] = [];
  for (let i = 0; i < count; i += 1) {
    if (i % 2 === 0) {
      const source = htmlTemplate(i);
      const parsed = parseHtml(source);
      out.push({
        filePath: `synthetic/bench-${i}.html`,
        source,
        ast: { language: "html", root: parsed.root, errors: parsed.errors },
      });
    } else {
      const source = tsxTemplate(i);
      const parsed = parseTsx(source);
      out.push({
        filePath: `synthetic/bench-${i}.tsx`,
        source,
        ast: { language: "tsx", root: parsed.root, errors: parsed.errors },
      });
    }
  }
  return out;
}

function htmlTemplate(i: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Page ${i}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
  <header><h1>Page ${i}</h1></header>
  <main>
    <article>
      <h2>Section</h2>
      <p><img src="hero-${i}.png" alt="Hero illustration"></p>
      <form>
        <label for="email-${i}">Email</label>
        <input id="email-${i}" type="email" autocomplete="email">
        <button type="submit">Subscribe</button>
      </form>
    </article>
    <figure><img src="photo-${i}.jpg"><figcaption>cap</figcaption></figure>
  </main>
</body>
</html>`;
}

function tsxTemplate(i: number): string {
  return `import { type ReactNode } from "react";
interface P { readonly title: string; readonly children: ReactNode; }
export function Card${i}(p: P) {
  return (
    <section aria-labelledby="h-${i}">
      <h2 id="h-${i}">{p.title}</h2>
      <img src="t-${i}.png" alt={p.title} />
      <button type="button" aria-label="Open">
        <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M0 0h16v16H0z"/></svg>
      </button>
      <a href="/d/${i}">Read more</a>
    </section>
  );
}
`;
}

// ---------------------------------------------------------------------------
// Cold start
// ---------------------------------------------------------------------------

function measureColdStart(): ColdStartMeasurement {
  const samples: number[] = [];
  for (let i = 0; i < COLD_START_ITERATIONS; i += 1) {
    samples.push(runOneColdStart());
  }
  samples.sort((a, b) => a - b);
  return {
    samples,
    medianMs: samples[Math.floor(samples.length / 2)] ?? 0,
    minMs: samples[0] ?? 0,
    maxMs: samples[samples.length - 1] ?? 0,
  };
}

function runOneColdStart(): number {
  const start = performance.now();
  const result = spawnSync("bun", ["src/cli.ts", "--version"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const elapsed = performance.now() - start;
  if (result.status !== 0) {
    console.error("cold-start: CLI spawn failed:", result.stderr?.toString());
    return Number.POSITIVE_INFINITY;
  }
  return elapsed;
}

// ---------------------------------------------------------------------------
// Output — JSON record
// ---------------------------------------------------------------------------

function writeDataFile(record: BenchmarkRecord): string {
  mkdirSync(DATA_DIR, { recursive: true });
  const jsonPath = join(DATA_DIR, `ra11y-${record.generatedAtLocalDate}.json`);
  writeFileSync(jsonPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return jsonPath;
}

/**
 * Formats `d` as `YYYY-MM-DD` in the local timezone. Using the local
 * date for the filename + doc-note stamp keeps the displayed date
 * aligned with what a developer on a North American timezone sees on
 * their clock when they run the script in the evening.
 */
function localDateStamp(d: Date): string {
  const year = String(d.getFullYear()).padStart(4, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ---------------------------------------------------------------------------
// Output — stdout summary
// ---------------------------------------------------------------------------

function printSummary(record: BenchmarkRecord, jsonPath: string): void {
  console.log("\nra11y benchmark — real-world fixtures");
  console.log("─".repeat(72));
  printFixtureTable(record.realWorld.fixtures);
  const rw = record.realWorld;
  console.log(
    `\n  total: ${rw.fixtures.length} fixture(s), ${rw.totalFiles} file(s), ${rw.totalViolations} violation(s), ${rw.totalCandidates} review candidate(s), ${rw.totalDurationMs.toFixed(1)}ms cumulative`,
  );
  console.log("\nra11y benchmark — synthetic corpus (comparison-doc sizes)");
  console.log("─".repeat(72));
  printSyntheticTable(record.synthetic);
  console.log("\nra11y benchmark — cold start (bun src/cli.ts --version)");
  console.log("─".repeat(72));
  const cs = record.coldStart;
  console.log(
    `  ${COLD_START_ITERATIONS} iterations · median ${cs.medianMs.toFixed(1)}ms · min ${cs.minMs.toFixed(1)}ms · max ${cs.maxMs.toFixed(1)}ms`,
  );
  console.log(`\n✓ wrote ${jsonPath}`);
}

function printFixtureTable(fixtures: readonly FixtureMeasurement[]): void {
  const header = {
    id: "fixture",
    files: "files",
    violations: "viol(e/w/i)",
    candidates: "cand",
    duration: "ms",
  };
  const rows = fixtures.map((f) => ({
    id: f.id,
    files: String(f.filesScanned),
    violations: `${f.violations.total} (${f.violations.error}/${f.violations.warning}/${f.violations.info})`,
    candidates: String(f.reviewCandidates),
    duration: f.durationMs.toFixed(1),
  }));
  const widths = columnWidths(header, rows);
  printRow(header, widths);
  printRow(
    {
      id: "-".repeat(widths.id),
      files: "-".repeat(widths.files),
      violations: "-".repeat(widths.violations),
      candidates: "-".repeat(widths.candidates),
      duration: "-".repeat(widths.duration),
    },
    widths,
  );
  for (const row of rows) printRow(row, widths);
}

function printSyntheticTable(rows: readonly SyntheticMeasurement[]): void {
  console.log(
    `  ${"files".padEnd(FILES_COL_WIDTH)}  ${"median".padStart(MIN_NUM_COL)}  ${"min".padStart(MIN_NUM_COL)}  ${"max".padStart(MIN_NUM_COL)}`,
  );
  console.log(
    `  ${"-".repeat(FILES_COL_WIDTH)}  ${"-".repeat(MIN_NUM_COL)}  ${"-".repeat(MIN_NUM_COL)}  ${"-".repeat(MIN_NUM_COL)}`,
  );
  for (const r of rows) {
    console.log(
      `  ${String(r.fileCount).padEnd(FILES_COL_WIDTH)}  ${`${r.medianMs.toFixed(1)}ms`.padStart(MIN_NUM_COL)}  ${`${r.minMs.toFixed(1)}ms`.padStart(MIN_NUM_COL)}  ${`${r.maxMs.toFixed(1)}ms`.padStart(MIN_NUM_COL)}`,
    );
  }
}

interface TableRow {
  readonly id: string;
  readonly files: string;
  readonly violations: string;
  readonly candidates: string;
  readonly duration: string;
}
interface TableWidths {
  readonly id: number;
  readonly files: number;
  readonly violations: number;
  readonly candidates: number;
  readonly duration: number;
}

function columnWidths(header: TableRow, rows: readonly TableRow[]): TableWidths {
  const all = [header, ...rows];
  return {
    id: Math.max(...all.map((r) => r.id.length)),
    files: Math.max(...all.map((r) => r.files.length)),
    violations: Math.max(...all.map((r) => r.violations.length)),
    candidates: Math.max(...all.map((r) => r.candidates.length)),
    duration: Math.max(...all.map((r) => r.duration.length)),
  };
}

function printRow(row: TableRow, w: TableWidths): void {
  console.log(
    `  ${row.id.padEnd(w.id)}  ${row.files.padStart(w.files)}  ${row.violations.padStart(w.violations)}  ${row.candidates.padStart(w.candidates)}  ${row.duration.padStart(w.duration)}`,
  );
}

// ---------------------------------------------------------------------------
// Output — doc rewrite
// ---------------------------------------------------------------------------

/**
 * Rewrites the ra11y column in `benchmarks/a11y-tool-comparison.md`.
 *
 * Strategy: the doc's numeric tables have stable row labels and the
 * ra11y column is always the rightmost cell. We match by row label,
 * replace only the final cell, and leave competitor cells ("pending")
 * untouched. A top-of-section generation note is inserted or refreshed.
 */
function updateComparisonDoc(record: BenchmarkRecord): void {
  const original = readFileSync(DOC_PATH, "utf8");
  const bySize = new Map<number, SyntheticMeasurement>();
  for (const s of record.synthetic) bySize.set(s.fileCount, s);

  const replacements: readonly DocReplacement[] = [
    {
      rowLabelRe: /^(\|\s*Time to first scan \(cold\)\s*\|[^\n]*\|)\s*pending\s*\|\s*$/m,
      newCell: formatMs(record.coldStart.medianMs),
    },
    ...SYNTHETIC_SIZES.map((size) => ({
      rowLabelRe: new RegExp(
        `^(\\|\\s*${size} files[^|]*\\|[^\\n]*\\|)\\s*pending\\s*\\|\\s*$`,
        "m",
      ),
      newCell: formatMs(bySize.get(size)?.medianMs ?? Number.NaN),
    })),
  ];

  let updated = original;
  for (const rep of replacements) {
    updated = updated.replace(rep.rowLabelRe, (_m, prefix) => `${prefix} ${rep.newCell} |`);
  }

  updated = stampGenerationNote(updated, record);
  writeFileSync(DOC_PATH, updated, "utf8");
}

interface DocReplacement {
  readonly rowLabelRe: RegExp;
  readonly newCell: string;
}

function formatMs(n: number): string {
  if (!Number.isFinite(n)) return "pending";
  return `${n.toFixed(1)}ms`;
}

/**
 * Inserts or refreshes a short disclosure note after the document's
 * H1 `# a11y tool comparison` line. Idempotent: if the note exists,
 * its date + filename are replaced in-place; otherwise it's injected.
 */
function stampGenerationNote(content: string, record: BenchmarkRecord): string {
  const date = record.generatedAtLocalDate;
  const filename = `ra11y-${date}.json`;
  const note = `> **ra11y-column numbers** generated by \`scripts/benchmark-run.ts\` on ${date} (source: \`benchmarks/data/${filename}\`). Competitor numbers remain pending a separate pass that adds the comparison tools as isolated dev deps.`;
  const existingRe = /^> \*\*ra11y-column numbers\*\*[^\n]*\n/m;
  if (existingRe.test(content)) {
    return content.replace(existingRe, `${note}\n`);
  }
  // Insert the note right after the leading "Status: scaffold" blockquote
  // paragraph so both advisories sit together.
  const anchor =
    /^(> \*\*Status: scaffold\.\*\*[\s\S]*?numeric cells from this document until that PR lands\.\n)/m;
  if (anchor.test(content)) {
    return content.replace(anchor, `$1>\n${note}\n`);
  }
  // Fallback: insert after the top-level H1.
  return content.replace(/^(# a11y tool comparison\n)/, `$1\n${note}\n`);
}
