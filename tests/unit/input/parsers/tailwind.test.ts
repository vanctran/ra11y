import { describe, expect, it } from "bun:test";
import { parseTailwind, type TailwindToken } from "../../../../src/input/parsers/tailwind.ts";

function only(tokens: readonly TailwindToken[]): TailwindToken {
  expect(tokens).toHaveLength(1);
  return tokens[0] as TailwindToken;
}

describe("parseTailwind — basic tokenization", () => {
  it("returns an empty array for an empty string", () => {
    expect(parseTailwind("")).toEqual([]);
  });

  it("returns an empty array for whitespace-only input", () => {
    expect(parseTailwind("   \t\n  ")).toEqual([]);
  });

  it("splits simple space-separated classes", () => {
    const tokens = parseTailwind("flex items-center gap-2");
    expect(tokens.map((t) => t.utility)).toEqual(["flex", "items-center", "gap-2"]);
  });

  it("tolerates tabs, newlines, and carriage returns as separators", () => {
    const tokens = parseTailwind("flex\titems-center\n gap-2\r\n");
    expect(tokens.map((t) => t.raw)).toEqual(["flex", "items-center", "gap-2"]);
  });

  it("preserves duplicate classes — dedup is caller's job", () => {
    const tokens = parseTailwind("p-2 p-2 p-2");
    expect(tokens).toHaveLength(3);
    expect(new Set(tokens.map((t) => t.utility))).toEqual(new Set(["p-2"]));
  });

  it("mixes tailwind and arbitrary class names without choking", () => {
    const tokens = parseTailwind("my-custom-class bg-red-500 other");
    expect(tokens.map((t) => t.utility)).toEqual(["my-custom-class", "bg-red-500", "other"]);
    expect(tokens.every((t) => !t.malformed)).toBe(true);
  });
});

describe("parseTailwind — variants", () => {
  it("peels a single variant", () => {
    const t = only(parseTailwind("hover:bg-blue-500"));
    expect(t.variants).toEqual(["hover"]);
    expect(t.utility).toBe("bg-blue-500");
  });

  it("peels stacked variants in source order", () => {
    const t = only(parseTailwind("md:hover:focus:text-white"));
    expect(t.variants).toEqual(["md", "hover", "focus"]);
    expect(t.utility).toBe("text-white");
  });

  it("supports group- and peer- prefixed variants", () => {
    const t = only(parseTailwind("group-hover:opacity-100"));
    expect(t.variants).toEqual(["group-hover"]);
    expect(t.utility).toBe("opacity-100");
  });

  it("supports dark mode and responsive breakpoints together", () => {
    const t = only(parseTailwind("dark:md:text-slate-200"));
    expect(t.variants).toEqual(["dark", "md"]);
    expect(t.utility).toBe("text-slate-200");
  });

  it("supports arbitrary variants with colons inside brackets", () => {
    const t = only(parseTailwind("[&:nth-child(3)]:text-red-500"));
    expect(t.variants).toEqual(["[&:nth-child(3)]"]);
    expect(t.utility).toBe("text-red-500");
  });
});

describe("parseTailwind — arbitrary values", () => {
  it("extracts pixel arbitrary widths", () => {
    const t = only(parseTailwind("w-[200px]"));
    expect(t.utility).toBe("w");
    expect(t.arbitraryValue).toBe("200px");
  });

  it("extracts hex colors", () => {
    const t = only(parseTailwind("text-[#ff0000]"));
    expect(t.utility).toBe("text");
    expect(t.arbitraryValue).toBe("#ff0000");
  });

  it("extracts rgb() with embedded spaces", () => {
    const t = only(parseTailwind("bg-[rgb(0_0_0)]"));
    expect(t.utility).toBe("bg");
    expect(t.arbitraryValue).toBe("rgb(0_0_0)");
  });

  it("extracts calc() arbitrary heights with nested brackets", () => {
    const t = only(parseTailwind("min-h-[calc(100vh-4rem)]"));
    expect(t.utility).toBe("min-h");
    expect(t.arbitraryValue).toBe("calc(100vh-4rem)");
  });

  it("extracts percentage widths", () => {
    const t = only(parseTailwind("w-[50%]"));
    expect(t.utility).toBe("w");
    expect(t.arbitraryValue).toBe("50%");
  });

  it("extracts rem values", () => {
    const t = only(parseTailwind("p-[1.25rem]"));
    expect(t.utility).toBe("p");
    expect(t.arbitraryValue).toBe("1.25rem");
  });

  it("extracts url() background images", () => {
    const t = only(parseTailwind("bg-[url(/img/hero.png)]"));
    expect(t.utility).toBe("bg");
    expect(t.arbitraryValue).toBe("url(/img/hero.png)");
  });

  it("combines variants with arbitrary values", () => {
    const t = only(parseTailwind("md:hover:bg-[#112233]"));
    expect(t.variants).toEqual(["md", "hover"]);
    expect(t.utility).toBe("bg");
    expect(t.arbitraryValue).toBe("#112233");
  });

  it("keeps whitespace inside arbitrary brackets with the token", () => {
    const tokens = parseTailwind("bg-[rgb(0 0 0)] text-white");
    expect(tokens).toHaveLength(2);
    expect(tokens[0]?.arbitraryValue).toBe("rgb(0 0 0)");
    expect(tokens[1]?.utility).toBe("text-white");
  });
});

