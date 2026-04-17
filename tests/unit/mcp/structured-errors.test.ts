/**
 * Unit tests for the structured-error envelope shape.
 *
 * Invariants the implementation must hold — not a rehearsal of the
 * body of `errorResult`:
 *
 *   - Structured errors always set `isError: true` AND populate
 *     `structuredContent` AND include a human-readable `content[0].text`
 *     block. These three fields coexist; the agent branches on
 *     `structuredContent.code`, the host renders the text.
 *   - The string overload stays working for legacy callers: it yields
 *     the text block and `isError` without `structuredContent`.
 *   - Optional fields (`details`, `remediation`) are present only when
 *     supplied — no `{}` sentinel — to honor the "ambiguous field shapes
 *     are dishonest" rule in CLAUDE.md §1. The text payload and
 *     structuredContent payload must be consistent about which optional
 *     fields they include.
 *   - The legacy `error` string in `content[0].text` stays populated so
 *     older consumers that grepped the text blob continue to read the
 *     same human summary.
 */

import { describe, expect, it } from "bun:test";
import { errorResult, type StructuredError } from "../../../src/mcp/tools-helpers.ts";

describe("errorResult: structured envelope", () => {
  it("coexists structuredContent, content text, and isError for the structured overload", () => {
    const err: StructuredError = {
      code: "rule-not-found",
      message: "Rule 'foo/bar' not found.",
      details: { requested: "foo/bar" },
      remediation: "Call `list_rules` first.",
    };
    const r = errorResult(err);

    expect(r.isError).toBe(true);
    expect(r.structuredContent).toBeDefined();
    expect(r.structuredContent?.["code"]).toBe("rule-not-found");
    expect(r.structuredContent?.["message"]).toBe("Rule 'foo/bar' not found.");
    expect(r.structuredContent?.["details"]).toEqual({ requested: "foo/bar" });
    expect(r.structuredContent?.["remediation"]).toBe("Call `list_rules` first.");
    // Human text mirror
    expect(r.content).toHaveLength(1);
    expect(r.content[0].type).toBe("text");
    const parsed = JSON.parse(r.content[0].text) as Record<string, unknown>;
    expect(parsed["error"]).toBe("Rule 'foo/bar' not found.");
    expect(parsed["code"]).toBe("rule-not-found");
  });

  it("omits details/remediation entirely when the StructuredError doesn't carry them", () => {
    const r = errorResult({
      code: "baseline-not-found",
      message: "Baseline file not found.",
    });
    expect(r.structuredContent?.["details"]).toBeUndefined();
    expect(r.structuredContent?.["remediation"]).toBeUndefined();
    const parsed = JSON.parse(r.content[0].text) as Record<string, unknown>;
    expect(parsed["details"]).toBeUndefined();
    expect(parsed["remediation"]).toBeUndefined();
    // Still carries the load-bearing pair
    expect(parsed["error"]).toBe("Baseline file not found.");
    expect(parsed["code"]).toBe("baseline-not-found");
  });

  it("keeps the string overload working without synthesizing structuredContent", () => {
    const r = errorResult("something went wrong");
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toBeUndefined();
    const parsed = JSON.parse(r.content[0].text) as { error: string };
    expect(parsed.error).toBe("something went wrong");
  });
});
