/**
 * Cross-tool invariant (ADR 0010): `coverage` and `checklist` are
 * two surfaces over the same scan. The boundary is sharp — `coverage`
 * is the compliance dashboard (no file:line), `checklist` is the
 * workflow queue (grounded candidates) — but their scalars MUST
 * agree, and the cross-pointing `nextStepStructured` on each tool
 * must carry args the companion tool accepts without crashing.
 *
 * Drift here re-creates the "three-places-same-shape" bug ADR 0010
 * closed. This test is the load-bearing invariant.
 */

import { describe, expect, it } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..", "..", "..");

interface JsonRpcResponse {
  readonly id?: number;
  readonly result?: { readonly content?: readonly { readonly text: string }[] };
}

async function mcpSession(
  messages: readonly Record<string, unknown>[],
): Promise<JsonRpcResponse[]> {
  const proc = Bun.spawn(["bun", "run", "src/cli.ts", "--mcp"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    cwd: PROJECT_ROOT,
  });
  proc.stdin.write(`${messages.map((m) => JSON.stringify(m)).join("\n")}\n`);
  proc.stdin.end();
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JsonRpcResponse);
}

const initMsg = (id: number) => ({
  jsonrpc: "2.0",
  id,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "t", version: "0" },
  },
});

const toolCall = (id: number, name: string, args: Record<string, unknown>) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
});

function body<T>(resp: JsonRpcResponse): T {
  const text = resp.result?.content?.[0]?.text;
  if (typeof text !== "string") throw new Error("missing tool result text");
  return JSON.parse(text) as T;
}

async function makeFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ra11y-cov-check-consistency-"));
  await writeFile(
    join(dir, "page.html"),
    `<html><body><img src="a.png"><video src="x.mp4"></video><p>hi</p></body></html>`,
  );
  return dir;
}

interface NextStepStructured {
  readonly tool: string;
  readonly args: Record<string, unknown>;
}

interface CoverageBody {
  readonly standardId: string;
  readonly criteriaManualReviewRequired: number;
  readonly untargetedCriteria: number;
  readonly manualWithCandidates: readonly { readonly id: string }[];
  readonly likelyIrrelevantCriteria: readonly { readonly id: string }[];
  readonly failingAutomatedCriteria: readonly { readonly id: string }[];
  readonly nextStep?: string;
  readonly nextStepStructured?: NextStepStructured;
}

interface ChecklistBody {
  readonly summary: {
    readonly actionable: number;
    readonly untargetedCriteria: number;
    readonly likelyIrrelevant: number;
    readonly manualReviewRequired: number;
  };
  readonly items: readonly { readonly criterionId: string }[];
  readonly likelyIrrelevant: readonly { readonly criterionId: string }[];
  readonly nextStep?: string;
  readonly nextStepStructured?: NextStepStructured;
}

