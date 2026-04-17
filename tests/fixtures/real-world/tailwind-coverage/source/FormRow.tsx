import type { ReactNode } from "react";

interface FormRowProps {
  children: ReactNode;
  cols?: 1 | 2;
}

export function FormRow({ children, cols = 2 }: FormRowProps) {
  const colClass = cols === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1";
  return (
    <div className={`grid ${colClass} gap-4`}>
      {children}
    </div>
  );
}
