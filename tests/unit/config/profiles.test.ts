/**
 * Built-in conformance profile tests. Profiles are pure data and the
 * built-in list is part of the agent-facing contract — these tests
 * encode the invariants that make `--profile <name>` a stable handle:
 * every shipped profile has a usable scope (non-empty standards list),
 * every name resolves uniquely, and every description is non-empty so
 * the CLI error message on an unknown name has something useful to
 * quote back.
 */

import { describe, expect, it } from "bun:test";

import {
  BUILTIN_PROFILES,
  type ConformanceProfile,
  getProfile,
  resolveProfile,
} from "../../../src/config/profiles.ts";

describe("getProfile", () => {
  it("returns the matching profile for a known name", () => {
    const profile = getProfile("wcag22-aa");
    expect(profile).toBeDefined();
    expect(profile?.standards).toEqual(["wcag22"]);
    expect(profile?.level).toBe("AA");
  });

  it("returns undefined for an unknown name", () => {
    expect(getProfile("wcag99-aa")).toBeUndefined();
  });

  it("returns undefined for the empty string", () => {
    expect(getProfile("")).toBeUndefined();
  });
});

describe("BUILTIN_PROFILES invariants", () => {
  it("every built-in has a non-empty standards array", () => {
    for (const profile of BUILTIN_PROFILES) {
      expect(profile.standards.length).toBeGreaterThan(0);
    }
  });

  it("every built-in has a unique name", () => {
    const names = BUILTIN_PROFILES.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every built-in has a non-empty description", () => {
    for (const profile of BUILTIN_PROFILES) {
      expect(profile.description.length).toBeGreaterThan(0);
    }
  });

  it("ships the four canonical scopes an agent will claim against", () => {
    const names = BUILTIN_PROFILES.map((p) => p.name);
    // These four are the scopes the backlog called out — don't drop
    // them silently in a future prune. Adding new names is fine;
    // removing one of these is a contract change.
    expect(names).toContain("wcag21-aa");
    expect(names).toContain("wcag22-aa");
    expect(names).toContain("section508");
    expect(names).toContain("en301549");
  });

  it("WCAG profiles carry a level; framework-scoped profiles omit it", () => {
    const wcagAA = getProfile("wcag22-aa");
    expect(wcagAA?.level).toBe("AA");
    const section508 = getProfile("section508");
    expect(section508?.level).toBeUndefined();
    const en301549 = getProfile("en301549");
    expect(en301549?.level).toBeUndefined();
  });
});

describe("resolveProfile", () => {
  const userProfiles: readonly ConformanceProfile[] = [
    {
      name: "internal-aa-plus",
      standards: ["wcag22", "section508"],
      level: "AA",
      description: "Internal scope combining WCAG 2.2 AA with Section 508.",
    },
  ];

  it("resolves a built-in name even when user profiles are present", () => {
    const resolved = resolveProfile("wcag22-aa", userProfiles);
    expect(resolved?.standards).toEqual(["wcag22"]);
  });

  it("falls back to user profiles when the name is not a built-in", () => {
    const resolved = resolveProfile("internal-aa-plus", userProfiles);
    expect(resolved?.standards).toEqual(["wcag22", "section508"]);
  });

  it("returns undefined for a name absent from both lists", () => {
    expect(resolveProfile("nope", userProfiles)).toBeUndefined();
  });

  it("works without a user-profile overlay", () => {
    expect(resolveProfile("wcag21-a")?.level).toBe("A");
    expect(resolveProfile("nope")).toBeUndefined();
  });
});