describe("ADR 0010 — coverage and checklist stay consistent across the shared boundary", () => {
  it("agrees on untargeted and likelyIrrelevant scalars for the same scan", async () => {
    const dir = await makeFixture();
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "coverage", { cwd: dir }),
      toolCall(3, "checklist", { cwd: dir }),
    ]);
    const coverage = body<CoverageBody>(responses[1]);
    const checklist = body<ChecklistBody>(responses[2]);

    // Untargeted count must be the same number on both tools — it
    // comes from the same `manualApplicability` pass per ADR 0010.
    expect(coverage.untargetedCriteria).toBe(checklist.summary.untargetedCriteria);

    // likelyIrrelevant list: same criteria are flagged on both surfaces.
    const coverageIrrelevantIds = new Set(coverage.likelyIrrelevantCriteria.map((c) => c.id));
    const checklistIrrelevantIds = new Set(checklist.likelyIrrelevant.map((c) => c.criterionId));
    expect(coverageIrrelevantIds).toEqual(checklistIrrelevantIds);

    // Actionable (checklist items with candidates) lines up with
    // coverage's `manualWithCandidates`.
    const coverageActionableIds = new Set(coverage.manualWithCandidates.map((c) => c.id));
    const checklistActionableIds = new Set(checklist.items.map((i) => i.criterionId));
    expect(checklistActionableIds).toEqual(coverageActionableIds);
  });

  it("coverage → checklist nextStepStructured carries args checklist accepts", async () => {
    const dir = await makeFixture();
    const responses = await mcpSession([initMsg(1), toolCall(2, "coverage", { cwd: dir })]);
    const coverage = body<CoverageBody>(responses[1]);
    // Media + img fixture has grounded manual candidates, so coverage
    // must point at `checklist` (ADR 0010 branch 1).
    expect(coverage.nextStep).toBeDefined();
    expect(coverage.nextStepStructured).toBeDefined();
    const hint = coverage.nextStepStructured;
    if (hint === undefined) throw new Error("coverage missing structured next step");
    expect(hint.tool).toBe("checklist");

    // Feed the suggested args straight into `checklist` and assert it
    // does not error. A crash on these args means the cross-pointer is
    // dishonest.
    const followup = await mcpSession([initMsg(1), toolCall(2, "checklist", hint.args)]);
    const result = followup[1].result;
    expect(result).toBeDefined();
    const checklist = body<ChecklistBody>(followup[1]);
    expect(checklist.summary).toBeDefined();
  });

  it("checklist → coverage nextStepStructured carries args coverage accepts", async () => {
    // Force the "no actionable items" branch with an empty directory
    // (zero parseable files → zero grounded candidates, regardless of
    // finder behavior). `checklist` then cross-points at `coverage`
    // per ADR 0010 branch 1 on the checklist side.
    const dir = await mkdtemp(join(tmpdir(), "ra11y-checklist-to-coverage-"));
    const responses = await mcpSession([initMsg(1), toolCall(2, "checklist", { cwd: dir })]);
    const checklist = body<ChecklistBody>(responses[1]);
    if (checklist.summary.actionable !== 0) {
      throw new Error(
        `fixture regression — expected 0 actionable items on empty dir, got ${checklist.summary.actionable}`,
      );
    }

    expect(checklist.nextStep).toBeDefined();
    expect(checklist.nextStepStructured).toBeDefined();
    const hint = checklist.nextStepStructured;
    if (hint === undefined) throw new Error("checklist missing structured next step");
    expect(hint.tool).toBe("coverage");

    const followup = await mcpSession([initMsg(1), toolCall(2, "coverage", hint.args)]);
    const result = followup[1].result;
    expect(result).toBeDefined();
  });

  it("checklist zero-actionable nextStep mentions ra11y/audit and ra11y/vpat-narrative prompts", async () => {
    // V1-PROMPT-LINK: when there are no actionable items the workflow
    // endpoint is VPAT/audit work. The prose must name both templates
    // so agents discover them without a separate prompts/list call.
    // Structured still points at `coverage` (the companion MCP tool) —
    // the prompt names live in prose only per CLAUDE.md §1.
    const dir = await mkdtemp(join(tmpdir(), "ra11y-checklist-prompt-link-"));
    const responses = await mcpSession([initMsg(1), toolCall(2, "checklist", { cwd: dir })]);
    const checklist = body<ChecklistBody>(responses[1]);
    if (checklist.summary.actionable !== 0) {
      throw new Error(
        `fixture regression — expected 0 actionable items on empty dir, got ${checklist.summary.actionable}`,
      );
    }

    expect(checklist.nextStep).toContain("ra11y/audit");
    expect(checklist.nextStep).toContain("ra11y/vpat-narrative");
    expect(checklist.nextStep).toContain("prompts/get");
    // Structured still points at coverage, not a prompt.
    expect(checklist.nextStepStructured?.tool).toBe("coverage");
  });

  it("both tools conditional-spread the nextStep pair as a unit", async () => {
    // Conditional-spread discipline: `nextStep` and
    // `nextStepStructured` are present together, or both absent —
    // never one without the other (CLAUDE.md §1 "Ambiguous field
    // shapes are dishonest").
    const dir = await makeFixture();
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "coverage", { cwd: dir }),
      toolCall(3, "checklist", { cwd: dir }),
    ]);
    const coverage = body<CoverageBody>(responses[1]);
    const checklist = body<ChecklistBody>(responses[2]);

    const coverageHasProse = coverage.nextStep !== undefined;
    const coverageHasStructured = coverage.nextStepStructured !== undefined;
    expect(coverageHasProse).toBe(coverageHasStructured);

    const checklistHasProse = checklist.nextStep !== undefined;
    const checklistHasStructured = checklist.nextStepStructured !== undefined;
    expect(checklistHasProse).toBe(checklistHasStructured);
  });
});