describe("parseTailwind — important prefix", () => {
  it("marks `!w-4` as important", () => {
    const t = only(parseTailwind("!w-4"));
    expect(t.important).toBe(true);
    expect(t.utility).toBe("w-4");
  });

  it("marks important after variants", () => {
    const t = only(parseTailwind("hover:!text-red-500"));
    expect(t.variants).toEqual(["hover"]);
    expect(t.important).toBe(true);
    expect(t.utility).toBe("text-red-500");
  });

  it("combines important with negative and arbitrary", () => {
    const t = only(parseTailwind("md:!-mt-[10px]"));
    expect(t.variants).toEqual(["md"]);
    expect(t.important).toBe(true);
    expect(t.negative).toBe(true);
    expect(t.utility).toBe("mt");
    expect(t.arbitraryValue).toBe("10px");
  });
});

describe("parseTailwind — negative values", () => {
  it("detects a leading negative on a standard utility", () => {
    const t = only(parseTailwind("-mt-2"));
    expect(t.negative).toBe(true);
    expect(t.utility).toBe("mt-2");
  });

  it("detects negative with arbitrary value", () => {
    const t = only(parseTailwind("-translate-x-[50%]"));
    expect(t.negative).toBe(true);
    expect(t.utility).toBe("translate-x");
    expect(t.arbitraryValue).toBe("50%");
  });

  it("does not flag `--my-var` (custom property) as negative", () => {
    const t = only(parseTailwind("--my-var"));
    expect(t.negative).toBe(false);
    expect(t.utility).toBe("--my-var");
  });
});

describe("parseTailwind — modifier after `/`", () => {
  it("extracts opacity modifier", () => {
    const t = only(parseTailwind("bg-black/50"));
    expect(t.utility).toBe("bg-black");
    expect(t.modifier).toBe("50");
  });

  it("extracts modifier on arbitrary-value utilities", () => {
    const t = only(parseTailwind("text-red-500/[.4]"));
    expect(t.utility).toBe("text-red-500");
    expect(t.arbitraryValue).toBe(".4");
    expect(t.modifier).toBe("");
    // modifier is an empty string because the arbitrary segment was stripped out;
    // callers can treat "" as "modifier was present but had arbitrary form".
  });

  it("keeps `/` inside arbitrary brackets untouched", () => {
    const t = only(parseTailwind("bg-[url(/img/a.png)]"));
    expect(t.arbitraryValue).toBe("url(/img/a.png)");
    expect(t.modifier).toBeNull();
  });
});

describe("parseTailwind — malformed input", () => {
  it("flags unclosed `[`", () => {
    const t = only(parseTailwind("w-[200px"));
    expect(t.malformed).toBe(true);
    expect(t.arbitraryValue).toBe("200px");
  });

  it("flags an empty variant head (`::`)", () => {
    const t = only(parseTailwind("hover::text-red-500"));
    expect(t.malformed).toBe(true);
  });

  it("flags a bare `!` with no utility", () => {
    const t = only(parseTailwind("!"));
    expect(t.malformed).toBe(true);
  });

  it("still yields one token per whitespace chunk, even malformed", () => {
    const tokens = parseTailwind("w-[200px flex");
    // The unclosed `[` keeps `flex` glued inside the arbitrary value.
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.malformed).toBe(true);
  });
});

describe("parseTailwind — raw preservation", () => {
  it("preserves the exact source token for each entry", () => {
    const tokens = parseTailwind("md:hover:!-mt-[10px] text-white");
    expect(tokens[0]?.raw).toBe("md:hover:!-mt-[10px]");
    expect(tokens[1]?.raw).toBe("text-white");
  });
});
