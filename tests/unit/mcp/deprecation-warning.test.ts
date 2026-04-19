/**
 * Unit tests for `src/mcp/deprecation-warning.ts` — `layerDeprecationWarning`
 * splices a structured code onto a tool response's top-level
 * `warnings: string[]` on both the JSON text payload and the structured
 * content, while staying defensive against shapes that don't follow the
 * text+structured convention.
 *
 * The module is reachable from the MCP server dispatch path (`configure`
 * alias → `deprecated_tool_name_configure`) but the layer itself is pure;
 * we drive it with handcrafted result shapes rather than through the full
 * RPC loop.
 */

import { describe, expect, it } from "bun:test";
import { layerDeprecationWarning } from "../../../src/mcp/deprecation-warning.ts";

interface ToolResultShape {
  readonly content: readonly { readonly type: string; readonly text: string }[];
  readonly structuredContent?: Record<string, unknown>;
  readonly isError?: boolean;
}

describe("layerDeprecationWarning", () => {
  it("appends the code to a text payload that has no prior warnings", () => {
    const input = {
      content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
      structuredContent: { ok: true },
    };
    const result = layerDeprecationWarning(input, "deprecated_foo") as ToolResultShape;
    const parsed = JSON.parse(result.content[0]?.text ?? "{}") as { warnings: string[] };
    expect(parsed.warnings).toEqual(["deprecated_foo"]);
    expect(result.structuredContent?.warnings).toEqual(["deprecated_foo"]);
  });

  it("preserves the pre-existing warnings array and appends the new code at the tail", () => {
    const input = {
      content: [{ type: "text", text: JSON.stringify({ warnings: ["scanned_zero_files"] }) }],
      structuredContent: { warnings: ["scanned_zero_files"] },
    };
    const result = layerDeprecationWarning(input, "deprecated_foo") as ToolResultShape;
    const parsed = JSON.parse(result.content[0]?.text ?? "{}") as { warnings: string[] };
    expect(parsed.warnings).toEqual(["scanned_zero_files", "deprecated_foo"]);
    expect(result.structuredContent?.warnings).toEqual(["scanned_zero_files", "deprecated_foo"]);
  });

  it("is idempotent — layering the same code twice does not duplicate it", () => {
    const once = layerDeprecationWarning(
      {
        content: [{ type: "text", text: JSON.stringify({ ok: 1 }) }],
        structuredContent: { ok: 1 },
      },
      "deprecated_foo",
    );
    const twice = layerDeprecationWarning(once, "deprecated_foo") as ToolResultShape;
    const parsed = JSON.parse(twice.content[0]?.text ?? "{}") as { warnings: string[] };
    expect(parsed.warnings).toEqual(["deprecated_foo"]);
    expect(twice).toBe(once as ToolResultShape);
  });

  it("leaves error envelopes untouched — warnings on errors muddy the isError contract", () => {
    const input = {
      content: [{ type: "text", text: JSON.stringify({ message: "boom" }) }],
      isError: true,
    };
    const result = layerDeprecationWarning(input, "deprecated_foo");
    expect(result).toBe(input);
  });

  it("returns the input unchanged when the first content entry is not stringified JSON", () => {
    const input = {
      content: [{ type: "text", text: "plain text, not JSON" }],
    };
    const result = layerDeprecationWarning(input, "deprecated_foo");
    expect(result).toBe(input);
  });

  it("returns the input unchanged when content is missing or empty", () => {
    const empty = { content: [] };
    expect(layerDeprecationWarning(empty, "deprecated_foo")).toBe(empty);
    const none = {};
    expect(layerDeprecationWarning(none, "deprecated_foo")).toBe(none);
  });

  it("returns the input unchanged when the result is not an object (null / string / number)", () => {
    expect(layerDeprecationWarning(null, "deprecated_foo")).toBe(null);
    expect(layerDeprecationWarning("oops", "deprecated_foo")).toBe("oops");
    expect(layerDeprecationWarning(42, "deprecated_foo")).toBe(42);
  });

  it("falls back to the parsed text payload as structuredContent when none was provided", () => {
    const input = {
      content: [{ type: "text", text: JSON.stringify({ ok: true, detail: "x" }) }],
    };
    const result = layerDeprecationWarning(input, "deprecated_foo") as ToolResultShape;
    expect(result.structuredContent).toEqual({
      ok: true,
      detail: "x",
      warnings: ["deprecated_foo"],
    });
  });

  it("ignores a malformed `warnings` field (non-array) and starts a fresh array", () => {
    const input = {
      content: [{ type: "text", text: JSON.stringify({ warnings: "not-an-array" }) }],
      structuredContent: { warnings: "not-an-array" },
    };
    const result = layerDeprecationWarning(input, "deprecated_foo") as ToolResultShape;
    const parsed = JSON.parse(result.content[0]?.text ?? "{}") as { warnings: string[] };
    expect(parsed.warnings).toEqual(["deprecated_foo"]);
  });

  it("returns the input unchanged when content[0].text is not a string (e.g. structured content only)", () => {
    const input = {
      content: [{ type: "image", text: 123 as unknown as string }],
    };
    const result = layerDeprecationWarning(input, "deprecated_foo");
    expect(result).toBe(input);
  });
});
