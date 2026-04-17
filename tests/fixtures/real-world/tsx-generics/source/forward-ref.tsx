/**
 * `ForwardRefRenderFunction<HTMLButtonElement, typeof Button>` is the
 * other repeat offender — a type alias whose RHS is a multi-arg
 * generic containing PascalCase identifiers that all look like
 * opening JSX tags to a non-disambiguating tokenizer.
 *
 * Sanitized: original production code referenced a branded design-
 * system button; here we use generic `Widget*` identifiers.
 */
import type { ForwardRefRenderFunction, HTMLAttributes } from "react";

export interface WidgetButtonProps extends HTMLAttributes<HTMLButtonElement> {
  readonly label: string;
}

export type WidgetButtonRef = ForwardRefRenderFunction<HTMLButtonElement, WidgetButtonProps>;

/**
 * The generic is also exercised in call position — `identity<string>(…)`
 * and `arr.map<number>(…)` were false-positive hotspots because the
 * classifier only saw the `<` immediately after an identifier.
 */
export function demoCallSites(values: readonly string[]): readonly number[] {
  const first = identity<string>(values[0] ?? "");
  void first;
  return values.map<number>((v) => v.length);
}

function identity<T>(value: T): T {
  return value;
}
