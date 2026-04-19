import { describe, expect, test } from "bun:test";
import { extensionMatches, isStorybookStoryFile } from "../../../src/utils/path.ts";

describe("extensionMatches", () => {
  test("empty allowList matches any extension", () => {
    expect(extensionMatches(".tsx", [])).toBe(true);
    expect(extensionMatches(".xyz", [])).toBe(true);
  });

  test("exact match wins", () => {
    expect(extensionMatches(".tsx", [".tsx", ".jsx"])).toBe(true);
    expect(extensionMatches(".html", [".html", ".htm"])).toBe(true);
  });

  test(".jsx in allowList aliases .js — Next.js style repos have JSX inside .js", () => {
    expect(extensionMatches(".js", [".tsx", ".jsx"])).toBe(true);
    expect(extensionMatches(".js", [".html", ".htm", ".tsx", ".jsx"])).toBe(true);
  });

  test(".tsx in allowList aliases .ts", () => {
    expect(extensionMatches(".ts", [".tsx", ".jsx"])).toBe(true);
    expect(extensionMatches(".ts", [".tsx"])).toBe(true);
  });

  test("no alias when the JSX extension is absent from allowList", () => {
    expect(extensionMatches(".js", [".html", ".htm"])).toBe(false);
    expect(extensionMatches(".ts", [".css"])).toBe(false);
  });

  test("rules that already list .js/.ts explicitly are unaffected", () => {
    expect(extensionMatches(".js", [".tsx", ".jsx", ".ts", ".js"])).toBe(true);
    expect(extensionMatches(".ts", [".tsx", ".jsx", ".ts", ".js"])).toBe(true);
  });

  test("non-JSX extensions don't alias", () => {
    expect(extensionMatches(".css", [".tsx", ".jsx"])).toBe(false);
    expect(extensionMatches(".html", [".tsx", ".jsx"])).toBe(false);
  });
});

describe("isStorybookStoryFile", () => {
  test("matches .stories and .story with every supported JSX/TS extension", () => {
    expect(isStorybookStoryFile("Button.stories.tsx")).toBe(true);
    expect(isStorybookStoryFile("Button.stories.jsx")).toBe(true);
    expect(isStorybookStoryFile("Button.stories.ts")).toBe(true);
    expect(isStorybookStoryFile("Button.stories.js")).toBe(true);
    expect(isStorybookStoryFile("Button.story.tsx")).toBe(true);
    expect(isStorybookStoryFile("Button.story.js")).toBe(true);
  });

  test("matches on absolute paths and nested POSIX paths", () => {
    expect(isStorybookStoryFile("/repo/src/components/Button.stories.tsx")).toBe(true);
    expect(isStorybookStoryFile("src/ui/icons/Icon.stories.tsx")).toBe(true);
  });

  test("matches on Windows-style backslash paths", () => {
    expect(isStorybookStoryFile("C:\\repo\\src\\Button.stories.tsx")).toBe(true);
  });

  test("does not match regular TSX files", () => {
    expect(isStorybookStoryFile("Button.tsx")).toBe(false);
    expect(isStorybookStoryFile("src/Button.test.tsx")).toBe(false);
    expect(isStorybookStoryFile("src/Button.spec.tsx")).toBe(false);
  });

  test("does not match non-JSX extensions even with the .stories marker", () => {
    expect(isStorybookStoryFile("Button.stories.md")).toBe(false);
    expect(isStorybookStoryFile("stories.css")).toBe(false);
  });

  test("is case-sensitive on the .stories / .story marker", () => {
    expect(isStorybookStoryFile("Button.Stories.tsx")).toBe(false);
  });
});
