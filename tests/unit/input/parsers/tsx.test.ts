import { describe, expect, it } from "bun:test";
import { parseTsx } from "../../../../src/input/parsers/tsx.ts";
import type { JsxElement } from "../../../../src/types/ast.ts";

function findFirst(module: ReturnType<typeof parseTsx>["root"], tag: string): JsxElement | null {
  const queue: JsxElement[] = [...module.jsxElements];
  while (queue.length > 0) {
    const el = queue.shift();
    if (!el) break;
    if (el.tagName === tag) return el;
    for (const c of el.children) {
      if (c.kind === "JsxElement") queue.push(c);
    }
  }
  return null;
}

describe("parseTsx", () => {
  it("parses an empty module", () => {
    const { root, errors } = parseTsx("");
    expect(root.jsxElements.length).toBe(0);
    expect(errors.length).toBe(0);
  });

  it("parses a single element with attributes", () => {
    const { root } = parseTsx('const x = <img src="logo.png" alt="Logo" />;');
    const img = findFirst(root, "img");
    expect(img).not.toBeNull();
    expect(img?.selfClosing).toBe(true);
    expect(img?.attributes.length).toBe(2);
    expect(img?.attributes[0]?.name).toBe("src");
    expect(img?.attributes[0]?.value?.kind).toBe("StringLiteral");
  });

  it("parses JSX with expression attribute", () => {
    const { root } = parseTsx("const x = <div className={styles.root}>hi</div>;");
    const div = findFirst(root, "div");
    expect(div).not.toBeNull();
    expect(div?.attributes[0]?.name).toBe("className");
    expect(div?.attributes[0]?.value?.kind).toBe("Expression");
  });

  it("skips spread attributes without crashing", () => {
    const { root } = parseTsx("const x = <div {...rest} id='a' />;");
    const div = findFirst(root, "div");
    expect(div).not.toBeNull();
    expect(div?.attributes.length).toBe(1);
    expect(div?.attributes[0]?.name).toBe("id");
  });

  it("parses component tag names (PascalCase)", () => {
    const { root } = parseTsx("const x = <Card>inside</Card>;");
    const card = findFirst(root, "Card");
    expect(card).not.toBeNull();
  });

  it("parses namespaced and dotted tag names", () => {
    const { root } = parseTsx("const x = <Menu.Item>go</Menu.Item>;");
    const item = findFirst(root, "Menu.Item");
    expect(item).not.toBeNull();
  });

  it("treats void elements as self-closing without explicit slash", () => {
    const { root } = parseTsx("const x = <img src='a'>;");
    const img = findFirst(root, "img");
    expect(img?.selfClosing).toBe(true);
  });

  it("parses nested elements", () => {
    const { root } = parseTsx("const x = <ul><li>a</li><li>b</li></ul>;");
    const ul = findFirst(root, "ul");
    expect(ul?.children.length).toBe(2);
  });

  it("extracts JSX text content", () => {
    const { root } = parseTsx("const x = <p>hello world</p>;");
    const p = findFirst(root, "p");
    expect(p?.children[0]?.kind).toBe("JsxText");
  });

  it("ignores strings and comments in surrounding JS", () => {
    const src = `
      // <p>comment</p>
      const s = '<img src="no">';
      const real = <img alt="yes" />;
    `;
    const { root } = parseTsx(src);
    // Only the "real" img should be picked up — the comment and
    // string literal should be skipped by the scanner.
    const imgs = root.jsxElements.filter((e) => e.tagName === "img");
    expect(imgs.length).toBe(1);
    const altAttr = imgs[0]?.attributes.find((a) => a.name === "alt");
    expect(altAttr?.value).toEqual({ kind: "StringLiteral", value: "yes" });
  });

  it("does not loop forever on random garbage", () => {
    const garbage = "const x = <<<>{{{}}}<a <b<c;";
    expect(() => parseTsx(garbage)).not.toThrow();
  });

  it("records recoverable error on unclosed element", () => {
    const { errors } = parseTsx("const x = <div><p>oops");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.recoverable).toBe(true);
  });
});
