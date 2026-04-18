/**
 * Context-builder unit tests — focused on the Q2-WRAPMAP-RULES
 * `wrappersForElement` resolution. The rest of RuleContext is exercised
 * end-to-end by every rule test; here we assert the slice that's new:
 *   - no opt-in  → empty set
 *   - opt-in     → only wrappers whose mapping targets the requested tag
 *   - empty map  → empty set
 *   - case-normalized native tag comparison
 */

import { describe, expect, it } from "bun:test";
import { buildContext } from "../../../src/engine/context-builder.ts";
import type { Ast } from "../../../src/types/ast.ts";
import type { EmittedViolation } from "../../../src/types/rule.ts";

function tsxAst(): Ast {
  return {
    language: "tsx",
    root: {
      kind: "TsxModule",
      jsxElements: [],
      range: { start: 0, end: 0 },
    } as unknown as Extract<Ast, { language: "tsx" }>["root"],
    errors: [],
  };
}

function build(
  wrapperTreatsAsElement: string | undefined,
  nativeWrapperElements?: Readonly<Record<string, string>>,
) {
  const sink: EmittedViolation[] = [];
  return buildContext(
    {
      filePath: "input.tsx",
      source: "",
      ast: tsxAst(),
      enabledStandards: new Set(["wcag22"]),
      disableMap: new Map(),
      ...(nativeWrapperElements !== undefined && { nativeWrapperElements }),
    },
    sink,
    wrapperTreatsAsElement,
  );
}

describe("engine buildContext — wrappersForElement", () => {
  it("returns an empty set when the rule has not opted in", () => {
    const ctx = build(undefined, { Link: "a", Avatar: "img" });
    expect(ctx.wrappersForElement.size).toBe(0);
  });

  it("returns an empty set when no mapping was supplied", () => {
    const ctx = build("a");
    expect(ctx.wrappersForElement.size).toBe(0);
  });

  it("includes only wrappers whose mapping targets the opted-in tag", () => {
    const ctx = build("a", { Link: "a", NavLink: "a", Avatar: "img", TextField: "input" });
    expect([...ctx.wrappersForElement].sort()).toEqual(["Link", "NavLink"]);
  });

  it("is empty when no wrapper targets the opted-in tag", () => {
    const ctx = build("a", { Avatar: "img", TextField: "input" });
    expect(ctx.wrappersForElement.size).toBe(0);
  });

  it("case-insensitive native-tag comparison", () => {
    const ctx = build("IMG", { Avatar: "img", Hero: "IMG" });
    expect([...ctx.wrappersForElement].sort()).toEqual(["Avatar", "Hero"]);
  });
});
