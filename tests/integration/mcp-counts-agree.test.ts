/**
 * Invariant: scan_project, coverage, and checklist must report the
 * same `manual review required` count for the same scan inputs.
 *
 * Drift between these surfaces was the dominant friction across ~30
 * unbiased agent reviews of the MCP server. The shared helper in
 * src/mcp/manual-applicability.ts is the canonical source; this test
 * confirms every consumer agrees, in both media-free and media-present
 * scenarios, so future refactors that introduce a new surface (or
 * forget to plumb the helper through) fail loudly.
 */

import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");

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

async function makeMediaFreeFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ra11y-counts-mediafree-"));
  await writeFile(join(dir, "page.html"), "<html><body><p>hello</p></body></html>");
  return dir;
}

async function makeMediaPresentFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ra11y-counts-media-"));
  await writeFile(join(dir, "page.html"), `<html><body><video src="x.mp4"></video></body></html>`);
  return dir;
}

interface ScanBody {
  readonly plan: {
    readonly actionableManualItems: number;
    readonly untargetedCriteria: number;
  };
}
interface CoverageBody {
  readonly criteriaManualReviewRequired: number;
}
interface ChecklistBody {
  readonly summary: {
    readonly manualReviewRequired: number;
    readonly actionable: number;
  };
}

async function gatherCounts(cwd: string): Promise<{
  scan: number;
  coverage: number;
  checklist: number;
  scanActionable: number;
  checklistActionable: number;
}> {
  const responses = await mcpSession([
    initMsg(1),
    toolCall(2, "scan_project", { cwd }),
    toolCall(3, "coverage", { cwd }),
    toolCall(4, "checklist", { cwd }),
  ]);
  const scanBody = body<ScanBody>(responses[1]);
  const coverageBody = body<CoverageBody>(responses[2]);
  const checklistBody = body<ChecklistBody>(responses[3]);
  return {
    // Re-derive the cross-tool total from the split top-level fields
    // (P1-M): `manualReviewRequired` no longer ships on scan_project's
    // plan — it would re-create the composite-headline dishonesty this
    // split exists to kill. The invariant is still "all surfaces agree
    // on the total", just computed from the honest parts.
    scan: scanBody.plan.actionableManualItems + scanBody.plan.untargetedCriteria,
    coverage: coverageBody.criteriaManualReviewRequired,
    checklist: checklistBody.summary.manualReviewRequired,
    scanActionable: scanBody.plan.actionableManualItems,
    checklistActionable: checklistBody.summary.actionable,
  };
}

describe("MCP invariant: manual-review count agrees across surfaces", () => {
  it("agrees on a media-free fixture (likelyIrrelevant > 0)", async () => {
    const dir = await makeMediaFreeFixture();
    const counts = await gatherCounts(dir);
    expect(counts.scan).toBe(counts.coverage);
    expect(counts.coverage).toBe(counts.checklist);
  });

  it("agrees on a media-present fixture (likelyIrrelevant = 0)", async () => {
    const dir = await makeMediaPresentFixture();
    const counts = await gatherCounts(dir);
    expect(counts.scan).toBe(counts.coverage);
    expect(counts.coverage).toBe(counts.checklist);
  });

  it("scan.plan.actionableManualItems agrees with checklist.summary.actionable", async () => {
    // Without this, an agent reading scan.plan.manualReviewRequired
    // (e.g., 21) has to call checklist just to learn that only a
    // handful (e.g., 4) are grounded in file:line candidates. Exposing
    // the actionable count inline saves the round trip.
    const mediaFree = await gatherCounts(await makeMediaFreeFixture());
    expect(mediaFree.scanActionable).toBe(mediaFree.checklistActionable);
    expect(mediaFree.scanActionable).toBeLessThanOrEqual(mediaFree.scan);
  });

  it("the two fixtures produce different counts (proves likelyIrrelevant filtering applies)", async () => {
    const mediaFree = await gatherCounts(await makeMediaFreeFixture());
    const mediaPresent = await gatherCounts(await makeMediaPresentFixture());
    expect(mediaPresent.checklist).toBeGreaterThan(mediaFree.checklist);
  });
});

// Silence the unused warning on the helper used implicitly above.
void mkdir;
