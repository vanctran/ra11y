import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/keyboard/accesskey-duplicate.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule keyboard/accesskey-duplicate", () => {
  // -------------------------------------------------------------------------
  // Violations
  // -------------------------------------------------------------------------

  it("fires when two elements share the same accesskey", () => {
    const v = runRule(
      rule,
      `<button accesskey="s">Save</button><button accesskey="s">Send</button>`,
      { filePath: "index.html" },
    );
    expect(v).toHaveLength(1);
    expect(v[0]?.severity).toBe("error");
    expect(v[0]?.message).toContain('accesskey="s"');
  });

  it("fires case-insensitively (S collides with s)", () => {
    const v = runRule(
      rule,
      `<button accesskey="s">Save</button><button accesskey="S">Send</button>`,
      { filePath: "index.html" },
    );
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain("s");
    // Suggestion should explain the case-insensitive collision.
    expect(v[0]?.suggestion?.toLowerCase()).toContain("case-insensitive");
  });

  it("reports a violation per additional occurrence (three sharing one key → 2 violations)", () => {
    const v = runRule(rule, `<a accesskey="m">A</a><a accesskey="M">B</a><a accesskey="m">C</a>`, {
      filePath: "index.html",
    });
    expect(v).toHaveLength(2);
  });

  it("splits space-separated accesskey tokens and detects cross-list collisions", () => {
    // First element binds both 's' and 'a'. Second element binds 'a' — collision on 'a'.
    const v = runRule(
      rule,
      `<button accesskey="s a">First</button><button accesskey="a">Second</button>`,
      { filePath: "index.html" },
    );
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain('accesskey="a"');
  });

  it("mentions the first element's tag and line in the message", () => {
    const v = runRule(rule, `<button accesskey="x">Save</button>\n<a accesskey="x">Link</a>`, {
      filePath: "index.html",
    });
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain("<button>");
    expect(v[0]?.message).toContain("line 1");
  });

  it("suggestion points to the earlier binding so the user can jump to either", () => {
    const v = runRule(
      rule,
      `<button accesskey="s">Save</button>\n<button accesskey="s">Send</button>`,
      { filePath: "index.html" },
    );
    expect(v[0]?.suggestion).toContain("line 1");
    expect(v[0]?.suggestion).toContain("button");
  });

  // -------------------------------------------------------------------------
  // Non-violations
  // -------------------------------------------------------------------------

  it("does not fire when accesskeys are all distinct", () => {
    const v = runRule(
      rule,
      `<button accesskey="s">Save</button><button accesskey="c">Cancel</button>`,
      { filePath: "index.html" },
    );
    expect(v).toHaveLength(0);
  });

  it("does not fire on an empty accesskey attribute", () => {
    const v = runRule(rule, `<button accesskey="">A</button><button accesskey="">B</button>`, {
      filePath: "index.html",
    });
    expect(v).toHaveLength(0);
  });

  it("does not fire when there are no accesskeys at all", () => {
    const v = runRule(rule, `<button>Save</button><button>Cancel</button>`, {
      filePath: "index.html",
    });
    expect(v).toHaveLength(0);
  });

  it("whitespace-only accesskey values contribute no bindings", () => {
    const v = runRule(rule, `<button accesskey="   ">A</button><button accesskey=" ">B</button>`, {
      filePath: "index.html",
    });
    expect(v).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // JSX
  // -------------------------------------------------------------------------

  it("fires on JSX accessKey duplicates (React camelCase)", () => {
    const v = runRule(
      rule,
      `const x = <div><button accessKey="s">Save</button><button accessKey="s">Send</button></div>;`,
      { filePath: "input.tsx" },
    );
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain('accesskey="s"');
  });

  it("fires on JSX case-insensitive duplicates across tokens", () => {
    const v = runRule(
      rule,
      `const x = <div><button accessKey="s a">A</button><button accessKey="A">B</button></div>;`,
      { filePath: "input.tsx" },
    );
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain('accesskey="a"');
  });

  it("does not fire on JSX when accessKeys are distinct", () => {
    const v = runRule(
      rule,
      `const x = <div><button accessKey="s">Save</button><button accessKey="c">Cancel</button></div>;`,
      { filePath: "input.tsx" },
    );
    expect(v).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  it("cites wcag22:2.1.1 and wcag21:2.1.1", () => {
    expect(rule.satisfies).toContain("wcag22:2.1.1");
    expect(rule.satisfies).toContain("wcag21:2.1.1");
  });
});
