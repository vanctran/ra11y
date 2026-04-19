/**
 * Schema validator tests. `validateProfiles` is the entry point the
 * loader wraps — an exhaustive sweep of the accepted and rejected
 * shapes pins the contract the loader's outer try/catch depends on
 * (thrown errors become a stderr warning + defaults fallback). Each
 * rejection path owns its own test so a future refactor that collapses
 * two messages or loses an index prefix trips a red test immediately.
 */

import { describe, expect, it } from "bun:test";

import { BUILTIN_PROFILES } from "../../../src/config/profiles.ts";
import { validateProfiles } from "../../../src/config/schema.ts";

describe("validateProfiles — accepted shapes", () => {
  it("returns an empty array when raw is undefined", () => {
    expect(validateProfiles(undefined)).toEqual([]);
  });

  it("returns an empty array when raw is an empty array", () => {
    expect(validateProfiles([])).toEqual([]);
  });

  it("accepts a minimal profile without a level", () => {
    const out = validateProfiles([
      { name: "internal", standards: ["wcag22"], description: "internal scope" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      name: "internal",
      standards: ["wcag22"],
      description: "internal scope",
    });
  });

  it("accepts a profile with level A", () => {
    const out = validateProfiles([
      { name: "lvl-a", standards: ["wcag22"], level: "A", description: "Level A scope" },
    ]);
    expect(out[0]?.level).toBe("A");
  });

  it("accepts a profile with level AA", () => {
    const out = validateProfiles([
      { name: "lvl-aa", standards: ["wcag22"], level: "AA", description: "Level AA scope" },
    ]);
    expect(out[0]?.level).toBe("AA");
  });

  it("accepts a profile with level AAA", () => {
    const out = validateProfiles([
      { name: "lvl-aaa", standards: ["wcag22"], level: "AAA", description: "Level AAA scope" },
    ]);
    expect(out[0]?.level).toBe("AAA");
  });

  it("accepts multiple profiles with distinct names", () => {
    const out = validateProfiles([
      { name: "custom-a", standards: ["wcag22"], description: "first" },
      { name: "custom-b", standards: ["wcag21", "section508"], level: "AA", description: "second" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]?.name).toBe("custom-a");
    expect(out[1]?.name).toBe("custom-b");
  });

  it("preserves the order of standards within a profile", () => {
    const out = validateProfiles([
      {
        name: "multi",
        standards: ["wcag22", "wcag21", "section508", "en301549"],
        description: "multi-standard scope",
      },
    ]);
    expect(out[0]?.standards).toEqual(["wcag22", "wcag21", "section508", "en301549"]);
  });

  it("omits level when user did not supply it", () => {
    const out = validateProfiles([
      { name: "no-level", standards: ["section508"], description: "no level scope" },
    ]);
    expect(Object.hasOwn(out[0] as object, "level")).toBe(false);
  });
});

describe("validateProfiles — top-level shape rejections", () => {
  it("throws when raw is not an array (object)", () => {
    expect(() => validateProfiles({} as never)).toThrow(
      /profiles must be an array of \{ name, standards, description \} entries/,
    );
  });

  it("throws when raw is a string", () => {
    expect(() => validateProfiles("wcag22" as never)).toThrow(/profiles must be an array/);
  });

  it("throws when raw is null", () => {
    expect(() => validateProfiles(null as never)).toThrow(/profiles must be an array/);
  });

  it("throws when raw is a number", () => {
    expect(() => validateProfiles(42 as never)).toThrow(/profiles must be an array/);
  });
});

describe("validateProfiles — entry shape rejections", () => {
  it("throws when an entry is null", () => {
    expect(() => validateProfiles([null as never])).toThrow(
      /profiles\[0\] must be an object with name, standards, description/,
    );
  });

  it("throws when an entry is undefined", () => {
    expect(() => validateProfiles([undefined as never])).toThrow(
      /profiles\[0\] must be an object with name, standards, description/,
    );
  });

  it("throws when an entry is a string", () => {
    expect(() => validateProfiles(["just-a-name" as never])).toThrow(
      /profiles\[0\] must be an object/,
    );
  });

  it("reports the offending index (second entry bad)", () => {
    expect(() =>
      validateProfiles([
        { name: "good", standards: ["wcag22"], description: "fine" },
        null as never,
      ]),
    ).toThrow(/profiles\[1\] must be an object/);
  });
});

describe("validateProfiles — name rejections", () => {
  it("throws when name is missing", () => {
    expect(() => validateProfiles([{ standards: ["wcag22"], description: "x" } as never])).toThrow(
      /profiles\[0\]\.name must be a non-empty string/,
    );
  });

  it("throws when name is not a string", () => {
    expect(() =>
      validateProfiles([{ name: 7, standards: ["wcag22"], description: "x" } as never]),
    ).toThrow(/profiles\[0\]\.name must be a non-empty string/);
  });

  it("throws when name is an empty string", () => {
    expect(() =>
      validateProfiles([{ name: "", standards: ["wcag22"], description: "x" } as never]),
    ).toThrow(/profiles\[0\]\.name must be a non-empty string/);
  });

  it("throws when name collides with a built-in profile name", () => {
    const builtin = BUILTIN_PROFILES[0];
    expect(builtin).toBeDefined();
    expect(() =>
      validateProfiles([
        { name: builtin?.name as string, standards: ["wcag22"], description: "shadow" },
      ]),
    ).toThrow(/duplicates a built-in profile/);
  });

  it("throws when a user supplies two entries with the same name", () => {
    expect(() =>
      validateProfiles([
        { name: "dup", standards: ["wcag22"], description: "first" },
        { name: "dup", standards: ["wcag22"], description: "second" },
      ]),
    ).toThrow(/profiles\[1\]\.name duplicates an earlier entry: dup/);
  });

  it("reports the built-in collision with the offending name in the message", () => {
    expect(() =>
      validateProfiles([{ name: "wcag22-aa", standards: ["wcag22"], description: "shadow" }]),
    ).toThrow(/wcag22-aa/);
  });
});

describe("validateProfiles — standards rejections", () => {
  it("throws when standards is missing", () => {
    expect(() => validateProfiles([{ name: "x", description: "x" } as never])).toThrow(
      /profiles\[0\]\.standards must be an array of standard IDs/,
    );
  });

  it("throws when standards is not an array", () => {
    expect(() =>
      validateProfiles([{ name: "x", standards: "wcag22", description: "x" } as never]),
    ).toThrow(/profiles\[0\]\.standards must be an array/);
  });

  it("throws when standards is an empty array", () => {
    expect(() => validateProfiles([{ name: "x", standards: [], description: "x" }])).toThrow(
      /profiles\[0\]\.standards is empty/,
    );
  });

  it("throws when a standard entry is not a string", () => {
    expect(() =>
      validateProfiles([{ name: "x", standards: [42 as never], description: "x" }]),
    ).toThrow(/profiles\[0\]\.standards\[0\] must be a non-empty string/);
  });

  it("throws when a standard entry is an empty string", () => {
    expect(() => validateProfiles([{ name: "x", standards: [""], description: "x" }])).toThrow(
      /profiles\[0\]\.standards\[0\] must be a non-empty string/,
    );
  });

  it("reports the offending standard index (second element bad)", () => {
    expect(() =>
      validateProfiles([{ name: "x", standards: ["wcag22", "" as string], description: "x" }]),
    ).toThrow(/profiles\[0\]\.standards\[1\] must be a non-empty string/);
  });
});

describe("validateProfiles — description rejections", () => {
  it("throws when description is missing", () => {
    expect(() => validateProfiles([{ name: "x", standards: ["wcag22"] } as never])).toThrow(
      /profiles\[0\]\.description must be a non-empty string/,
    );
  });

  it("throws when description is not a string", () => {
    expect(() =>
      validateProfiles([{ name: "x", standards: ["wcag22"], description: 7 } as never]),
    ).toThrow(/profiles\[0\]\.description must be a non-empty string/);
  });

  it("throws when description is an empty string", () => {
    expect(() => validateProfiles([{ name: "x", standards: ["wcag22"], description: "" }])).toThrow(
      /profiles\[0\]\.description must be a non-empty string/,
    );
  });
});

describe("validateProfiles — level rejections", () => {
  it("throws when level is a non-enum string", () => {
    expect(() =>
      validateProfiles([
        {
          name: "x",
          standards: ["wcag22"],
          level: "B" as never,
          description: "x",
        },
      ]),
    ).toThrow(/profiles\[0\]\.level must be one of "A" \| "AA" \| "AAA" when supplied/);
  });

  it("throws when level is the wrong type", () => {
    expect(() =>
      validateProfiles([{ name: "x", standards: ["wcag22"], level: 2 as never, description: "x" }]),
    ).toThrow(/profiles\[0\]\.level must be one of/);
  });

  it("throws when level is null (explicitly supplied)", () => {
    expect(() =>
      validateProfiles([
        { name: "x", standards: ["wcag22"], level: null as never, description: "x" },
      ]),
    ).toThrow(/profiles\[0\]\.level must be one of/);
  });

  it("treats an absent level the same as an explicit undefined", () => {
    const out = validateProfiles([
      {
        name: "x",
        standards: ["wcag22"],
        description: "x",
      },
    ]);
    expect(Object.hasOwn(out[0] as object, "level")).toBe(false);
  });

  it("accepts lowercase-insensitive levels only when exactly matching", () => {
    expect(() =>
      validateProfiles([
        { name: "x", standards: ["wcag22"], level: "aa" as never, description: "x" },
      ]),
    ).toThrow(/profiles\[0\]\.level must be one of/);
  });
});

describe("validateProfiles — error path indices", () => {
  it("reports the correct index when the third entry is malformed", () => {
    expect(() =>
      validateProfiles([
        { name: "a", standards: ["wcag22"], description: "x" },
        { name: "b", standards: ["wcag21"], description: "x" },
        { name: "c", standards: [], description: "x" },
      ]),
    ).toThrow(/profiles\[2\]\.standards is empty/);
  });

  it("stops at the first malformed entry (does not aggregate)", () => {
    let caught: Error | undefined;
    try {
      validateProfiles([
        { name: "a", standards: [], description: "x" },
        { name: "b", standards: [], description: "x" },
      ]);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught?.message).toContain("profiles[0]");
    expect(caught?.message).not.toContain("profiles[1]");
  });
});

describe("validateProfiles — output normalization", () => {
  it("returns a fresh array (not the input reference)", () => {
    const input = [{ name: "x", standards: ["wcag22"], description: "x" }];
    const out = validateProfiles(input);
    expect(out).not.toBe(input);
  });

  it("drops unknown top-level keys on entries", () => {
    const out = validateProfiles([
      {
        name: "x",
        standards: ["wcag22"],
        description: "x",
        notes: "ignored",
      } as never,
    ]);
    expect(Object.hasOwn(out[0] as object, "notes")).toBe(false);
  });

  it("creates a fresh standards array per entry", () => {
    const standards = ["wcag22"];
    const out = validateProfiles([{ name: "x", standards, description: "x" }]);
    expect(out[0]?.standards).not.toBe(standards);
    expect(out[0]?.standards).toEqual(["wcag22"]);
  });
});
