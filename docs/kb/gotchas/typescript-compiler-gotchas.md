---
title: "TypeScript compiler-API gotchas"
topic: gotcha
audience: contributors
---

# TypeScript compiler-API gotchas

ra11y uses the TypeScript compiler API (via the optional peer dep, ADR 0003) for full-fidelity TSX parsing. A few sharp edges we've run into.

## Resolving the peer dep from inside the package

The canonical pattern:

```ts
let ts: typeof import("typescript") | null = null;
try {
  ts = await import("typescript");
} catch {
  // Not installed; fall back to the minimal parser.
}
```

`require.resolve("typescript")` is not safe in ESM; use `import()` with a try/catch. The consumer's TypeScript version, not ours, is what runs.

## `SyntaxKind` numbers drift between major versions

Never hard-code `SyntaxKind` numeric values. Always compare against `ts.SyntaxKind.JsxElement` etc. The enum numbers change across major TS releases and any hard-code becomes a version-specific bug.

## `sourceFile.statements` excludes error nodes

When a file has syntax errors, the compiler may skip malformed sections rather than represent them as error nodes. Rules that walk `sourceFile.statements` miss code inside broken regions. For a11y scanning on real codebases (which have syntax errors!), this matters: we fall back to text-range heuristics for malformed areas.

## `JsxOpeningElement.tagName` can be a complex expression

`<foo.Bar />` has `tagName` as a `PropertyAccessExpression`. `<Foo.Bar.Baz />` chains deeper. Rules that assume `tagName.text` is a string will crash. Always narrow with `ts.isIdentifier` or `ts.isPropertyAccessExpression` first.

## Attribute values are nullable AND complex

```ts
const attr = attributes.properties[0];
if (!ts.isJsxAttribute(attr)) continue;
const value = attr.initializer;  // undefined | StringLiteral | JsxExpression
```

A bare `<input disabled>` has `initializer: undefined`. A string literal has `.text`. A JSX expression has `.expression` which is itself any expression. Rules need to handle all three.

## `TypeChecker` is heavy to initialize

We don't run the type checker on every file — it's O(project-size) and we want fast scans. The type checker is only spun up for the specific rules that need it (rare; most rules work off syntax alone).

## Source position recovery

`node.getStart(sourceFile)` returns a character offset. Converting to line/col is `sourceFile.getLineAndCharacterOfPosition(offset)` and both are **zero-based**. ra11y's AST normalizes to 1-based line + 1-based column at the boundary.

## Declaration files vs source files

`ts.isSourceFile(sf)` returns true for both `.ts` and `.d.ts`. Rules that don't want to scan ambient declarations should check `sf.isDeclarationFile`.

## See also

- [TypeScript Compiler API wiki](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API) — introduction.
- [ADR 0003](../../adr/0003-typescript-peer-for-tsx-parsing.md) — why we use it as a peer dep.
- `src/input/parsers/tsx.ts` — our wrapper.
