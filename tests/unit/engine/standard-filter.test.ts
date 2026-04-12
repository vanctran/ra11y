import { describe, expect, it } from "bun:test";
import { defineRule, defineStandard } from "../../../src/api/plugin.ts";
import { CriteriaRegistry } from "../../../src/engine/registry/criteria.ts";
import { createStandardFilter } from "../../../src/engine/standard-filter.ts";

// Small synthetic standards so the filter test is hermetic — we don't
// want to depend on the full wcag22 module here, just the filter logic.
const alpha = defineStandard({
  id: "alpha",
  name: "Alpha",
  version: "1.0",
  publisher: "Test",
  url: "https://example.com/alpha",
  levels: ["A"],
  criteria: [
    {
      id: "alpha:1.1",
      standardId: "alpha",
      localId: "1.1",
      title: "Alpha 1.1",
      level: "A",
      description: "…",
      url: "https://example.com/alpha#1.1",
      automatable: "partial",
      equivalentTo: ["beta:1.1"],
    },
  ],
});

const beta = defineStandard({
  id: "beta",
  name: "Beta",
  version: "1.0",
  publisher: "Test",
  url: "https://example.com/beta",
  levels: ["A"],
  criteria: [
    {
      id: "beta:1.1",
      standardId: "beta",
      localId: "1.1",
      title: "Beta 1.1",
      level: "A",
      description: "…",
      url: "https://example.com/beta#1.1",
      automatable: "partial",
    },
  ],
});

const ruleSatisfyingAlpha = defineRule({
  id: "test/rule-a",
  satisfies: ["alpha:1.1"],
  severity: "error",
  scope: "node",
  docs: {
    description: "",
    rationale: "",
    goodExample: "",
    badExample: "",
    references: [],
  },
  check() {
    // synthetic rule for filter unit tests — no body needed
    return undefined;
  },
});

describe("createStandardFilter", () => {
  it("activates a rule when the enabled standards contain any satisfies entry", () => {
    const criteria = new CriteriaRegistry();
    criteria.rebuild([alpha, beta]);
    const filter = createStandardFilter(new Set(["alpha"]), criteria);
    expect(filter.isRuleActive(ruleSatisfyingAlpha)).toBe(true);
  });

  it("activates a rule via equivalentTo from a sibling standard", () => {
    const criteria = new CriteriaRegistry();
    criteria.rebuild([alpha, beta]);
    // Enable beta only — the rule declares satisfies alpha:1.1, but alpha:1.1
    // is equivalentTo beta:1.1, so the filter should reach the rule via the
    // reciprocal closure.
    const filter = createStandardFilter(new Set(["beta"]), criteria);
    expect(filter.isRuleActive(ruleSatisfyingAlpha)).toBe(true);
  });

  it("cites only criteria belonging to enabled standards", () => {
    const criteria = new CriteriaRegistry();
    criteria.rebuild([alpha, beta]);
    const filter = createStandardFilter(new Set(["beta"]), criteria);
    const cited = filter.citedCriteria(ruleSatisfyingAlpha);
    expect(cited).toEqual(["beta:1.1"]);
  });

  it("cites both standards when both are enabled", () => {
    const criteria = new CriteriaRegistry();
    criteria.rebuild([alpha, beta]);
    const filter = createStandardFilter(new Set(["alpha", "beta"]), criteria);
    const cited = filter.citedCriteria(ruleSatisfyingAlpha);
    expect([...cited].sort()).toEqual(["alpha:1.1", "beta:1.1"]);
  });

  it("deactivates a rule when no enabled standard reaches any satisfies entry", () => {
    const criteria = new CriteriaRegistry();
    criteria.rebuild([alpha, beta]);
    const filter = createStandardFilter(new Set([]), criteria);
    expect(filter.isRuleActive(ruleSatisfyingAlpha)).toBe(false);
  });
});
