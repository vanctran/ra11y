interface StatCardProps {
  label: string;
  value: string;
  delta?: string;
  deltaKind?: "up" | "down" | "neutral";
}

export function StatCard({ label, value, delta, deltaKind = "neutral" }: StatCardProps) {
  const deltaColors = {
    up: "text-green-600 dark:text-green-400",
    down: "text-red-600 dark:text-red-400",
    neutral: "text-gray-500 dark:text-slate-400",
  };
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-6">
      <p className="text-sm font-medium text-gray-500 dark:text-slate-400 truncate">{label}</p>
      <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-slate-100">{value}</p>
      {delta && (
        <p className={`mt-1 text-sm ${deltaColors[deltaKind]}`}>
          <span aria-label={`Change: ${delta}`}>{delta}</span>
        </p>
      )}
    </div>
  );
}
