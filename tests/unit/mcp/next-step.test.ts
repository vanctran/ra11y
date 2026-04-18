/**
 * Unit tests for `src/mcp/next-step.ts`.
 *
 * The helper emits two views of the same recommendation (P1-K):
 *   - `prose` — English summary; kept for humans and weaker LLMs.
 *   - `structured` — `{ tool, args }` machine hint; omitted when the
 *     prose degrades to generic multi-option advice (CLAUDE.md §1
 *     "Ambiguous field shapes are dishonest").
 *
 * These tests guard the alignment invariant: whichever tool the prose
 * names as the next call is the same tool the structured form names,
 * with args populated from the same first-finding tuple. If the prose
 * picks `suggest_fix` but the structured form reports `checklist`, the
 * whole point of shipping both forms collapses.
 */

import { describe, expect, it } from "bun:test";
import { buildNextStep } from "../../../src/mcp/next-step.ts";
import type { ScanFormatted } from "../../../src/mcp/tools-helpers.ts";

// These tests probe `buildNextStep`'s graceful handling of partial or
// malformed finding shapes — the function reads a few fields with
// optional chains and falls back cleanly when they're missing. Relax
// the helper's `files` parameter type so tests can exercise the real
// defensive code path without synthesizing full `AgentFinding`
// fixtures. Production call sites always pass `AgentFinding[]` through
// the strictly-typed `ScanFormatted`.
function formatted(overrides: {
  plan?: Record<string, unknown>;
  files?: readonly {
    readonly path: string;
    readonly findings: readonly Record<string, unknown>[];
  }[];
}): ScanFormatted {
  return {
    plan: overrides.plan ?? {},
    files: (overrides.files ?? []) as unknown as ScanFormatted["files"],
    meta: {},
  };
}

const sampleFinding = {
  ruleId: "aria/hidden-focus",
  line: 21,
  column: 4,
  message: "focusable descendant inside aria-hidden",
};

