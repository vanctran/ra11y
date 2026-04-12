import { describe, expect, it } from "bun:test";
import { compileGlobs } from "../../../src/utils/glob.ts";

function matcher(patterns: readonly string[]) {
  return compileGlobs(patterns).matches;
}

describe("gitignore-style glob matcher", () => {
  it("exact filename without slashes matches at any depth", () => {
    const m = matcher(["node_modules"]);
    expect(m("node_modules")).toBe(true);
    expect(m("foo/node_modules")).toBe(true);
    expect(m("foo/node_modules/bar.js")).toBe(true);
    expect(m("other.js")).toBe(false);
  });

  it("pattern with slash anchors to root", () => {
    const m = matcher(["app/static/assets"]);
    expect(m("app/static/assets")).toBe(true);
    expect(m("app/static/assets/main.js")).toBe(true);
    expect(m("frontend/app/static/assets")).toBe(false);
  });

  it("leading slash anchors to root", () => {
    const m = matcher(["/dist"]);
    expect(m("dist")).toBe(true);
    expect(m("dist/main.js")).toBe(true);
    expect(m("packages/foo/dist")).toBe(false);
  });

  it("trailing slash means directory and its contents", () => {
    const m = matcher(["coverage/"]);
    expect(m("coverage")).toBe(true);
    expect(m("coverage/lcov.info")).toBe(true);
    expect(m("foo/coverage/lcov.info")).toBe(true);
  });

  it("* matches within a single path segment", () => {
    const m = matcher(["*.log"]);
    expect(m("debug.log")).toBe(true);
    expect(m("logs/debug.log")).toBe(true);
    expect(m("debug.log.old")).toBe(false);
  });

  it("** matches across segments", () => {
    const m = matcher(["**/build/**"]);
    expect(m("build/main.js")).toBe(true);
    expect(m("packages/a/build/main.js")).toBe(true);
    // "**/build/**" targets descendants of build/; to match `build` itself,
    // use `build` or `build/`.
    expect(m("main.js")).toBe(false);
  });

  it("combines multiple patterns with OR", () => {
    const m = matcher(["*.log", "htmlcov/", "storybook-static"]);
    expect(m("debug.log")).toBe(true);
    expect(m("htmlcov/index.html")).toBe(true);
    expect(m("frontend/storybook-static/iframe.html")).toBe(true);
    expect(m("src/Button.tsx")).toBe(false);
  });

  it("ignores blank lines and # comments", () => {
    const m = matcher(["", "  ", "# a comment", "dist"]);
    expect(m("dist/main.js")).toBe(true);
  });

  it("ignores negation patterns (not supported)", () => {
    const m = matcher(["!important.log", "*.log"]);
    expect(m("important.log")).toBe(true); // still matched by the *.log rule
  });

  it("escapes regex metacharacters in literals", () => {
    const m = matcher(["file.name"]);
    expect(m("file.name")).toBe(true);
    expect(m("fileXname")).toBe(false); // dot is literal, not regex wildcard
  });

  it("realistic leela gitignore subset", () => {
    const m = matcher([
      "node_modules/",
      "htmlcov/",
      "app/static/assets/",
      "frontend/storybook-static/",
      "frontend/playwright-report/",
      "*.log",
    ]);
    expect(m("app/static/assets/main.css")).toBe(true);
    expect(m("frontend/storybook-static/iframe.html")).toBe(true);
    expect(m("frontend/playwright-report/index.html")).toBe(true);
    expect(m("htmlcov/index.html")).toBe(true);
    expect(m("debug.log")).toBe(true);
    // Real source should pass through.
    expect(m("app/components/Button.tsx")).toBe(false);
    expect(m("frontend/src/app.tsx")).toBe(false);
  });
});
