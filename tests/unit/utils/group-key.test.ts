import { describe, expect, it } from "bun:test";
import {
  computeGroupKey,
  GROUP_KEY_HEX_LENGTH,
  UNKNOWN_SHAPE,
} from "../../../src/utils/group-key.ts";

describe("computeGroupKey", () => {
  it("produces a hex digest of the configured length", () => {
    const key = computeGroupKey({ ruleId: "media/alt-text-missing", shape: "html:img[no-alt]" });
    expect(key).toMatch(/^[0-9a-f]+$/);
    expect(key.length).toBe(GROUP_KEY_HEX_LENGTH);
  });

  it("is deterministic — same input → same output", () => {
    const inputs = { ruleId: "media/alt-text-missing", shape: "html:img[no-alt]" };
    expect(computeGroupKey(inputs)).toBe(computeGroupKey(inputs));
  });

  it("different rules on the same shape produce different keys", () => {
    const a = computeGroupKey({ ruleId: "rule/a", shape: "html:img[no-alt]" });
    const b = computeGroupKey({ ruleId: "rule/b", shape: "html:img[no-alt]" });
    expect(a).not.toBe(b);
  });

  it("different shapes on the same rule produce different keys", () => {
    const a = computeGroupKey({ ruleId: "rule/x", shape: "html:img[no-alt]" });
    const b = computeGroupKey({ ruleId: "rule/x", shape: "html:a[no-href]" });
    expect(a).not.toBe(b);
  });

  it("UNKNOWN_SHAPE fallback groups every un-groupable finding per rule", () => {
    const a = computeGroupKey({ ruleId: "rule/x", shape: UNKNOWN_SHAPE });
    const b = computeGroupKey({ ruleId: "rule/x", shape: UNKNOWN_SHAPE });
    expect(a).toBe(b);
  });

  it("null-byte separator prevents boundary collisions", () => {
    // Pre-image attack shape: without a separator, rule "a" + shape "bc"
    // would hash the same as rule "ab" + shape "c". The null byte
    // between inputs makes that impossible because the shape cannot
    // contain a null byte in practice (AST kinds are printable ASCII).
    const a = computeGroupKey({ ruleId: "a", shape: "bc" });
    const b = computeGroupKey({ ruleId: "ab", shape: "c" });
    expect(a).not.toBe(b);
  });
});
