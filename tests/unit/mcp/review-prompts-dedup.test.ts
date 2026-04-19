/**
 * Unit tests for the top-level `prompts` map on `review_candidates`
 * responses. Guards the P1-DUP lossless transform: the ~450-char
 * reviewPrompt text that used to repeat on every candidate now lives
 * once per criterionId at the top level, and each candidate no longer
 * carries `reviewPrompt`/`finderId`.
 *
 * Invariants under test:
 *   - multiple candidates of the same criterion share a single entry
 *     in `prompts[criterionId]` (the whole point of the dedupe);
 *   - candidates across different criteria each get their own entry
 *     keyed by that criterion;
 *   - when there are zero candidates, `prompts` is omitted entirely
 *     rather than emitted as `{}` (see CLAUDE.md §1 "Ambiguous field
 *     shapes are dishonest");
 *   - candidates no longer carry per-row `reviewPrompt`/`finderId`;
 *   - serialized response byte size drops materially relative to a
 *     shape that inlines the prompt per-row, which is the consumer
 *     win we claimed in the backlog note.
 */

import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { McpSession } from "../../../src/mcp/session.ts";
import { MCP_TOOLS } from "../../../src/mcp/tools.ts";

const FIXTURE_ROOT = join(import.meta.dir, "..", "..", "fixtures");
const CONSISTENT_NAV_BAD = join(FIXTURE_ROOT, "review", "consistent-navigation", "bad");
const GOOD_ALT = join(FIXTURE_ROOT, "good", "alt-text-missing");

// A criterion no built-in finder surfaces candidates for. Picking one
// whose spec is automatable (4.1.2 Name, Role, Value — covered entirely
// by rules, not finders) guarantees the candidates filter yields zero
// regardless of the scanned fixture, which is what the "zero candidates
// → omit prompts" invariant needs.
const CRITERION_NO_FINDER = "wcag22:4.1.2";

