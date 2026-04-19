// Declared in ra11y.config.ts: nativeWrappers: { Link: "a" }
// Definition drifted to <span>. Call sites that should be flagged for
// link-no-href / link-descriptive-text are now quietly passing.
import type { HTMLAttributes } from "react";

export function Link(props: HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} />;
}
