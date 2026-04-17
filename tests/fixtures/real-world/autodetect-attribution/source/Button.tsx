import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

/**
 * Native-button wrapper. The auto-detector picks this up because the
 * JSX root is a plain `<button>` — `autoDetectWrappers` should register
 * "Button" as a native wrapper for the scan without touching session state.
 */
export function Button({ children, ...props }: ButtonProps) {
  return <button {...props}>{children}</button>;
}
