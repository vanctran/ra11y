import { describe, expect, it } from "bun:test";
import {
  describeNodeShape,
  findTargetNodeAtLocation,
  type TargetNode,
} from "../../../src/engine/ast-helpers.ts";
import { parseCss, parseHtml, parseTsx } from "../../../src/input/parsers/index.ts";
import type { CssRule, HtmlElement, JsxElement } from "../../../src/types/ast.ts";

/**
 * Unit tests for `describeNodeShape` — the helper that feeds
 * `Violation.groupKey`. Assertions focus on invariants the groupKey
 * recipe depends on: same shape → same string, different shape →
 * different string, never throws.
 */

function firstHtmlElement(source: string, tag: string): HtmlElement {
  const { root } = parseHtml(source);
  const stack: HtmlElement[] = [];
  for (const child of root.children) {
    if (child.kind === "HtmlElement") stack.push(child);
  }
  while (stack.length > 0) {
    const el = stack.pop();
    if (!el) break;
    if (el.tagName.toLowerCase() === tag.toLowerCase()) return el;
    for (const c of el.children) if (c.kind === "HtmlElement") stack.push(c);
  }
  throw new Error(`no <${tag}> found`);
}

function firstJsxElement(source: string, tag: string): JsxElement {
  const { root } = parseTsx(source);
  const walk = (els: readonly JsxElement[]): JsxElement | undefined => {
    for (const el of els) {
      if (el.tagName === tag) return el;
      const inner = walk(el.children.filter((c): c is JsxElement => c.kind === "JsxElement"));
      if (inner) return inner;
    }
    return undefined;
  };
  const found = walk(root.jsxElements);
  if (!found) throw new Error(`no <${tag}> found`);
  return found;
}

function firstCssRule(source: string): CssRule {
  const { root } = parseCss(source);
  for (const node of root.rules) {
    if (node.kind === "CssRule") return node;
  }
  throw new Error("no CSS rule found");
}

describe("describeNodeShape — HTML elements", () => {
  it("identifies img missing alt distinctly from img with alt", () => {
    const missing = firstHtmlElement(`<img src="a.png" />`, "img");
    const present = firstHtmlElement(`<img src="a.png" alt="x" />`, "img");
    expect(describeNodeShape(missing)).not.toBe(describeNodeShape(present));
    expect(describeNodeShape(missing)).toContain("no-alt");
    expect(describeNodeShape(present)).not.toContain("no-alt");
  });

  it("hashes two img-missing-alt from different files to the same shape", () => {
    const a = firstHtmlElement(`<img src="chart.png" />`, "img");
    const b = firstHtmlElement(`<img src="completely-different.jpg" />`, "img");
    expect(describeNodeShape(a)).toBe(describeNodeShape(b));
  });

  it("strips attribute values — alt='a' and alt='b' share a shape", () => {
    const a = firstHtmlElement(`<img src="x" alt="a" />`, "img");
    const b = firstHtmlElement(`<img src="x" alt="b" />`, "img");
    expect(describeNodeShape(a)).toBe(describeNodeShape(b));
  });

  it("preserves attribute NAMES — img with alt vs img with title differ", () => {
    const withAlt = firstHtmlElement(`<img src="x" alt="a" />`, "img");
    const withTitle = firstHtmlElement(`<img src="x" title="a" />`, "img");
    expect(describeNodeShape(withAlt)).not.toBe(describeNodeShape(withTitle));
  });

  it("attribute order is irrelevant (names are sorted)", () => {
    const a = firstHtmlElement(`<img src="x" alt="a" />`, "img");
    const b = firstHtmlElement(`<img alt="a" src="x" />`, "img");
    expect(describeNodeShape(a)).toBe(describeNodeShape(b));
  });

  it("children structure distinguishes text-only from element-only", () => {
    const withText = firstHtmlElement(`<div>hello</div>`, "div");
    const withElement = firstHtmlElement(`<div><span></span></div>`, "div");
    expect(describeNodeShape(withText)).toContain("children=text");
    expect(describeNodeShape(withElement)).toContain("children=element");
  });

  it("empty children yields [children=empty]", () => {
    const empty = firstHtmlElement(`<div></div>`, "div");
    expect(describeNodeShape(empty)).toContain("children=empty");
  });

  it("encodes a missing href on <a> and a missing type on <input>", () => {
    const anchor = firstHtmlElement(`<a>click</a>`, "a");
    const input = firstHtmlElement(`<input />`, "input");
    expect(describeNodeShape(anchor)).toContain("no-href");
    expect(describeNodeShape(input)).toContain("no-type");
  });
});

