// Declared in ra11y.config.ts: nativeWrappers: { Link: "a" }
// Definition renders a real <a>. No drift.
import type { AnchorHTMLAttributes } from "react";

export function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} />;
}
