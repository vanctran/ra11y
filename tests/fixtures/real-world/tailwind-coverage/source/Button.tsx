import type { ReactNode } from "react";

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost";
}

export function Button({ children, onClick, disabled, variant = "primary" }: ButtonProps) {
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-2",
    secondary: "bg-gray-100 text-gray-900 hover:bg-gray-200 focus-visible:ring-2",
    ghost: "text-gray-700 hover:bg-gray-100 focus-visible:ring-2",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-md font-medium px-4 py-2 text-sm ${variants[variant]}`}
    >
      {children}
    </button>
  );
}
