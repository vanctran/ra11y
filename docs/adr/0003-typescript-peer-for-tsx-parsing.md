---
title: "ADR 0003: TypeScript as an optional peer dependency for TSX parsing"
status: Accepted
date: 2026-04-11
---

# ADR 0003: TypeScript as an optional peer dependency for TSX parsing

## Status

Accepted.

## Context

ra11y scans TSX and JSX source. Every popular JSX parser is either very large (`@babel/parser` is 2MB unminified with its own dep tree), incomplete on TypeScript syntax (`acorn-jsx` doesn't know about type parameters or satisfies expressions), or requires a WASM runtime (SWC).

Writing a full TypeScript parser from scratch is not a reasonable use of engineering time — the TS grammar is large and TC39 keeps adding to it (decorators, using declarations, satisfies expressions, import attributes). Keeping a hand-rolled parser current would consume the project.

But the zero-runtime-dependency invariant (ADR 0001) means we can't put `typescript` in `dependencies`.

## Decision

`typescript` is listed in `peerDependencies` with `"optional": true`. The v0.0.x TSX parser is a minimal hand-rolled recognizer that handles the JSX subset we care about; when the TS compiler API is available at runtime, we upgrade to a full parse.

```jsonc
{
  "peerDependencies": { "typescript": ">=5.4.0" },
  "peerDependenciesMeta": { "typescript": { "optional": true } }
}
```

Consumer behavior:

- Most modern projects already have TypeScript in their dev dependencies. ra11y picks it up via `require.resolve("typescript")` and uses the compiler API for full-fidelity parsing.
- Projects without TypeScript get the minimal parser. It handles the common JSX patterns (`<Tag>`, `<Tag prop={x}>`, `<Tag prop="s">`, `<Tag />`) and degrades gracefully on complex TS-only syntax.
- No install-time nag. ra11y works out of the box.

## Consequences

**Benefits**
- Zero runtime deps remains true by the strict definition (the `dependencies` object is empty).
- Any TypeScript version the user is already running is the version we parse against — no "TS 5.6 shipped a new syntax form and ra11y's bundled parser is stuck on 5.4" problem.
- Install size stays small for users on JS-only projects.

**Costs**
- Two parser code paths. The minimal parser is tested for the cases the built-in rules need; the compiler-API path is tested via snapshot + a golden fixture set.
- `peerDependency` with `optional: true` is a npm feature that occasionally confuses consumers and CI. We document it in `docs/getting-started.md`.
- We pin `>=5.4.0` — old enough to cover active LTS projects, new enough that the compiler API has `createProgram` / `createSourceFile` stable surface. Upgrading the floor is a minor-version bump.

## Alternatives considered

**Bundle a fork of TypeScript's parser.** Rejected — the compiler source is ~5MB, the fork would drift, and the invariant would only stand by letter.

**Use `acorn-jsx`.** Rejected — it's accurate for JSX but does not handle TypeScript syntax. Real codebases have type annotations.

**Write a complete TS parser from scratch.** Rejected — multi-year engineering task for a feature that is not our differentiator.

**Use Babel or SWC at runtime.** Rejected — both bring dep trees; SWC needs a WASM runtime loader.

## Notes

Plans for v1.0 include publishing a standalone `@ra11y/parser-typescript` subpackage that wraps the compiler API with a stable output shape. That would convert this from a peer dependency to a pluggable parser interface, allowing users with unusual setups (Deno, edge runtimes) to ship their own.