describe("describeNodeShape — JSX elements", () => {
  it("is stable across files for the same AST shape", () => {
    const a = firstJsxElement(`<button onClick={fn}>Save</button>`, "button");
    const b = firstJsxElement(`<button onClick={save}>Submit</button>`, "button");
    // Same attribute names (onClick), same children shape (text only).
    expect(describeNodeShape(a)).toBe(describeNodeShape(b));
  });

  it("separates text children from expression children", () => {
    const literal = firstJsxElement(`<button>Save</button>`, "button");
    const expr = firstJsxElement(`<button>{label}</button>`, "button");
    expect(describeNodeShape(literal)).toContain("children=text");
    expect(describeNodeShape(expr)).toContain("children=expr");
  });

  it("mixes get a [children=mixed] marker", () => {
    const mixed = firstJsxElement(`<button>Save {label}</button>`, "button");
    expect(describeNodeShape(mixed)).toContain("children=mixed");
  });

  it("spread props are encoded as a distinct shape marker", () => {
    const bare = firstJsxElement(`<button onClick={fn}>x</button>`, "button");
    const spread = firstJsxElement(`<button onClick={fn} {...props}>x</button>`, "button");
    expect(describeNodeShape(bare)).not.toBe(describeNodeShape(spread));
    expect(describeNodeShape(spread)).toContain("[spread]");
  });
});

describe("describeNodeShape — CSS rules", () => {
  it("strips class values but preserves kind and pseudo-classes", () => {
    const a = firstCssRule(`.login:focus-visible { outline: none; }`);
    const b = firstCssRule(`.submit:focus-visible { outline: none; }`);
    expect(describeNodeShape(a)).toBe(describeNodeShape(b));
    expect(describeNodeShape(a)).toContain("focus-visible");
    expect(describeNodeShape(a)).toContain("class-selector");
  });

  it("different pseudo-classes produce different shapes", () => {
    const focus = firstCssRule(`.btn:focus-visible { outline: none; }`);
    const hover = firstCssRule(`.btn:hover { outline: none; }`);
    expect(describeNodeShape(focus)).not.toBe(describeNodeShape(hover));
  });

  it("declaration properties are captured, values stripped", () => {
    const redOutline = firstCssRule(`.a { outline: red; }`);
    const blueOutline = firstCssRule(`.a { outline: blue; }`);
    const colorDecl = firstCssRule(`.a { color: red; }`);
    expect(describeNodeShape(redOutline)).toBe(describeNodeShape(blueOutline));
    expect(describeNodeShape(redOutline)).not.toBe(describeNodeShape(colorDecl));
  });
});

describe("describeNodeShape — invariants", () => {
  it("never throws on any supported node kind", () => {
    const nodes: TargetNode[] = [
      firstHtmlElement(`<img />`, "img"),
      firstJsxElement(`<div />`, "div"),
      firstCssRule(`.a { color: red; }`),
    ];
    for (const n of nodes) expect(() => describeNodeShape(n)).not.toThrow();
  });

  it("is deterministic — calling twice returns the same string", () => {
    const el = firstHtmlElement(`<img src="a" alt="b" />`, "img");
    expect(describeNodeShape(el)).toBe(describeNodeShape(el));
  });
});

describe("findTargetNodeAtLocation", () => {
  it("returns the innermost HTML element at a line/column", () => {
    const source = `<div><img src="x" /></div>`;
    const { root } = parseHtml(source);
    const node = findTargetNodeAtLocation(root, 1, 7);
    expect(node?.kind).toBe("HtmlElement");
    expect((node as HtmlElement).tagName.toLowerCase()).toBe("img");
  });

  it("returns undefined when the location misses every node", () => {
    const { root } = parseHtml(`<div></div>`);
    const node = findTargetNodeAtLocation(root, 99, 99);
    expect(node).toBeUndefined();
  });

  it("returns the innermost JSX element", () => {
    const source = `const x = <div><button>ok</button></div>;`;
    const { root } = parseTsx(source);
    const node = findTargetNodeAtLocation(root, 1, 16);
    expect(node?.kind).toBe("JsxElement");
  });
});
