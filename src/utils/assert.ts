/**
 * Runtime invariant assertions. Use these to document invariants the
 * type system can't express. A failing assertion throws a distinctive
 * `InvariantError` so call sites can catch it if they want to — but
 * in practice an invariant failure means ra11y is in a broken state
 * and the scan should fail loudly.
 */

export class InvariantError extends Error {
  constructor(message: string) {
    super(`ra11y invariant: ${message}`);
    this.name = "InvariantError";
  }
}

/** Throws if `condition` is falsy. */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new InvariantError(message);
}

/** Narrows an unknown value to a non-null, non-undefined form. */
export function assertDefined<T>(value: T | null | undefined, name: string): asserts value is T {
  if (value === null || value === undefined) {
    throw new InvariantError(`${name} must be defined, got ${String(value)}`);
  }
}

/** Exhaustiveness helper for discriminated unions. */
export function assertNever(value: never, message = "unreachable"): never {
  throw new InvariantError(`${message}: got ${String(value)}`);
}
