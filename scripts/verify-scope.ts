/**
 * Pure scope predicates for verify.ts `--precommit` mode. Lives in its
 * own module so tests can exercise them without triggering verify.ts's
 * top-level execution (spawn, await, process.exit).
 *
 * Each predicate answers: "given the set of paths that differ from
 * HEAD in the working tree, does this check need to run?" A predicate
 * that returns false means the check is skipped — the underlying
 * concern cannot be affected by the current diff.
 */

export const FULL_SENTINEL: ReadonlySet<string> = new Set<string>(["__ra11y_verify_full__"]);

export function isTs(p: string): boolean {
  return p.endsWith(".ts") || p.endsWith(".tsx");
}

export function anyMatch(c: ReadonlySet<string>, pred: (p: string) => boolean): boolean {
  if (c === FULL_SENTINEL) return true;
  for (const p of c) if (pred(p)) return true;
  return false;
}

export const hasSrcTsChange = (c: ReadonlySet<string>): boolean =>
  anyMatch(c, (p) => p.startsWith("src/") && isTs(p));

export const hasAnyTsChange = (c: ReadonlySet<string>): boolean =>
  anyMatch(
    c,
    (p) =>
      isTs(p) ||
      p === "tsconfig.json" ||
      p === "scripts/tsconfig.json" ||
      p === "tests/tsconfig.json",
  );

export const hasTestOrSrcChange = (c: ReadonlySet<string>): boolean =>
  anyMatch(c, (p) => (p.startsWith("src/") || p.startsWith("tests/")) && isTs(p));

export const hasDocsMdChange = (c: ReadonlySet<string>): boolean =>
  anyMatch(c, (p) => p.startsWith("docs/") && p.endsWith(".md"));

export const hasApiChange = (c: ReadonlySet<string>): boolean =>
  anyMatch(c, (p) => p.startsWith("src/api/") && isTs(p));

export const hasDepsChange = (c: ReadonlySet<string>): boolean =>
  anyMatch(c, (p) => p === "package.json" || p === "bun.lock" || p === "bun.lockb");

export function describeScope(c: ReadonlySet<string> | null): string {
  if (!c || c === FULL_SENTINEL) return "";
  return c.size === 1 ? "1 changed file" : `${c.size} changed files`;
}
