import type { ReactNode } from "react";

interface BannerProps {
  children: ReactNode;
  onDismiss?: () => void;
  variant?: "info" | "warning";
}

export function Banner({ children, onDismiss, variant = "info" }: BannerProps) {
  const styles = {
    info: "bg-blue-600 text-white",
    warning: "bg-yellow-400 text-yellow-900",
  };
  return (
    <div className={`w-full px-4 py-3 flex items-center justify-between gap-4 ${styles[variant]}`}>
      <p className="text-sm font-medium">{children}</p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss banner"
          className="flex-shrink-0 rounded p-1 hover:bg-black/10 focus-visible:ring-2 focus-visible:ring-white"
        >
          <span aria-hidden="true">&times;</span>
        </button>
      )}
    </div>
  );
}
