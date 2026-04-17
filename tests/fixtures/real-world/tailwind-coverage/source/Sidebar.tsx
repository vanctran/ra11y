import type { ReactNode } from "react";

interface SidebarProps {
  children: ReactNode;
  open: boolean;
}

export function Sidebar({ children, open }: SidebarProps) {
  return (
    <aside
      aria-label="Sidebar navigation"
      className={`fixed inset-y-0 left-0 z-40 w-64 bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-700 transform transition-transform md:relative md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
    >
      <div className="flex flex-col h-full overflow-y-auto py-4 px-3">
        {children}
      </div>
    </aside>
  );
}
