import { describe, expect, test } from "bun:test";
import { extensionMatches } from "../../../src/utils/path.ts";

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
