#!/usr/bin/env bun
/**
 * Performance benchmarks for ra11y.
 *
 * Budgets per CLAUDE.md §13:
 *   - Cold start (spawn → first result)    ≤ 200 ms
 *   - 10 files, ~1k LOC                    ≤ 100 ms
 *   - 100 files, ~10k LOC                  ≤ 500 ms
 *   - 1000 files, ~100k LOC                ≤ 3000 ms
 *
 * Each scenario runs multiple iterations, reports min/median/mean/max,
 * and fails the build if the median exceeds the budget. The median
 * (not the min) is what matters — minimum times reflect best-case
 * JIT behavior, medians reflect realistic user experience.
 *
 * Usage:
 *   bun scripts/bench.ts           # run all scenarios, exit non-zero on regression
 *   bun scripts/bench.ts --json    # machine-readable output for CI
 *
 * The scan itself uses the real engine — `runScan` from
 * `src/engine/scanner.ts` — against synthetic in-memory parsed files.
 * File-system I/O is deliberately excluded: we want to measure the
 * engine's hot path, not the disk. Cold-start is measured separately
 * by spawning the CLI as a subprocess and timing end-to-end.
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { type ParsedFile, runScan } from "../src/engine/scanner.ts";
import { parseHtml } from "../src/input/parsers/html.ts";
import { parseTsx } from "../src/input/parsers/tsx.ts";
import { BUILTIN_RULES } from "../src/rules/index.ts";
import { BUILTIN_STANDARDS } from "../src/standards/index.ts";

const ROOT = join(import.meta.dir ?? process.cwd(), "..");
const ITERATIONS = 11; // odd so the median is unambiguous

interface Scenario {
  readonly name: string;
  readonly budgetMs: number;
  run(): number;
}

interface Result {
  readonly name: string;
  readonly budgetMs: number;
  readonly samples: readonly number[];
  readonly min: number;
  readonly median: number;
  readonly mean: number;
  readonly max: number;
  readonly passed: boolean;
}

const jsonMode = process.argv.includes("--json");

const scenarios: Scenario[] = [
  makeEngineScenario("10 files, ~1k LOC", 10, 100),
  makeEngineScenario("100 files, ~10k LOC", 100, 500),
  makeEngineScenario("1000 files, ~100k LOC", 1000, 3000),
  {
    name: "cold start (spawn → first result)",
    budgetMs: 200,
    run: () => measureColdStart(),
  },
];

const results: Result[] = scenarios.map(runScenario);

if (jsonMode) {
  console.log(JSON.stringify(results, null, 2));
} else {
  printTable(results);
}

const failed = results.filter((r) => !r.passed);
if (failed.length > 0) {
  if (!jsonMode) {
    console.error(`\n✗ ${failed.length} scenario(s) over budget`);
  }
  process.exit(1);
}

if (!jsonMode) console.log("\n✓ all scenarios under budget");
process.exit(0);

// ---------------------------------------------------------------------------

function runScenario(scenario: Scenario): Result {
  const samples: number[] = [];
  // One warm-up pass to prime the JIT and fill caches.
  scenario.run();
  for (let i = 0; i < ITERATIONS; i += 1) {
    samples.push(scenario.run());
  }
  samples.sort((a, b) => a - b);
  const min = samples[0] ?? 0;
  const max = samples[samples.length - 1] ?? 0;
  const median = samples[Math.floor(samples.length / 2)] ?? 0;
  const mean = samples.reduce((s, n) => s + n, 0) / samples.length;
  return {
    name: scenario.name,
    budgetMs: scenario.budgetMs,
    samples,
    min,
    median,
    mean,
    max,
    passed: median <= scenario.budgetMs,
  };
}

function makeEngineScenario(name: string, fileCount: number, budgetMs: number): Scenario {
  const files = buildSyntheticFiles(fileCount);
  return {
    name,
    budgetMs,
    run: () => {
      const start = performance.now();
      runScan({
        standards: [...BUILTIN_STANDARDS],
        rules: [...BUILTIN_RULES],
        enabled: ["wcag22"],
        files,
      });
      return performance.now() - start;
    },
  };
}

/**
 * Builds `count` parsed files alternating HTML and TSX. Each file is
 * ~100 LOC with a realistic sprinkle of violations so rules actually
 * fire. Parsing happens once up front — the benchmark measures the
 * engine's rule-execution hot path, not the parser.
 */
