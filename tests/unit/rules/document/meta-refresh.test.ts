import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/document/meta-refresh.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule document/meta-refresh", () => {
  describe("fires as error when", () => {
    it("content has non-zero delay with url (redirect)", () => {
      const violations = runRule(rule, `<meta http-equiv="refresh" content="5; url=/new-page">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.ruleId).toBe("document/meta-refresh");
      expect(violations[0]?.severity).toBe("error");
      expect(violations[0]?.message).toContain("5");
      expect(violations[0]?.message).toContain("/new-page");
      expect(violations[0]?.suggestion).toContain("301");
    });

    it("content has non-zero delay with no url (auto-reload)", () => {
      const violations = runRule(rule, `<meta http-equiv="refresh" content="10">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.severity).toBe("error");
      expect(violations[0]?.message).toContain("auto-reload");
      expect(violations[0]?.message).toContain("10");
    });

    it("URL= is uppercase (case-insensitive)", () => {
      const violations = runRule(rule, `<meta http-equiv="refresh" content="3; URL=/other">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.severity).toBe("error");
      expect(violations[0]?.message).toContain("/other");
    });

    it("http-equiv attribute value is uppercase", () => {
      const violations = runRule(rule, `<meta HTTP-EQUIV="Refresh" content="7; url=/elsewhere">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.severity).toBe("error");
    });

    it("content has generous whitespace", () => {
      const violations = runRule(
        rule,
        `<meta http-equiv="refresh" content="  4  ;   url =  /later  ">`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]?.severity).toBe("error");
      expect(violations[0]?.message).toContain("/later");
    });

    it("multiple offending metas produce one violation each", () => {
      const violations = runRule(
        rule,
        `<html><head>
          <meta http-equiv="refresh" content="5; url=/a">
          <meta http-equiv="refresh" content="15">
          <meta http-equiv="refresh" content="2; url=/b">
        </head></html>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(3);
      expect(violations.every((v) => v.severity === "error")).toBe(true);
    });
  });

  describe("fires as warning when", () => {
    it("content has zero delay with url (client-side instant redirect)", () => {
      const violations = runRule(rule, `<meta http-equiv="refresh" content="0; url=/new-page">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.severity).toBe("warning");
      expect(violations[0]?.message).toContain("client-side");
      expect(violations[0]?.suggestion).toContain("server-side");
      expect(violations[0]?.suggestion).toContain("301");
    });

    it("content is just 0 (instant reload)", () => {
      const violations = runRule(rule, `<meta http-equiv="refresh" content="0">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.severity).toBe("warning");
    });

    it("zero-delay url value is quoted", () => {
      const violations = runRule(rule, `<meta http-equiv="refresh" content='0; url="/new-page"'>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.severity).toBe("warning");
      expect(violations[0]?.message).toContain("/new-page");
    });
  });

  describe("does not fire when", () => {
    it("content attribute is missing entirely", () => {
      const violations = runRule(rule, `<meta http-equiv="refresh">`, { filePath: "index.html" });
      expect(violations).toHaveLength(0);
    });

    it("content is malformed (non-numeric delay)", () => {
      const violations = runRule(rule, `<meta http-equiv="refresh" content="soon; url=/x">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("content is empty", () => {
      const violations = runRule(rule, `<meta http-equiv="refresh" content="">`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("meta is not an http-equiv refresh", () => {
      const violations = runRule(
        rule,
        `<meta charset="utf-8"><meta name="viewport" content="width=device-width">`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(0);
    });

    it("http-equiv is a different directive", () => {
      const violations = runRule(
        rule,
        `<meta http-equiv="content-type" content="text/html; charset=utf-8">`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(0);
    });

    it("document has no meta elements at all", () => {
      const violations = runRule(
        rule,
        `<html><head><title>ok</title></head><body>hi</body></html>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(0);
    });
  });

  describe("rule metadata", () => {
    it("declares 2.2.1, 2.2.4, and 3.2.5 across wcag22/wcag21", () => {
      expect(rule.satisfies).toContain("wcag22:2.2.1");
      expect(rule.satisfies).toContain("wcag21:2.2.1");
      expect(rule.satisfies).toContain("wcag22:2.2.4");
      expect(rule.satisfies).toContain("wcag21:2.2.4");
      expect(rule.satisfies).toContain("wcag22:3.2.5");
      expect(rule.satisfies).toContain("wcag21:3.2.5");
    });

    it("is a document-scoped html-only rule", () => {
      expect(rule.scope).toBe("document");
      expect(rule.appliesTo?.fileExtensions).toEqual([".html", ".htm"]);
    });
  });
});
