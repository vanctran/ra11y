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

  it("deactivates an AAA-only rule when activeLevel is AA", () => {
    // Regression guard: contrast/enhanced (WCAG 1.4.6 AAA-only) was firing
    // at severity warning under a default AA scan, because level gating
    // wasn't applied at the filter layer.
    const gamma = defineStandard({
      id: "gamma",
      name: "Gamma",
      version: "1.0",
      publisher: "Test",
      url: "https://example.com/gamma",
      levels: ["A", "AA", "AAA"],
      criteria: [
        {
          id: "gamma:9.9",
          standardId: "gamma",
          localId: "9.9",
          title: "Gamma AAA",
          level: "AAA",
          description: "AAA-only criterion",
          url: "https://example.com/gamma#9.9",
          automatable: "full",
        },
      ],
    });
    const aaaOnlyRule = defineRule({
      id: "test/rule-aaa-only",
      satisfies: ["gamma:9.9"],
      severity: "warning",
      scope: "node",
      docs: {
        description: "",
        rationale: "",
        goodExample: "",
        badExample: "",
        references: [],
      },
      check() {
        return undefined;
      },
    });
    const criteria = new CriteriaRegistry();
    criteria.rebuild([gamma]);
    expect(createStandardFilter(new Set(["gamma"]), criteria, "AA").isRuleActive(aaaOnlyRule)).toBe(
      false,
    );
    expect(createStandardFilter(new Set(["gamma"]), criteria, "A").isRuleActive(aaaOnlyRule)).toBe(
      false,
    );
    expect(
      createStandardFilter(new Set(["gamma"]), criteria, "AAA").isRuleActive(aaaOnlyRule),
    ).toBe(true);
    // No level = legacy behavior, rule active regardless of criterion level.
    expect(createStandardFilter(new Set(["gamma"]), criteria).isRuleActive(aaaOnlyRule)).toBe(true);
  });

  it("keeps a rule active when at least one cited criterion is at or below activeLevel", () => {
    // Mixed-level rule: satisfies both an AA and an AAA criterion. Should
    // still run at AA because the AA criterion counts. Cited criteria are
    // unchanged (level gating is about rule activation, not citation).
    const delta = defineStandard({
      id: "delta",
      name: "Delta",
      version: "1.0",
      publisher: "Test",
      url: "https://example.com/delta",
      levels: ["A", "AA", "AAA"],
      criteria: [
        {
          id: "delta:1.1",
          standardId: "delta",
          localId: "1.1",
          title: "Delta AA",
          level: "AA",
          description: "…",
          url: "https://example.com/delta#1.1",
          automatable: "full",
        },
        {
          id: "delta:9.9",
          standardId: "delta",
          localId: "9.9",
          title: "Delta AAA",
          level: "AAA",
          description: "…",
          url: "https://example.com/delta#9.9",
          automatable: "full",
        },
      ],
    });
    const mixedRule = defineRule({
      id: "test/rule-mixed",
      satisfies: ["delta:1.1", "delta:9.9"],
      severity: "warning",
      scope: "node",
      docs: {
        description: "",
        rationale: "",
        goodExample: "",
        badExample: "",
        references: [],
      },
      check() {
        return undefined;
      },
    });
    const criteria = new CriteriaRegistry();
    criteria.rebuild([delta]);
    const filter = createStandardFilter(new Set(["delta"]), criteria, "AA");
    expect(filter.isRuleActive(mixedRule)).toBe(true);
    expect(filter.citedCriteria(mixedRule)).toEqual(["delta:1.1", "delta:9.9"]);
  });

  it("treats Section 508's `base` level as always active regardless of activeLevel", () => {
    // Section 508 has no A/AA/AAA axis; its criteria use level "base".
    // A rule citing a Section-508 base criterion should still fire when
    // the caller asks for level A.
    const s508 = defineStandard({
      id: "s508ish",
      name: "Section508-ish",
      version: "1.0",
      publisher: "Test",
      url: "https://example.com/s508",
      levels: ["base"],
      criteria: [
        {
          id: "s508ish:X",
          standardId: "s508ish",
          localId: "X",
          title: "Base criterion",
          level: "base",
          description: "…",
          url: "https://example.com/s508#X",
          automatable: "full",
        },
      ],
    });
    const baseRule = defineRule({
      id: "test/rule-base",
      satisfies: ["s508ish:X"],
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
        return undefined;
      },
    });
    const criteria = new CriteriaRegistry();
    criteria.rebuild([s508]);
    expect(createStandardFilter(new Set(["s508ish"]), criteria, "A").isRuleActive(baseRule)).toBe(
      true,
    );
  });
});
