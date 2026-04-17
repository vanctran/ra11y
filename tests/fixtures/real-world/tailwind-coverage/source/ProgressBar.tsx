interface ProgressBarProps {
  value: number;
  max?: number;
  label: string;
  showValue?: boolean;
}

export function ProgressBar({ value, max = 100, label, showValue = false }: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-gray-700 dark:text-slate-300">{label}</span>
        {showValue && (
          <span className="text-gray-500 dark:text-slate-400">{Math.round(pct)}%</span>
        )}
      </div>
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
        className="w-full h-2 rounded-full bg-gray-200 dark:bg-slate-700 overflow-hidden"
      >
        <div
          aria-hidden="true"
          style={{ width: `${pct}%` }}
          className="h-full rounded-full bg-blue-600 transition-all duration-300"
        />
      </div>
    </div>
  );
}
