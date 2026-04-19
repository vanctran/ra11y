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

  it("records hasSpreadProps on elements with a spread attribute", () => {
    const { root } = parseTsx("const x = <h1 {...props} />;");
    const h1 = findFirst(root, "h1");
    expect(h1?.hasSpreadProps).toBe(true);
  });

  it("hasSpreadProps is false when no spread is present", () => {
    const { root } = parseTsx("const x = <h1 id='a'>hello</h1>;");
    const h1 = findFirst(root, "h1");
    expect(h1?.hasSpreadProps).toBe(false);
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

  describe("TypeScript generics — disambiguation from JSX", () => {
    it("does not treat multi-arg generics as JSX", () => {
      const src = "type X = Pick<Crypto, 'randomUUID' | 'getRandomValues'>;";
      const { root, errors } = parseTsx(src);
      expect(errors.length).toBe(0);
      expect(root.jsxElements.length).toBe(0);
    });

    it("does not treat nested generics as JSX", () => {
      const src = "type X = Partial<Pick<Foo, 'a'>>; type Y = Array<Map<string, number>>;";
      const { root, errors } = parseTsx(src);
      expect(errors.length).toBe(0);
      expect(root.jsxElements.length).toBe(0);
    });

    it("does not treat single-arg generics in type annotations as JSX", () => {
      const src = `
        const arr: Array<string> = [];
        const fn: (x: Promise<void>) => Readonly<Foo> = null as any;
      `;
      const { root, errors } = parseTsx(src);
      expect(errors.length).toBe(0);
      expect(root.jsxElements.length).toBe(0);
    });

    it("does not treat generic type parameters as JSX", () => {
      const src = "function f<T extends Foo>(x: T): T { return x; }";
      const { root, errors } = parseTsx(src);
      expect(errors.length).toBe(0);
      expect(root.jsxElements.length).toBe(0);
    });

    it("does not treat generic function invocations as JSX", () => {
      const src = "const x = identity<string>('hello'); arr.map<number>(toNum);";
      const { root, errors } = parseTsx(src);
      expect(errors.length).toBe(0);
      expect(root.jsxElements.length).toBe(0);
    });

    it("does not treat React.forwardRef type signatures as JSX", () => {
      const src = "type ButtonRef = ForwardRefRenderFunction<HTMLButtonElement, typeof Button>;";
      const { root, errors } = parseTsx(src);
      expect(errors.length).toBe(0);
      expect(root.jsxElements.length).toBe(0);
    });

    it("still parses self-closing JSX followed by a statement terminator", () => {
      // `<img src='a'>;` — lowercase tag name stays JSX even though `;`
      // is in the post-`>` generic-signal set.
      const { root, errors } = parseTsx("const x = <img src='a'>;");
      expect(errors.length).toBe(0);
      expect(root.jsxElements.length).toBe(1);
    });

    it("parses mixed TS generics and real JSX in the same module", () => {
      const src = `
        type Props = Pick<HTMLAttributes<HTMLDivElement>, 'id' | 'className'>;
        export function View(props: Props) {
          return <div id={props.id}><span>hi</span></div>;
        }
      `;
      const { root, errors } = parseTsx(src);
      expect(errors.length).toBe(0);
      const div = findFirst(root, "div");
      expect(div).not.toBeNull();
      expect(div?.attributes[0]?.name).toBe("id");
    });
  });

  describe("Storybook args synthesis", () => {
    // The synthesis pass appends a virtual `<Component/>` to
    // `module.jsxElements` for each story whose `args` is a literal
    // object the parser can resolve, so rules that need to evaluate
    // what Storybook would render get a chance to fire. Each test
    // asserts the synthesized element is present (or absent), the
    // attributes match the literal args, and the `synthesized` marker
    // is honest about provenance.

    function syntheticOf(
      mod: ReturnType<typeof parseTsx>["root"],
      tag: string,
    ): JsxElement | undefined {
      return mod.jsxElements.find(
        (el) => el.tagName === tag && el.synthesized?.source === "storybook-args",
      );
    }

    it("synthesizes a JSX element from literal-string args", () => {
      const src = `
        import type { StoryObj } from "@storybook/react";
        export const Primary: StoryObj<typeof Button> = {
          args: { label: "Click me" },
        };
      `;
      const { root } = parseTsx(src, { filePath: "Button.stories.tsx" });
      const synth = syntheticOf(root, "Button");
      expect(synth).toBeDefined();
      expect(synth?.synthesized).toEqual({ source: "storybook-args", storyName: "Primary" });
      expect(synth?.selfClosing).toBe(true);
      expect(synth?.attributes.length).toBe(1);
      const labelAttr = synth?.attributes[0];
      expect(labelAttr?.name).toBe("label");
      expect(labelAttr?.value).toEqual({ kind: "StringLiteral", value: "Click me" });
    });

    it("preserves attribute kind for numeric and boolean args", () => {
      const src = `
        export const Primary: StoryObj<typeof Button> = {
          args: { count: 42, disabled: true, ratio: 0.5 },
        };
      `;
      const { root } = parseTsx(src, { filePath: "Button.stories.tsx" });
      const synth = syntheticOf(root, "Button");
      expect(synth).toBeDefined();
      const byName = new Map(synth?.attributes.map((a) => [a.name, a.value] as const));
      expect(byName.get("count")).toEqual({ kind: "Expression", raw: "42" });
      expect(byName.get("disabled")).toEqual({ kind: "Expression", raw: "true" });
      expect(byName.get("ratio")).toEqual({ kind: "Expression", raw: "0.5" });
    });

    it("synthesizes from the file-level meta.component when no per-story type is given", () => {
      const src = `
        const meta: Meta<typeof Img> = { component: Img };
        export default meta;
        export const Hero = { args: { src: "hero.png", alt: "" } };
      `;
      const { root } = parseTsx(src, { filePath: "Img.stories.tsx" });
      const synth = syntheticOf(root, "Img");
      expect(synth).toBeDefined();
      expect(synth?.synthesized?.storyName).toBe("Hero");
    });

    it("emits an empty-attributes element when args is `{}`", () => {
      const src = `
        export const Empty: StoryObj<typeof Button> = { args: {} };
      `;
      const { root } = parseTsx(src, { filePath: "Button.stories.tsx" });
      const synth = syntheticOf(root, "Button");
      expect(synth).toBeDefined();
      expect(synth?.attributes.length).toBe(0);
    });

    it("skips synthesis when args contains a spread", () => {
      const src = `
        export const Variant: StoryObj<typeof Button> = {
          args: { ...Primary.args, label: "Override" },
        };
      `;
      const { root } = parseTsx(src, { filePath: "Button.stories.tsx" });
      expect(syntheticOf(root, "Button")).toBeUndefined();
    });

    it("skips synthesis when an arg value is a callback", () => {
      const src = `
        export const WithCallback: StoryObj<typeof Button> = {
          args: { onClick: () => alert("hi"), label: "Click" },
        };
      `;
      const { root } = parseTsx(src, { filePath: "Button.stories.tsx" });
      expect(syntheticOf(root, "Button")).toBeUndefined();
    });

    it("skips synthesis when an arg value is a bare identifier", () => {
      const src = `
        export const WithRef: StoryObj<typeof Button> = {
          args: { onClick: handleClick, label: "x" },
        };
      `;
      const { root } = parseTsx(src, { filePath: "Button.stories.tsx" });
      expect(syntheticOf(root, "Button")).toBeUndefined();
    });

    it("skips synthesis when the component cannot be resolved", () => {
      const src = `
        export const Untyped = { args: { label: "x" } };
      `;
      const { root } = parseTsx(src, { filePath: "Mystery.stories.tsx" });
      expect(
        root.jsxElements.find((el) => el.synthesized?.source === "storybook-args"),
      ).toBeUndefined();
    });

    it("does not synthesize on non-story files", () => {
      const src = `
        export const Primary: StoryObj<typeof Button> = {
          args: { label: "Click me" },
        };
      `;
      const { root } = parseTsx(src, { filePath: "Button.tsx" });
      expect(
        root.jsxElements.find((el) => el.synthesized?.source === "storybook-args"),
      ).toBeUndefined();
    });

    it("does not synthesize when no filePath is supplied", () => {
      const src = `
        export const Primary: StoryObj<typeof Button> = {
          args: { label: "Click me" },
        };
      `;
      const { root } = parseTsx(src);
      expect(
        root.jsxElements.find((el) => el.synthesized?.source === "storybook-args"),
      ).toBeUndefined();
    });

    it("synthesizes once per story with `args`, leaving stories without `args` alone", () => {
      const src = `
        export const First: StoryObj<typeof Button> = { args: { label: "A" } };
        export const Second: StoryObj<typeof Button> = { args: { label: "B" } };
        export const Render: StoryObj<typeof Button> = {
          render: () => <Button label="C" />,
        };
      `;
      const { root } = parseTsx(src, { filePath: "Button.stories.tsx" });
      const synth = root.jsxElements.filter((el) => el.synthesized?.source === "storybook-args");
      expect(synth.length).toBe(2);
      const stories = synth.map((s) => s.synthesized?.storyName).sort();
      expect(stories).toEqual(["First", "Second"]);
    });

    it("does not double-count `args` nested inside `parameters`", () => {
      const src = `
        export const Tunable: StoryObj<typeof Button> = {
          parameters: {
            args: { ignore: "this" },
          },
          args: { label: "real" },
        };
      `;
      const { root } = parseTsx(src, { filePath: "Button.stories.tsx" });
      const synth = syntheticOf(root, "Button");
      expect(synth).toBeDefined();
      expect(synth?.attributes.length).toBe(1);
      expect(synth?.attributes[0]?.name).toBe("label");
    });
  });
});
