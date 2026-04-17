/**
 * Unit tests for `pruneBaseline`. File existence is driven by an
 * injected predicate so the matrix stays deterministic without a
 * real FS.
 */

import { describe, expect, it } from "bun:test";
import {
  type BaselineEntry,
  type BaselineFile,
  pruneBaseline,
} from "../../../src/engine/baseline.ts";

const SCAN_ROOT = "/tmp/fake-project";

function entry(filePath: string, ruleId = "media/alt-text-missing"): BaselineEntry {
  return {
    hash: `hash-${filePath}`,
    ruleId,
    filePath,
    message: `violation in ${filePath}`,
  };
}

function baseline(entries: readonly BaselineEntry[]): BaselineFile {
  return {
    version: 1,
    generatedAt: "2026-04-17T00:00:00Z",
    ra11yVersion: "0.0.0",
    standards: ["wcag22"],
    violations: entries,
  };
}

const aliveIn = (paths: readonly string[]) => {
  const alive = new Set(paths);
  return (p: string) => alive.has(p.replace(`${SCAN_ROOT}/`, ""));
};

describe("pruneBaseline", () => {
  it("no-op when every file still exists", () => {
    const file = baseline([entry("src/a.tsx"), entry("src/b.tsx"), entry("src/c.tsx")]);
    const r = pruneBaseline(file, SCAN_ROOT, aliveIn(["src/a.tsx", "src/b.tsx", "src/c.tsx"]));
    expect(r.removed).toEqual([]);
    expect(r.kept).toHaveLength(3);
  });

  it("drops a single dead entry", () => {
    const file = baseline([
      entry("src/a.tsx"),
      entry("src/gone.tsx", "aria/label-missing"),
      entry("src/b.tsx"),
    ]);
    const r = pruneBaseline(file, SCAN_ROOT, aliveIn(["src/a.tsx", "src/b.tsx"]));
    expect(r.removed).toHaveLength(1);
    expect(r.removed[0]?.filePath).toBe("src/gone.tsx");
    expect(r.kept).toHaveLength(2);
  });

  it("no-op on empty baseline", () => {
    const r = pruneBaseline(baseline([]), SCAN_ROOT, () => true);
    expect(r.removed).toEqual([]);
    expect(r.kept).toEqual([]);
  });

  it("removes every entry when all files are dead", () => {
    const file = baseline([entry("src/a.tsx"), entry("src/b.tsx"), entry("src/c.tsx")]);
    const r = pruneBaseline(file, SCAN_ROOT, () => false);
    expect(r.removed).toHaveLength(3);
    expect(r.kept).toEqual([]);
  });

  it("preserves baseline metadata unchanged", () => {
    // Prune is file-existence filtering only; the baseline header
    // round-trips exactly so downstream consumers don't see churn.
    const file: BaselineFile = {
      version: 1,
      generatedAt: "2026-04-17T12:34:56Z",
      ra11yVersion: "0.9.1",
      standards: ["wcag22", "section508"],
      violations: [entry("src/a.tsx"), entry("src/gone.tsx")],
    };
    const r = pruneBaseline(file, SCAN_ROOT, aliveIn(["src/a.tsx"]));
    expect(r.pruned.version).toBe(1);
    expect(r.pruned.generatedAt).toBe("2026-04-17T12:34:56Z");
    expect(r.pruned.ra11yVersion).toBe("0.9.1");
    expect(r.pruned.standards).toEqual(["wcag22", "section508"]);
  });

  it("preserves order of retained entries (filter, not sort)", () => {
    const file = baseline([entry("a/first.tsx"), entry("b/gone.tsx"), entry("c/third.tsx")]);
    const r = pruneBaseline(file, SCAN_ROOT, aliveIn(["a/first.tsx", "c/third.tsx"]));
    expect(r.kept.map((e) => e.filePath)).toEqual(["a/first.tsx", "c/third.tsx"]);
  });
});
