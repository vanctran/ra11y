import { describe, expect, test } from "bun:test";
import {
  describeScope,
  FULL_SENTINEL,
  hasAnyTsChange,
  hasApiChange,
  hasDepsChange,
  hasDocsMdChange,
  hasSrcTsChange,
  hasTestOrSrcChange,
} from "../../../scripts/verify-scope.ts";

const set = (...paths: readonly string[]): ReadonlySet<string> => new Set(paths);

describe("verify-scope predicates", () => {
  test("FULL_SENTINEL makes every predicate fire — fallback when git state is unusable", () => {
    expect(hasSrcTsChange(FULL_SENTINEL)).toBe(true);
    expect(hasAnyTsChange(FULL_SENTINEL)).toBe(true);
    expect(hasTestOrSrcChange(FULL_SENTINEL)).toBe(true);
    expect(hasDocsMdChange(FULL_SENTINEL)).toBe(true);
    expect(hasApiChange(FULL_SENTINEL)).toBe(true);
    expect(hasDepsChange(FULL_SENTINEL)).toBe(true);
  });

  test("empty change set fires no predicate — nothing to verify", () => {
    const empty = set();
    expect(hasSrcTsChange(empty)).toBe(false);
    expect(hasAnyTsChange(empty)).toBe(false);
    expect(hasTestOrSrcChange(empty)).toBe(false);
    expect(hasDocsMdChange(empty)).toBe(false);
    expect(hasApiChange(empty)).toBe(false);
    expect(hasDepsChange(empty)).toBe(false);
  });

  test("src rule edit classifies as src+any+test-or-src; not api, docs, or deps", () => {
    const c = set("src/rules/forms/non-empty-label.ts");
    expect(hasSrcTsChange(c)).toBe(true);
    expect(hasAnyTsChange(c)).toBe(true);
    expect(hasTestOrSrcChange(c)).toBe(true);
    expect(hasApiChange(c)).toBe(false);
    expect(hasDocsMdChange(c)).toBe(false);
    expect(hasDepsChange(c)).toBe(false);
  });

  test("src/api edit additionally fires hasApiChange — tsdoc check must run", () => {
    const c = set("src/api/plugin.ts");
    expect(hasApiChange(c)).toBe(true);
    expect(hasSrcTsChange(c)).toBe(true);
    expect(hasAnyTsChange(c)).toBe(true);
    expect(hasTestOrSrcChange(c)).toBe(true);
  });

  test("tests-only edit fires test-or-src and any-ts, but not src-ts or api", () => {
    const c = set("tests/unit/rules/forms/non-empty-label.test.ts");
    expect(hasTestOrSrcChange(c)).toBe(true);
    expect(hasAnyTsChange(c)).toBe(true);
    expect(hasSrcTsChange(c)).toBe(false);
    expect(hasApiChange(c)).toBe(false);
  });

  test("docs markdown edit fires only docs — mermaid the only check that needs to run", () => {
    const c = set("docs/kb/architecture/three-layer-model.md");
    expect(hasDocsMdChange(c)).toBe(true);
    expect(hasSrcTsChange(c)).toBe(false);
    expect(hasAnyTsChange(c)).toBe(false);
    expect(hasTestOrSrcChange(c)).toBe(false);
    expect(hasApiChange(c)).toBe(false);
    expect(hasDepsChange(c)).toBe(false);
  });

  test("package.json edit fires only deps — zero-deps the only check that needs to run", () => {
    const c = set("package.json");
    expect(hasDepsChange(c)).toBe(true);
    expect(hasAnyTsChange(c)).toBe(false);
    expect(hasSrcTsChange(c)).toBe(false);
    expect(hasTestOrSrcChange(c)).toBe(false);
    expect(hasDocsMdChange(c)).toBe(false);
    expect(hasApiChange(c)).toBe(false);
  });

  test("tsconfig.json edit fires any-ts — typecheck and lint must re-run", () => {
    const c = set("tsconfig.json");
    expect(hasAnyTsChange(c)).toBe(true);
    expect(hasSrcTsChange(c)).toBe(false);
    expect(hasDepsChange(c)).toBe(false);
  });

  test("tests/tsconfig.json edit fires any-ts — typecheck-tests must re-run", () => {
    const c = set("tests/tsconfig.json");
    expect(hasAnyTsChange(c)).toBe(true);
    expect(hasSrcTsChange(c)).toBe(false);
    expect(hasTestOrSrcChange(c)).toBe(false);
  });

  test("scripts/tsconfig.json edit fires any-ts — scripts-local typecheck config", () => {
    const c = set("scripts/tsconfig.json");
    expect(hasAnyTsChange(c)).toBe(true);
    expect(hasSrcTsChange(c)).toBe(false);
  });

  test("bun.lock fires deps", () => {
    expect(hasDepsChange(set("bun.lock"))).toBe(true);
    expect(hasDepsChange(set("bun.lockb"))).toBe(true);
  });

  test("unrelated path (.claude hook, script, fixture dir) triggers no predicate", () => {
    expect(hasAnyTsChange(set(".claude/hooks/status.ts"))).toBe(true);
    expect(hasSrcTsChange(set(".claude/hooks/status.ts"))).toBe(false);
    expect(hasApiChange(set(".claude/hooks/status.ts"))).toBe(false);
    expect(hasAnyTsChange(set("tests/fixtures/good/foo/page.html"))).toBe(false);
    expect(hasSrcTsChange(set("tests/fixtures/good/foo/page.html"))).toBe(false);
  });

  test("multi-file change: predicates OR across the set", () => {
    const c = set("src/rules/forms/x.ts", "docs/kb/rules/x.md", "package.json");
    expect(hasSrcTsChange(c)).toBe(true);
    expect(hasDocsMdChange(c)).toBe(true);
    expect(hasDepsChange(c)).toBe(true);
    expect(hasApiChange(c)).toBe(false);
  });
});

describe("describeScope", () => {
  test("null and FULL_SENTINEL collapse to empty string — nothing to report on the full path", () => {
    expect(describeScope(null)).toBe("");
    expect(describeScope(FULL_SENTINEL)).toBe("");
  });

  test("singular vs plural rendering", () => {
    expect(describeScope(set("a.ts"))).toBe("1 changed file");
    expect(describeScope(set("a.ts", "b.ts"))).toBe("2 changed files");
    expect(describeScope(set("a.ts", "b.ts", "c.md"))).toBe("3 changed files");
  });
});