function buildSyntheticFiles(count: number): readonly ParsedFile[] {
  const out: ParsedFile[] = [];
  for (let i = 0; i < count; i += 1) {
    if (i % 2 === 0) {
      const source = htmlTemplate(i);
      const parsed = parseHtml(source);
      out.push({
        filePath: `fixtures/bench-${i}.html`,
        source,
        ast: { language: "html", root: parsed.root, errors: parsed.errors },
      });
    } else {
      const source = tsxTemplate(i);
      const parsed = parseTsx(source);
      out.push({
        filePath: `fixtures/bench-${i}.tsx`,
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
  <header>
    <h1>Welcome to page ${i}</h1>
    <nav>
      <ul>
        <li><a href="/home">Home</a></li>
        <li><a href="/about">About</a></li>
        <li><a href="/contact">Contact</a></li>
      </ul>
    </nav>
  </header>
  <main>
    <article>
      <h2>Section one</h2>
      <p>Some prose with an image: <img src="hero-${i}.png" alt="Hero illustration"></p>
      <p>A link that reads <a href="/more">learn more</a> — intentionally vague.</p>
      <form>
        <label for="email-${i}">Email</label>
        <input id="email-${i}" type="email" autocomplete="email">
        <button type="submit">Subscribe</button>
      </form>
    </article>
    <article>
      <h2>Section two</h2>
      <p>Another paragraph with <button>click</button> inside.</p>
      <figure>
        <img src="photo-${i}.jpg">
        <figcaption>Missing alt above.</figcaption>
      </figure>
    </article>
  </main>
  <footer>
    <p>Footer text.</p>
  </footer>
</body>
</html>`;
}

function tsxTemplate(i: number): string {
  return `import { type ReactNode } from "react";

interface Props {
  readonly title: string;
  readonly children: ReactNode;
}

export function Card${i}(props: Props) {
  return (
    <section aria-labelledby="heading-${i}">
      <h2 id="heading-${i}">{props.title}</h2>
      <div className="card-body">
        <img src="thumb-${i}.png" alt={props.title} />
        <p>{props.children}</p>
        <button type="button" aria-label="Open card">
          <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
            <path d="M0 0h16v16H0z" />
          </svg>
        </button>
      </div>
      <footer>
        <a href="/details/${i}">Read more</a>
      </footer>
    </section>
  );
}

export function Link${i}(props: { readonly href: string; readonly label: string }) {
  return (
    <a href={props.href} aria-label={props.label}>
      {props.label}
    </a>
  );
}
`;
}

function measureColdStart(): number {
  // Spawn the CLI as a child process and time the complete round-trip.
  // This captures Bun's startup cost, module graph load, and a tiny
  // no-op scan — the user-perceived cold-start latency.
  const start = performance.now();
  const result = spawnSync("bun", ["src/cli.ts", "--version"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const elapsed = performance.now() - start;
  if (result.status !== 0) {
    console.error("✗ cold-start scenario failed to spawn CLI");
    console.error(result.stderr?.toString());
    return Number.POSITIVE_INFINITY;
  }
  return elapsed;
}

function printTable(rs: readonly Result[]): void {
  const rows = rs.map((r) => ({
    scenario: r.name,
    budget: `${r.budgetMs}ms`,
    median: `${r.median.toFixed(1)}ms`,
    min: `${r.min.toFixed(1)}ms`,
    max: `${r.max.toFixed(1)}ms`,
    status: r.passed ? "PASS" : "FAIL",
  }));
  const widths = {
    scenario: Math.max(10, ...rows.map((r) => r.scenario.length)),
    budget: Math.max(6, ...rows.map((r) => r.budget.length)),
    median: Math.max(6, ...rows.map((r) => r.median.length)),
    min: Math.max(5, ...rows.map((r) => r.min.length)),
    max: Math.max(5, ...rows.map((r) => r.max.length)),
  };
  console.log("");
  console.log(
    `  ${pad("scenario", widths.scenario)}  ${pad("budget", widths.budget)}  ${pad("median", widths.median)}  ${pad("min", widths.min)}  ${pad("max", widths.max)}  status`,
  );
  console.log(
    `  ${"-".repeat(widths.scenario)}  ${"-".repeat(widths.budget)}  ${"-".repeat(widths.median)}  ${"-".repeat(widths.min)}  ${"-".repeat(widths.max)}  ------`,
  );
  for (const row of rows) {
    console.log(
      `  ${pad(row.scenario, widths.scenario)}  ${pad(row.budget, widths.budget)}  ${pad(row.median, widths.median)}  ${pad(row.min, widths.min)}  ${pad(row.max, widths.max)}  ${row.status}`,
    );
  }
}

function pad(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - s.length));
}
