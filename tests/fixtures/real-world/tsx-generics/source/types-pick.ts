/**
 * `Pick<T, K>` in union position with string literals — this was the
 * canonical shape that pre-2968d87 tripped the JSX-vs-generic
 * classifier. The `<` after `Pick` looked like an opening tag; the
 * following comma + string-union re-entered the tokenizer in a state
 * where `'randomUUID'` was consumed as text children of a phantom
 * element, yielding "Unclosed JSX element" on the rest of the file.
 */
export type WidgetCryptoSubset = Pick<Crypto, "randomUUID" | "getRandomValues">;

export type Split<
  T extends string,
  Sep extends string,
> = T extends `${infer Head}${Sep}${infer Tail}` ? [Head, ...Split<Tail, Sep>] : [T];

/**
 * Nested generics: `Array<Map<string, number>>` was the second common
 * reproduction, because the post-`>` classifier had to handle `>` that
 * closes the outer generic without walking into JSX-element consumer
 * state.
 */
export type BucketMap = Array<Map<string, number>>;

/** Single-arg generic in a type annotation. */
export const slots: Array<string> = [];

/** Function argument whose annotation uses `Promise<void>`. */
export function run(fn: (x: Promise<void>) => Readonly<WidgetCryptoSubset>): void {
  void fn;
}
