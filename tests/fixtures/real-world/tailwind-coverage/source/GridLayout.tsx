import type { ReactNode } from "react";

interface GridLayoutProps {
  children: ReactNode;
  cols?: 1 | 2 | 3 | 4;
}

export function GridLayout({ children, cols = 3 }: GridLayoutProps) {
  const colClass = {
    1: "grid-cols-1",
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
  }[cols];
  return (
    <div className={`grid ${colClass} gap-6`}>
      {children}
    </div>
  );
}
