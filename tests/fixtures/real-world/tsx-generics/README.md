# tsx-generics

Guards against regression of commit `2968d87` — the TSX parser's
TypeScript-generic-vs-JSX disambiguator.

## What this fixture reproduces

Before `2968d87`, the in-house TSX parser treated every `<` that
followed an identifier as the start of a JSX opening tag. That
misclassified common TypeScript generic syntax:

- `Pick<T, K>`
- `Array<string>`, `Array<Map<string, number>>`
- `Promise<void>`, `Readonly<Foo>`
- `ForwardRefRenderFunction<HTMLButtonElement, Props>`
- `identity<string>(x)` / `arr.map<number>(toNum)`

On a real Vite/React/TS codebase, that inflated the parse-error count
to ~40% of files, caused rules not to run below the false error, and
drifted the `opaqueCustomComponents` count by counting `Pick` /
`Array` / etc. as custom JSX tags.

The fix added a three-signal heuristic (preceding context, content
signals, post-`>` context) that runs before the element consumer
commits.

## What this fixture checks

- `source/types-pick.ts` — the pure-type cases (Pick, nested generics,
  single-arg generics in annotations).
- `source/forward-ref.tsx` — the ForwardRef type alias, and
  call-site generics (`identity<T>(x)`, `arr.map<T>(fn)`).
- `source/mixed-jsx.tsx` — generics and real JSX in the same module;
  pre-fix, the generic misparse cascaded into the JSX below.

`assertions.ts` declares:

- `zero-parse-errors` across all three files.
- `no-violation` with `ruleId: "*"` — this fixture is synthetic,
  has no real accessibility bugs, and a violation firing would
  indicate an over-eager rule on generic-looking code.

## Origin

- Commit: `2968d87` (`fix(parser): disambiguate TS generics from JSX in tsx parser`).
- Feedback round: leela-round-1 (Apr 2026).
- Sanitization: branded identifiers (original component names from a
  design system) replaced with `Widget*` generics; structural
  patterns (generic arity, type shapes, JSX children) preserved
  verbatim — they are the reproduction.