function findTool(name: string) {
  const tool = MCP_TOOLS.find((t) => t.def.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

interface PromptEntry {
  readonly text: string;
  readonly finderId: string;
}

interface ReviewBody {
  readonly candidateCount: number;
  readonly prompts?: Record<string, PromptEntry>;
  readonly candidates: ReadonlyArray<Record<string, unknown>>;
  readonly nextStep?: string;
}

async function runReviewCandidates(params: Record<string, unknown>): Promise<ReviewBody> {
  const tool = findTool("review_candidates");
  const session = new McpSession();
  const result = await tool.handler(params, session);
  if (result.isError) {
    throw new Error(`review_candidates errored: ${result.content[0]?.text ?? "<no body>"}`);
  }
  return JSON.parse(result.content[0].text) as ReviewBody;
}

describe("review_candidates: top-level prompts map dedupe", () => {
  it("emits one prompts[criterionId] entry shared across multiple same-criterion candidates", async () => {
    // consistent-navigation/bad produces 2+ candidates for wcag22:3.2.3
    // (one per divergent nav). All of them should reference a single
    // prompts["wcag22:3.2.3"] entry rather than inlining the prompt
    // text on each row.
    const body = await runReviewCandidates({ paths: [CONSISTENT_NAV_BAD] });

    const sameCriterion = body.candidates.filter((c) => c["criterionId"] === "wcag22:3.2.3");
    expect(sameCriterion.length).toBeGreaterThan(1);

    // Prompt present exactly once for that criterion.
    expect(body.prompts).toBeDefined();
    const entry = body.prompts?.["wcag22:3.2.3"];
    expect(entry).toBeDefined();
    expect(typeof entry?.text).toBe("string");
    expect((entry?.text ?? "").length).toBeGreaterThan(0);
    expect(typeof entry?.finderId).toBe("string");
    expect((entry?.finderId ?? "").length).toBeGreaterThan(0);

    // And no candidate carries the prompt text inline any more.
    for (const c of body.candidates) {
      expect(c["reviewPrompt"]).toBeUndefined();
      expect(c["finderId"]).toBeUndefined();
    }
  });

  it("omits the prompts field entirely when the response has zero candidates", async () => {
    // Filter to a criterion no finder surfaces. Multiple-ways and
    // sensory-characteristics emit page-level candidates on any
    // scanned HTML, so we can't rely on a clean-scan fixture alone;
    // a criterion-filter that matches nothing is the deterministic
    // path to zero candidates. Per CLAUDE.md §1, the honest shape
    // when empty is to drop `prompts` rather than emit `{}`, so
    // agents can't confuse "no prompts here" with an empty map.
    const body = await runReviewCandidates({
      paths: [GOOD_ALT],
      criterionId: CRITERION_NO_FINDER,
    });
    expect(body.candidateCount).toBe(0);
    expect(body.candidates.length).toBe(0);
    expect(body.prompts).toBeUndefined();
  });

  it("response does not carry reviewPrompt text inline on candidates", async () => {
    // Regression guard: the whole point of the dedupe is that the
    // ~450-char prompt prose stops appearing once per row. We assert
    // this directly by serializing the candidates array and checking
    // the prompt text only shows up under `prompts`.
    const body = await runReviewCandidates({ paths: [CONSISTENT_NAV_BAD] });
    expect(body.candidates.length).toBeGreaterThan(0);
    const prompts = body.prompts ?? {};
    const texts = Object.values(prompts).map((p) => p.text);
    expect(texts.length).toBeGreaterThan(0);

    const candidatesJson = JSON.stringify(body.candidates);
    for (const text of texts) {
      // The prompt text should not appear anywhere in the candidates
      // array — it lives exclusively in the top-level prompts map.
      expect(candidatesJson.includes(text)).toBe(false);
    }
  });

  // ── Prompt-link assertions (V1-PROMPT-LINK) ─────────────────────────────
  // review_candidates should nudge toward ra11y/triage when candidates
  // exist; the nextStep is omitted when candidates is empty so the
  // present-when-meaningful discipline (CLAUDE.md §1) holds.

  it("surfaces ra11y/triage prompt name in nextStep when candidates exist", async () => {
    const body = await runReviewCandidates({ paths: [CONSISTENT_NAV_BAD] });
    expect(body.candidateCount).toBeGreaterThan(0);
    expect(body.nextStep).toBeDefined();
    expect(body.nextStep).toContain("ra11y/triage");
    expect(body.nextStep).toContain("prompts/get");
  });

  it("omits nextStep when no candidates are returned", async () => {
    const body = await runReviewCandidates({
      paths: [GOOD_ALT],
      criterionId: CRITERION_NO_FINDER,
    });
    expect(body.candidateCount).toBe(0);
    expect(body.nextStep).toBeUndefined();
  });

  it("serialized response is measurably smaller than the pre-dedupe shape on a many-candidate criterion", async () => {
    // Compare the actual response size against a reconstructed
    // "pre-dedupe" shape where every candidate carries the full
    // reviewPrompt text inline. For a criterion with N candidates
    // sharing one prompt, the per-row duplication is ~(N-1) * promptLen.
    // We want a non-trivial reduction (not just "equal or smaller")
    // so the test catches a regression where the prompt leaks back in.
    const body = await runReviewCandidates({ paths: [CONSISTENT_NAV_BAD] });
    expect(body.candidates.length).toBeGreaterThan(1);
    const prompts = body.prompts ?? {};

    const dedupedSize = JSON.stringify(body).length;
    const inlined = {
      ...body,
      prompts: undefined,
      candidates: body.candidates.map((c) => {
        const cid = c["criterionId"] as string;
        const prompt = prompts[cid];
        return prompt === undefined
          ? c
          : { ...c, reviewPrompt: prompt.text, finderId: prompt.finderId };
      }),
    };
    const inlinedSize = JSON.stringify(inlined).length;

    // Proves the lossless transform actually saves bytes; should be
    // comfortably more than a rounding-error difference.
    expect(inlinedSize).toBeGreaterThan(dedupedSize);
    expect(inlinedSize - dedupedSize).toBeGreaterThan(100);
  });
});