describe("buildNextStep", () => {
  it("returns suggest_fix with aligned prose + structured args when a fixable violation exists", () => {
    const result = buildNextStep(
      formatted({
        plan: { violations: 1, mechanicalEditsAvailable: 1 },
        files: [{ path: "DemoComposer.tsx", findings: [sampleFinding] }],
      }),
    );

    // Prose names the tool and the concrete file:line the agent should
    // open. Structured form names the same tool with canonical args
    // (`file`, not `filePath`, per P2-R).
    expect(result.prose).toContain("suggest_fix");
    expect(result.prose).toContain("DemoComposer.tsx:21");
    expect(result.prose).toContain("aria/hidden-focus");
    expect(result.structured).toEqual({
      tool: "suggest_fix",
      args: { ruleId: "aria/hidden-focus", file: "DemoComposer.tsx", line: 21 },
    });
  });

  it("returns explain_rule when violations exist but no fix is available", () => {
    const result = buildNextStep(
      formatted({
        plan: { violations: 2 },
        files: [{ path: "Header.tsx", findings: [sampleFinding] }],
      }),
    );

    expect(result.prose).toContain("explain_rule");
    expect(result.prose).toContain("aria/hidden-focus");
    expect(result.structured).toEqual({
      tool: "explain_rule",
      args: { ruleId: "aria/hidden-focus" },
    });
  });

  it("returns scan_file when the response carries only info-level notes", () => {
    const result = buildNextStep(
      formatted({
        plan: { violations: 0, notes: 3 },
        files: [{ path: "Sidebar.tsx", findings: [sampleFinding] }],
      }),
    );

    expect(result.prose).toContain("scan_file");
    expect(result.prose).toContain("Sidebar.tsx");
    expect(result.structured).toEqual({ tool: "scan_file", args: { file: "Sidebar.tsx" } });
  });

  it("returns checklist on a clean automated scan — both prose and structured point at the manual half", () => {
    const result = buildNextStep(
      formatted({ plan: { violations: 0, notes: 0, actionableManualItems: 0 } }),
    );

    expect(result.prose).toContain("checklist");
    expect(result.structured).toEqual({ tool: "checklist", args: {} });
  });

  it("returns checklist when the actionable-manual count is non-zero", () => {
    const result = buildNextStep(
      formatted({ plan: { violations: 0, notes: 0, actionableManualItems: 4 } }),
    );

    expect(result.prose).toContain("checklist");
    expect(result.prose).toContain("4 manual-review");
    expect(result.structured).toEqual({ tool: "checklist", args: {} });
  });

  it("omits the structured form when violations exist but no concrete (file, line, ruleId) can be named", () => {
    // Simulates the fallback branch: counts say something is wrong,
    // but `files` carries no extractable first finding. The prose
    // falls back to multi-option generic advice; the structured hint
    // is omitted (CLAUDE.md §1) rather than fabricated.
    const result = buildNextStep(
      formatted({
        plan: { violations: 1 },
        files: [{ path: "Unknown.tsx", findings: [{ malformed: true }] }],
      }),
    );

    expect(result.prose).toMatch(/explain_rule/);
    expect(result.structured).toBeUndefined();
  });

  it("drops the suggest_fix nudge when every violation carries fixClass=mechanical", () => {
    // Q2R2-FIX-DEDUPE: when every violation-severity finding already
    // carries an inline mechanical fix (primary + alternatives +
    // context), re-nudging the agent to call suggest_fix is a
    // redundant round-trip. Both prose and structured must be
    // trimmed consistently (P1-K paired emission) — a one-sided trim
    // would re-create the exact drift we ship both forms to prevent.
    const result = buildNextStep(
      formatted({
        plan: { violations: 2, mechanicalEditsAvailable: 2 },
        files: [
          {
            path: "App.tsx",
            findings: [
              { ...sampleFinding, severity: "error", fixClass: "mechanical" },
              {
                ruleId: "aria/valid-attr",
                line: 44,
                column: 2,
                severity: "warning",
                fixClass: "mechanical",
              },
            ],
          },
        ],
      }),
    );

    expect(result.prose).not.toContain("suggest_fix");
    expect(result.prose).toContain("apply `primary.edit` directly");
    expect(result.structured).toBeUndefined();
  });

  it("keeps the suggest_fix nudge when some violations are mechanical and others are guidance", () => {
    // Mixed-lane case: the guidance / verify-in-source / runtime-only
    // findings still need the round-trip, so the shared nudge stays.
    // This is the guardrail that prevents the dedupe from turning
    // into under-surfacing: when even one violation would benefit
    // from suggest_fix, we keep it for all of them.
    const result = buildNextStep(
      formatted({
        plan: { violations: 2, mechanicalEditsAvailable: 1, guidanceFixesAvailable: 1 },
        files: [
          {
            path: "App.tsx",
            findings: [
              { ...sampleFinding, severity: "error", fixClass: "mechanical" },
              {
                ruleId: "label/in-name",
                line: 88,
                column: 6,
                severity: "warning",
                fixClass: "guidance",
              },
            ],
          },
        ],
      }),
    );

    expect(result.prose).toContain("suggest_fix");
    expect(result.structured).toEqual({
      tool: "suggest_fix",
      args: { ruleId: "aria/hidden-focus", file: "App.tsx", line: 21 },
    });
  });

  it("keeps the suggest_fix nudge when every violation is guidance-class", () => {
    // All-guidance: no mechanical fixes exist, so the nudge is still
    // the canonical next step. Fail-closed predicate — we only drop
    // the nudge when 100% of violations are mechanical.
    const result = buildNextStep(
      formatted({
        plan: { violations: 1, guidanceFixesAvailable: 1 },
        files: [
          {
            path: "App.tsx",
            findings: [{ ...sampleFinding, severity: "error", fixClass: "guidance" }],
          },
        ],
      }),
    );

    expect(result.prose).toContain("suggest_fix");
    expect(result.structured).toEqual({
      tool: "suggest_fix",
      args: { ruleId: "aria/hidden-focus", file: "App.tsx", line: 21 },
    });
  });

  it("leaves the clean-scan nextStep unchanged when there are no violations", () => {
    // No-violations branch is outside the dedupe predicate's scope —
    // the flag is computed but irrelevant, and the clean-scan
    // recommendation (`checklist`) must not be affected.
    const result = buildNextStep(
      formatted({ plan: { violations: 0, notes: 0, actionableManualItems: 0 } }),
    );

    expect(result.prose).toContain("checklist");
    expect(result.prose).not.toContain("suggest_fix");
    expect(result.structured).toEqual({ tool: "checklist", args: {} });
  });

  it("keeps the suggest_fix nudge when a violation is missing fixClass (fail-closed)", () => {
    // Synthetic / legacy shapes that don't stamp fixClass must NOT
    // slip past the predicate as "mechanical by default" — silent
    // drop of the nudge on an unknown lane is the exact under-
    // surfacing the AI-first doctrine rejects. The predicate
    // fail-closes: if a violation is missing fixClass, the suggest_fix
    // nudge stays.
    const result = buildNextStep(
      formatted({
        plan: { violations: 1, mechanicalEditsAvailable: 1 },
        files: [
          {
            path: "App.tsx",
            // No fixClass on this finding.
            findings: [{ ...sampleFinding, severity: "error" }],
          },
        ],
      }),
    );

    expect(result.prose).toContain("suggest_fix");
    expect(result.structured).toEqual({
      tool: "suggest_fix",
      args: { ruleId: "aria/hidden-focus", file: "App.tsx", line: 21 },
    });
  });

  it("produces prose and structured forms that agree on the named tool across every branch", () => {
    // Invariant check: iterate the branches that emit structured
    // output and confirm the tool name in `structured.tool` appears
    // in the prose text. Drift between the two is exactly the bug
    // P1-K's "both fields describe the same call" rule exists to
    // prevent.
    const cases: readonly ScanFormatted[] = [
      formatted({
        plan: { violations: 1, mechanicalEditsAvailable: 1 },
        files: [{ path: "A.tsx", findings: [sampleFinding] }],
      }),
      formatted({
        plan: { violations: 2 },
        files: [{ path: "B.tsx", findings: [sampleFinding] }],
      }),
      formatted({
        plan: { violations: 0, notes: 1 },
        files: [{ path: "C.tsx", findings: [sampleFinding] }],
      }),
      formatted({ plan: { violations: 0, notes: 0, actionableManualItems: 2 } }),
    ];
    for (const f of cases) {
      const result = buildNextStep(f);
      expect(result.structured).toBeDefined();
      if (result.structured) {
        expect(result.prose).toContain(result.structured.tool);
      }
    }
  });
});
