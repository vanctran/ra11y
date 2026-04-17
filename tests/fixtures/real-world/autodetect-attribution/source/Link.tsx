import type { AnchorHTMLAttributes, ReactNode } from "react";

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  children: ReactNode;
}

/**
 * Native-anchor wrapper. The auto-detector picks this up because it
 * carries an `onClick` prop at call sites in App.tsx — marking it as
 * a native-element wrapper candidate.
 */
export function Link({ children, ...props }: LinkProps) {
  return <a {...props}>{children}</a>;
}
