interface DividerProps {
  label?: string;
}

export function Divider({ label }: DividerProps) {
  if (label) {
    return (
      <div className="relative flex items-center gap-3 my-4">
        <div className="flex-1 border-t border-gray-200 dark:border-slate-700" aria-hidden="true" />
        <span className="text-xs text-gray-400 dark:text-slate-500 font-medium whitespace-nowrap">
          {label}
        </span>
        <div className="flex-1 border-t border-gray-200 dark:border-slate-700" aria-hidden="true" />
      </div>
    );
  }
  return <hr className="my-4 border-gray-200 dark:border-slate-700" />;
}
