import { describe, expect, it } from "bun:test";
import { parseTailwind } from "../../../../src/input/parsers/tailwind.ts";
import {
  resolveTailwindClasses,
  resolveTailwindToken,
} from "../../../../src/input/resolvers/theme.ts";

function resolveOne(cls: string) {
  const tokens = parseTailwind(cls);
  expect(tokens).toHaveLength(1);
  const firstToken = tokens[0];
  if (firstToken === undefined) throw new Error("no token");
  return resolveTailwindToken(firstToken);
}

describe("resolveTailwindToken — sizing", () => {
  it("resolves w-4 via the spacing scale", () => {
    expect(resolveOne("w-4")).toEqual([{ property: "width", value: "1rem" }]);
  });

  it("resolves h-screen to 100vh (not 100vw)", () => {
    expect(resolveOne("h-screen")).toEqual([{ property: "height", value: "100vh" }]);
  });

  it("resolves w-screen to 100vw", () => {
    expect(resolveOne("w-screen")).toEqual([{ property: "width", value: "100vw" }]);
  });

  it("resolves min-h-screen", () => {
    expect(resolveOne("min-h-screen")).toEqual([{ property: "min-height", value: "100vh" }]);
  });

  it("resolves w-full and h-auto", () => {
    expect(resolveOne("w-full")).toEqual([{ property: "width", value: "100%" }]);
    expect(resolveOne("h-auto")).toEqual([{ property: "height", value: "auto" }]);
  });

  it("resolves fractional w-1/2", () => {
    expect(resolveOne("w-1/2")).toEqual([{ property: "width", value: "50%" }]);
  });

  it("passes through arbitrary values w-[200px]", () => {
    expect(resolveOne("w-[200px]")).toEqual([{ property: "width", value: "200px" }]);
  });

  it("rewrites underscores back to spaces in arbitrary values", () => {
    expect(resolveOne("w-[calc(100%_-_2rem)]")).toEqual([
      { property: "width", value: "calc(100% - 2rem)" },
    ]);
  });

  it("returns null for unknown sizing keyword", () => {
    expect(resolveOne("w-banana")).toBeNull();
  });
});

describe("resolveTailwindToken — spacing (padding/margin)", () => {
  it("resolves p-4 to a single padding", () => {
    expect(resolveOne("p-4")).toEqual([{ property: "padding", value: "1rem" }]);
  });

  it("expands px-2 to padding-left + padding-right", () => {
    expect(resolveOne("px-2")).toEqual([
      { property: "padding-left", value: "0.5rem" },
      { property: "padding-right", value: "0.5rem" },
    ]);
  });

  it("resolves pt-0.5 using the fractional spacing scale", () => {
    expect(resolveOne("pt-0.5")).toEqual([{ property: "padding-top", value: "0.125rem" }]);
  });

  it("negates -mt-2", () => {
    expect(resolveOne("-mt-2")).toEqual([{ property: "margin-top", value: "-0.5rem" }]);
  });

  it("keeps 0 unsigned when negated", () => {
    expect(resolveOne("-m-0")).toEqual([{ property: "margin", value: "0px" }]);
  });

  it("resolves ps-4 to padding-inline-start", () => {
    expect(resolveOne("ps-4")).toEqual([{ property: "padding-inline-start", value: "1rem" }]);
  });

  it("returns null for unknown spacing key", () => {
    expect(resolveOne("p-banana")).toBeNull();
  });
});

describe("resolveTailwindToken — gap", () => {
  it("resolves gap-2", () => {
    expect(resolveOne("gap-2")).toEqual([{ property: "gap", value: "0.5rem" }]);
  });
  it("resolves gap-x-4 to column-gap", () => {
    expect(resolveOne("gap-x-4")).toEqual([{ property: "column-gap", value: "1rem" }]);
  });
  it("resolves gap-y-1 to row-gap", () => {
    expect(resolveOne("gap-y-1")).toEqual([{ property: "row-gap", value: "0.25rem" }]);
  });
});

describe("resolveTailwindToken — colors", () => {
  it("resolves text-red-500 from the default palette", () => {
    expect(resolveOne("text-red-500")).toEqual([{ property: "color", value: "#ef4444" }]);
  });

  it("resolves bg-slate-100", () => {
    expect(resolveOne("bg-slate-100")).toEqual([
      { property: "background-color", value: "#f1f5f9" },
    ]);
  });

  it("resolves bg-[#abc] arbitrary color", () => {
    expect(resolveOne("bg-[#abc]")).toEqual([{ property: "background-color", value: "#abc" }]);
  });

  it("resolves base colors: transparent, currentColor, white", () => {
    expect(resolveOne("text-transparent")).toEqual([{ property: "color", value: "transparent" }]);
    expect(resolveOne("text-current")).toEqual([{ property: "color", value: "currentColor" }]);
    expect(resolveOne("bg-white")).toEqual([{ property: "background-color", value: "#ffffff" }]);
  });

  it("returns null for unknown color family", () => {
    expect(resolveOne("text-banana-500")).toBeNull();
  });

  it("returns null for unknown shade", () => {
    expect(resolveOne("text-red-999")).toBeNull();
  });
});

