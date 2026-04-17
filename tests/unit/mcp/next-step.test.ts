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

function formatted(overrides: {
  plan?: Record<string, unknown>;
  files?: ScanFormatted["files"];
}): ScanFormatted {
  return {
    plan: overrides.plan ?? {},
    files: overrides.files ?? [],
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
