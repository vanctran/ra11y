import type { ReactNode } from "react";

interface NavBarProps {
  logo: ReactNode;
  children?: ReactNode;
}

export function NavBar({ logo, children }: NavBarProps) {
  return (
    <nav className="flex items-center justify-between px-6 py-4 bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-700 shadow-sm">
      <div className="flex items-center gap-4">{logo}</div>
      <div className="flex items-center gap-2">{children}</div>
    </nav>
  );
}
