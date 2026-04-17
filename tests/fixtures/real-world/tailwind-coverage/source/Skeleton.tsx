interface SkeletonProps {
  variant?: "text" | "rect" | "circle";
  width?: string;
  height?: string;
}

export function Skeleton({ variant = "text", width = "w-full", height = "h-4" }: SkeletonProps) {
  const shape = variant === "circle" ? "rounded-full" : variant === "rect" ? "rounded-md" : "rounded";
  return (
    <div
      aria-hidden="true"
      className={`${width} ${height} ${shape} bg-gray-200 dark:bg-slate-700 animate-pulse`}
    />
  );
}

export function SkeletonCard() {
  return (
    <div aria-busy="true" aria-label="Loading content" className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-6 flex flex-col gap-3">
      <Skeleton variant="rect" height="h-40" />
      <Skeleton width="w-3/4" height="h-4" />
      <Skeleton width="w-1/2" height="h-3" />
      <div className="flex gap-2 mt-2">
        <Skeleton variant="rect" width="w-20" height="h-8" />
        <Skeleton variant="rect" width="w-20" height="h-8" />
      </div>
    </div>
  );
}
