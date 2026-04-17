/**
 * Unit tests for the prompt-checksum registry.
 *
 * Invariants worth guarding:
 *   1. Every built-in prompt has a checksum — `prompts/list` never
 *      advertises a prompt without `_meta.checksum` (else pinning
 *      silently breaks).
 *   2. Checksums are stable across calls — the pre-computed
 *      registry and fresh `computePromptChecksum` output match.
 *   3. Checksums are unique per prompt — a collision would let a
 *      host pin to the wrong template.
 *   4. The length is fixed at `PROMPT_CHECKSUM_LENGTH` and the
 *      alphabet is lowercase hex.
 *   5. Renaming a prompt changes its checksum (drift detection).
 */

import { describe, expect, it } from "bun:test";
import {
  checksumForPrompt,
  computePromptChecksum,
  PROMPT_CHECKSUM_LENGTH,
  PROMPT_CHECKSUMS,
} from "../../../src/mcp/prompts/checksums.ts";
import { BUILTIN_PROMPTS } from "../../../src/mcp/prompts/index.ts";
import type { Prompt } from "../../../src/mcp/prompts/types.ts";

describe("prompt checksum registry", () => {
  it("registers a checksum for every built-in prompt", () => {
    for (const prompt of BUILTIN_PROMPTS) {
      expect(PROMPT_CHECKSUMS.has(prompt.name)).toBe(true);
      expect(checksumForPrompt(prompt.name)).toBeDefined();
    }
  });

  it("returns undefined for unknown prompt names (ambiguous field shapes guard per CLAUDE.md §1)", () => {
    expect(checksumForPrompt("does/not/exist")).toBeUndefined();
  });

  it("emits fixed-length lowercase hex digests", () => {
    const hexPattern = new RegExp(`^[0-9a-f]{${PROMPT_CHECKSUM_LENGTH}}$`);
    for (const checksum of PROMPT_CHECKSUMS.values()) {
      expect(checksum).toMatch(hexPattern);
      expect(checksum.length).toBe(PROMPT_CHECKSUM_LENGTH);
    }
  });

  it("assigns a unique checksum to each prompt (no collisions across the library)", () => {
    const seen = new Set<string>();
    for (const checksum of PROMPT_CHECKSUMS.values()) {
      expect(seen.has(checksum)).toBe(false);
      seen.add(checksum);
    }
    expect(seen.size).toBe(BUILTIN_PROMPTS.length);
  });

  it("pre-computed registry matches freshly computed checksums (pure function)", () => {
    for (const prompt of BUILTIN_PROMPTS) {
      expect(computePromptChecksum(prompt)).toBe(checksumForPrompt(prompt.name)!);
    }
  });
});

describe("checksum sensitivity", () => {
  function clonePrompt(overrides: Partial<Prompt>): Prompt {
    const base = BUILTIN_PROMPTS[0];
    if (!base) throw new Error("no built-in prompts to clone");
    return {
      name: overrides.name ?? base.name,
      description: overrides.description ?? base.description,
      arguments: overrides.arguments ?? base.arguments,
      render: overrides.render ?? base.render,
    };
  }

  it("changes when the prompt name changes", () => {
    const base = BUILTIN_PROMPTS[0];
    if (!base) throw new Error("no built-in prompts");
    const renamed = clonePrompt({ name: "ra11y/renamed-for-test" });
    expect(computePromptChecksum(renamed)).not.toBe(computePromptChecksum(base));
  });

  it("changes when the description changes", () => {
    const base = BUILTIN_PROMPTS[0];
    if (!base) throw new Error("no built-in prompts");
    const edited = clonePrompt({ description: `${base.description} (extra)` });
    expect(computePromptChecksum(edited)).not.toBe(computePromptChecksum(base));
  });

  it("changes when the rendered text changes", () => {
    const base = BUILTIN_PROMPTS[0];
    if (!base) throw new Error("no built-in prompts");
    const edited = clonePrompt({
      render: (args) => {
        const original = base.render(args);
        return original.map((m) => ({
          role: m.role,
          content: { type: "text", text: `${m.content.text} MUTATED` },
        }));
      },
    });
    expect(computePromptChecksum(edited)).not.toBe(computePromptChecksum(base));
  });

  it("does NOT change for an identical re-declaration (determinism)", () => {
    const base = BUILTIN_PROMPTS[0];
    if (!base) throw new Error("no built-in prompts");
    const identical = clonePrompt({});
    expect(computePromptChecksum(identical)).toBe(computePromptChecksum(base));
  });
});
