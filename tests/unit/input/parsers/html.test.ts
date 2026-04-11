import { describe, expect, it } from "bun:test";
import { parseHtml } from "../../../../src/input/parsers/html.ts";
import type { HtmlElement } from "../../../../src/types/ast.ts";

function findFirst(root: ReturnType<typeof parseHtml>["root"], tag: string): HtmlElement | null {
  const queue: unknown[] = [...root.children];
  while (queue.length > 0) {
    const node = queue.shift() as { kind?: string; tagName?: string; children?: unknown[] };
    if (node?.kind === "HtmlElement" && node.tagName === tag) return node as unknown as HtmlElement;
    if (node?.children) queue.push(...node.children);
  }
  return null;
}

describe("parseHtml", () => {
  it("parses an empty string", () => {
    const { root, errors } = parseHtml("");
    expect(root.kind).toBe("HtmlDocument");
    expect(root.children.length).toBe(0);
    expect(errors.length).toBe(0);
  });

  it("parses a simple element", () => {
    const { root, errors } = parseHtml("<p>hello</p>");
    expect(errors.length).toBe(0);
    const p = findFirst(root, "p");
    expect(p).not.toBeNull();
    expect(p?.children.length).toBe(1);
    expect(p?.children[0]?.kind).toBe("HtmlText");
  });

  it("parses attributes with double quotes", () => {
    const { root } = parseHtml('<img src="logo.png" alt="logo">');
    const img = findFirst(root, "img");
    expect(img).not.toBeNull();
    expect(img?.attributes.length).toBe(2);
    expect(img?.attributes[0]?.name).toBe("src");
    expect(img?.attributes[0]?.value).toBe("logo.png");
    expect(img?.attributes[1]?.name).toBe("alt");
    expect(img?.attributes[1]?.value).toBe("logo");
  });

  it("parses attributes with single quotes", () => {
    const { root } = parseHtml("<img src='logo.png'>");
    const img = findFirst(root, "img");
    expect(img?.attributes[0]?.value).toBe("logo.png");
  });

  it("parses unquoted attribute values", () => {
    const { root } = parseHtml("<img src=logo.png width=64>");
    const img = findFirst(root, "img");
    expect(img?.attributes[0]?.value).toBe("logo.png");
    expect(img?.attributes[1]?.value).toBe("64");
  });

  it("parses boolean attributes (no value)", () => {
    const { root } = parseHtml("<input disabled required>");
    const input = findFirst(root, "input");
    expect(input?.attributes.length).toBe(2);
    expect(input?.attributes[0]?.name).toBe("disabled");
    expect(input?.attributes[0]?.value).toBeNull();
    expect(input?.attributes[1]?.name).toBe("required");
  });

  it("auto-self-closes void elements", () => {
    const { root } = parseHtml("<img src=logo.png>next");
    const img = findFirst(root, "img");
    expect(img?.selfClosing).toBe(true);
    // "next" should be a sibling, not a child of img.
    expect(img?.children.length).toBe(0);
  });

  it("parses nested elements", () => {
    const { root } = parseHtml("<div><p>hello</p><p>world</p></div>");
    const div = findFirst(root, "div");
    expect(div?.children.length).toBe(2);
    expect((div?.children[0] as HtmlElement).tagName).toBe("p");
    expect((div?.children[1] as HtmlElement).tagName).toBe("p");
  });

  it("parses self-closing tags with /", () => {
    const { root } = parseHtml("<br/>");
    const br = findFirst(root, "br");
    expect(br?.selfClosing).toBe(true);
  });

  it("parses HTML comments", () => {
    const { root } = parseHtml("<!-- keep --><p>x</p>");
    expect(root.children[0]?.kind).toBe("HtmlComment");
    expect((root.children[0] as { value: string }).value).toBe(" keep ");
  });

  it("parses a doctype", () => {
    const { root } = parseHtml("<!DOCTYPE html><html></html>");
    expect(root.children[0]?.kind).toBe("HtmlDoctype");
  });

  it("treats script content as raw text (no nested parsing)", () => {
    const { root } = parseHtml("<script>const x = '<p>not a tag</p>';</script>");
    const script = findFirst(root, "script");
    expect(script?.children.length).toBe(1);
    expect(script?.children[0]?.kind).toBe("HtmlText");
    const text = script?.children[0] as { value: string };
    expect(text.value).toContain("<p>not a tag</p>");
  });

  it("treats style content as raw text", () => {
    const { root } = parseHtml("<style>p > a { color: red; }</style>");
    const style = findFirst(root, "style");
    expect(style?.children[0]?.kind).toBe("HtmlText");
  });

  it("decodes named HTML entities in text", () => {
    const { root } = parseHtml("<p>Tom &amp; Jerry &copy; 2026</p>");
    const p = findFirst(root, "p");
    const text = p?.children[0] as { value: string };
    expect(text.value).toBe("Tom & Jerry © 2026");
  });

  it("decodes numeric entities", () => {
    const { root } = parseHtml("<p>&#169; &#x2014;</p>");
    const p = findFirst(root, "p");
    const text = p?.children[0] as { value: string };
    expect(text.value).toBe("© —");
  });

  it("decodes entities in attribute values", () => {
    const { root } = parseHtml('<a href="?a=1&amp;b=2">link</a>');
    const a = findFirst(root, "a");
    expect(a?.attributes[0]?.value).toBe("?a=1&b=2");
  });

  it("records recoverable error for unterminated start tag without throwing", () => {
    const { root, errors } = parseHtml("<p");
    expect(root).toBeDefined();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.recoverable).toBe(true);
  });

  it("records recoverable error for stray closing tag", () => {
    const { root, errors } = parseHtml("</p>");
    expect(root).toBeDefined();
    expect(errors.some((e) => e.message.includes("Stray"))).toBe(true);
  });

  it("records recoverable error for unclosed element but returns the children", () => {
    const { root, errors } = parseHtml("<div><p>hello</div");
    expect(root).toBeDefined();
    expect(errors.length).toBeGreaterThan(0);
  });

  it("parses case-insensitively for tag names", () => {
    const { root } = parseHtml("<IMG SRC=x>");
    const upper = findFirst(root, "IMG");
    expect(upper).not.toBeNull();
  });

  it("matches closing tags case-insensitively", () => {
    const { root, errors } = parseHtml("<div><p>x</P></DIV>");
    expect(errors.length).toBe(0);
    expect(findFirst(root, "div")).not.toBeNull();
  });

  it("records line/column positions", () => {
    const { root } = parseHtml("<p>\n<img>\n</p>");
    const img = findFirst(root, "img");
    expect(img?.loc.start.line).toBe(2);
  });

  it("never throws on random garbage", () => {
    const garbage = "<><<<!doctype??? <x<y<>> &#xZZ; <p><<<";
    expect(() => parseHtml(garbage)).not.toThrow();
  });
});