describe("resolveTailwindToken — color /modifier opacity", () => {
  it("applies /50 as 0.5 alpha to a hex palette color", () => {
    expect(resolveOne("text-red-500/50")).toEqual([
      { property: "color", value: "rgb(239 68 68 / 0.5)" },
    ]);
  });

  it("accepts arbitrary [.4] modifier as literal decimal", () => {
    expect(resolveOne("text-red-500/[.4]")).toEqual([
      { property: "color", value: "rgb(239 68 68 / 0.4)" },
    ]);
  });

  it("drops alpha on keyword colors (currentColor)", () => {
    expect(resolveOne("text-current/50")).toEqual([{ property: "color", value: "currentColor" }]);
  });

  it("handles short #abc hex", () => {
    expect(resolveOne("bg-[#abc]/50")).toEqual([
      { property: "background-color", value: "rgb(170 187 204 / 0.5)" },
    ]);
  });

  it("rejects out-of-range numeric modifier", () => {
    expect(resolveOne("text-red-500/250")).toBeNull();
  });

  it("rejects non-numeric modifier", () => {
    expect(resolveOne("text-red-500/foo")).toBeNull();
  });
});

describe("resolveTailwindToken — typography", () => {
  it("resolves text-lg to paired font-size + line-height", () => {
    expect(resolveOne("text-lg")).toEqual([
      { property: "font-size", value: "1.125rem" },
      { property: "line-height", value: "1.75rem" },
    ]);
  });

  it("resolves text-[14px] as font-size passthrough", () => {
    expect(resolveOne("text-[14px]")).toEqual([{ property: "font-size", value: "14px" }]);
  });

  it("resolves leading-tight", () => {
    expect(resolveOne("leading-tight")).toEqual([{ property: "line-height", value: "1.25" }]);
  });

  it("resolves leading-6 from the numeric scale", () => {
    expect(resolveOne("leading-6")).toEqual([{ property: "line-height", value: "1.5rem" }]);
  });
});

describe("resolveTailwindToken — borders", () => {
  it("resolves bare `border` to 1px border-width", () => {
    expect(resolveOne("border")).toEqual([{ property: "border-width", value: "1px" }]);
  });

  it("resolves border-2", () => {
    expect(resolveOne("border-2")).toEqual([{ property: "border-width", value: "2px" }]);
  });

  it("resolves border-t (top side, default 1px)", () => {
    expect(resolveOne("border-t")).toEqual([{ property: "border-top-width", value: "1px" }]);
  });

  it("resolves border-x-4 (horizontal sides, 4px)", () => {
    expect(resolveOne("border-x-4")).toEqual([
      { property: "border-left-width", value: "4px" },
      { property: "border-right-width", value: "4px" },
    ]);
  });

  it("resolves border-red-500 as border-color", () => {
    expect(resolveOne("border-red-500")).toEqual([{ property: "border-color", value: "#ef4444" }]);
  });
});

describe("resolveTailwindToken — radius & opacity", () => {
  it("resolves rounded (default radius)", () => {
    expect(resolveOne("rounded")).toEqual([{ property: "border-radius", value: "0.25rem" }]);
  });
  it("resolves rounded-full", () => {
    expect(resolveOne("rounded-full")).toEqual([{ property: "border-radius", value: "9999px" }]);
  });
  it("resolves opacity-50", () => {
    expect(resolveOne("opacity-50")).toEqual([{ property: "opacity", value: "0.5" }]);
  });
});

describe("resolveTailwindToken — unknown / breakpoints / malformed", () => {
  it("returns null for truly unknown utilities", () => {
    expect(resolveOne("totally-made-up")).toBeNull();
    expect(resolveOne("flex")).toBeNull(); // flex/grid are out of scope
  });

  it("ignores variants — resolver operates on utility only", () => {
    // `md:` is a breakpoint variant handled by parser; the resolver
    // should still resolve the underlying utility.
    expect(resolveOne("md:w-4")).toEqual([{ property: "width", value: "1rem" }]);
  });

  it("returns null for malformed tokens (unclosed bracket)", () => {
    expect(resolveOne("w-[200px")).toBeNull();
  });
});

describe("resolveTailwindClasses — batch", () => {
  it("resolves a class string to a flat declaration array", () => {
    const result = resolveTailwindClasses("p-2 text-red-500 unknown-class");
    expect(result).toEqual([
      { property: "padding", value: "0.5rem" },
      { property: "color", value: "#ef4444" },
    ]);
  });

  it("flattens multi-declaration utilities (text size + line-height)", () => {
    const result = resolveTailwindClasses("text-lg");
    expect(result).toEqual([
      { property: "font-size", value: "1.125rem" },
      { property: "line-height", value: "1.75rem" },
    ]);
  });

  it("skips unresolved tokens silently", () => {
    expect(resolveTailwindClasses("flex grid")).toEqual([]);
  });

  it("accepts the empty string", () => {
    expect(resolveTailwindClasses("")).toEqual([]);
  });
});
