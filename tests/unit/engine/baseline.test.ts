import { describe, expect, it } from "bun:test";
import {
  BASELINE_VERSION,
  buildBaselineFile,
  diffAgainstBaseline,
  fingerprint,
} from "../../../src/engine/baseline.ts";
import type { ScanResult, Violation } from "../../../src/types/violation.ts";

function makeViolation(overrides: Partial<Violation> = {}): Violation {
  return {
    ruleId: "media/alt-text-missing",
    criteria: ["wcag22:1.1.1"],
    severity: "error",
    location: { filePath: "src/ui/Card.tsx", line: 12, column: 5 },
    message: "<img> missing alt",
    ...overrides,
  };
}

function makeResult(violations: Violation[]): ScanResult {
  return {
    violations,
    filesScanned: 1,
    durationMs: 0,
    enabledStandards: ["wcag22"],
    isTTY: false,
  };
}

describe("baseline.fingerprint", () => {
  it("produces a stable hex digest", () => {
    const v = makeViolation();
    const hash = fingerprint(v);
    expect(hash).toMatch(/^[0-9a-f]+$/);
    expect(hash.length).toBe(40); // sha1 hex
  });

  it("is independent of line and column", () => {
    const a = fingerprint(makeViolation({ location: { filePath: "a.tsx", line: 1, column: 1 } }));
    const b = fingerprint(makeViolation({ location: { filePath: "a.tsx", line: 99, column: 99 } }));
    expect(a).toBe(b);
  });

  it("normalizes backslashes in file paths", () => {
    const a = fingerprint(
      makeViolation({ location: { filePath: "src/ui/Card.tsx", line: 1, column: 1 } }),
    );
    const b = fingerprint(
      makeViolation({ location: { filePath: "src\\ui\\Card.tsx", line: 1, column: 1 } }),
    );
    expect(a).toBe(b);
  });

  it("differs when message differs", () => {
    const a = fingerprint(makeViolation({ message: "msg A" }));
    const b = fingerprint(makeViolation({ message: "msg B" }));
    expect(a).not.toBe(b);
  });

  it("differs when ruleId differs", () => {
    const a = fingerprint(makeViolation({ ruleId: "rule/a" }));
    const b = fingerprint(makeViolation({ ruleId: "rule/b" }));
    expect(a).not.toBe(b);
  });
});

describe("buildBaselineFile", () => {
  it("writes BASELINE_VERSION in version field", () => {
    const file = buildBaselineFile(makeResult([makeViolation()]));
    expect(file.version).toBe(BASELINE_VERSION);
  });

  it("preserves enabled standards", () => {
    const file = buildBaselineFile(makeResult([makeViolation()]));
    expect(file.standards).toEqual(["wcag22"]);
  });

  it("deduplicates identical violations", () => {
    const file = buildBaselineFile(makeResult([makeViolation(), makeViolation(), makeViolation()]));
    expect(file.violations).toHaveLength(1);
  });

  it("sorts violations by (filePath, ruleId, hash) for stable diffs", () => {
    const file = buildBaselineFile(
      makeResult([
        makeViolation({
          ruleId: "media/alt-text-missing",
          location: { filePath: "z.tsx", line: 1, column: 1 },
        }),
        makeViolation({
          ruleId: "media/alt-text-missing",
          location: { filePath: "a.tsx", line: 1, column: 1 },
        }),
      ]),
    );
    expect(file.violations[0]?.filePath).toBe("a.tsx");
    expect(file.violations[1]?.filePath).toBe("z.tsx");
  });

  it("normalizes file paths in the output", () => {
    const file = buildBaselineFile(
      makeResult([
        makeViolation({
          location: { filePath: "./src/ui/Card.tsx", line: 1, column: 1 },
        }),
      ]),
    );
    expect(file.violations[0]?.filePath).toBe("src/ui/Card.tsx");
  });
});

describe("diffAgainstBaseline", () => {
  it("splits violations into grandfathered vs new", () => {
    const baseline = buildBaselineFile(makeResult([makeViolation({ message: "old" })]));
    const current = makeResult([
      makeViolation({ message: "old" }),
      makeViolation({ message: "new" }),
    ]);
    const diff = diffAgainstBaseline(current, baseline);
    expect(diff.grandfathered).toHaveLength(1);
    expect(diff.newViolations).toHaveLength(1);
    expect(diff.newViolations[0]?.message).toBe("new");
  });

  it("identifies resolved baseline entries", () => {
    const baseline = buildBaselineFile(
      makeResult([makeViolation({ message: "a" }), makeViolation({ message: "b" })]),
    );
    const current = makeResult([makeViolation({ message: "a" })]);
    const diff = diffAgainstBaseline(current, baseline);
    expect(diff.resolved).toHaveLength(1);
    expect(diff.resolved[0]?.message).toBe("b");
  });

  it("reports empty buckets when scan matches baseline exactly", () => {
    const baseline = buildBaselineFile(makeResult([makeViolation()]));
    const current = makeResult([makeViolation()]);
    const diff = diffAgainstBaseline(current, baseline);
    expect(diff.grandfathered).toHaveLength(1);
    expect(diff.newViolations).toHaveLength(0);
    expect(diff.resolved).toHaveLength(0);
  });

  it("catches new violations when baseline is empty", () => {
    const baseline = buildBaselineFile(makeResult([]));
    const current = makeResult([makeViolation()]);
    const diff = diffAgainstBaseline(current, baseline);
    expect(diff.newViolations).toHaveLength(1);
  });

  it("is not sensitive to line-number shifts", () => {
    const baseline = buildBaselineFile(
      makeResult([makeViolation({ location: { filePath: "a.tsx", line: 12, column: 5 } })]),
    );
    const current = makeResult([
      makeViolation({ location: { filePath: "a.tsx", line: 99, column: 5 } }),
    ]);
    const diff = diffAgainstBaseline(current, baseline);
    expect(diff.grandfathered).toHaveLength(1);
    expect(diff.newViolations).toHaveLength(0);
  });
});
