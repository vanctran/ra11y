interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  label?: string;
}

export function Spinner({ size = "md", label = "Loading" }: SpinnerProps) {
  const sizes = {
    sm: "w-4 h-4 border-2",
    md: "w-8 h-8 border-4",
    lg: "w-12 h-12 border-4",
  };
  return (
    <div role="status" className="inline-flex items-center gap-2">
      <div
        aria-hidden="true"
        className={`${sizes[size]} rounded-full border-gray-200 border-t-blue-600 animate-spin`}
      />
      <span className="sr-only">{label}</span>
    </div>
  );
}
