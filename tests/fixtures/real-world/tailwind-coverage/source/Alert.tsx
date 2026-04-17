import type { ReactNode } from "react";

interface AlertProps {
  kind: "info" | "success" | "warning" | "error";
  title?: string;
  children: ReactNode;
}

export function Alert({ kind, title, children }: AlertProps) {
  const styles = {
    info: "bg-blue-50 border-blue-300 text-blue-900 dark:bg-blue-950 dark:border-blue-700 dark:text-blue-100",
    success: "bg-green-50 border-green-300 text-green-900 dark:bg-green-950 dark:border-green-700 dark:text-green-100",
    warning: "bg-yellow-50 border-yellow-300 text-yellow-900 dark:bg-yellow-950 dark:border-yellow-700 dark:text-yellow-100",
    error: "bg-red-50 border-red-300 text-red-900 dark:bg-red-950 dark:border-red-700 dark:text-red-100",
  };
  return (
    <div role="alert" className={`border rounded-lg px-4 py-3 ${styles[kind]}`}>
      {title && <p className="font-semibold mb-1">{title}</p>}
      <div className="text-sm">{children}</div>
    </div>
  );
}
