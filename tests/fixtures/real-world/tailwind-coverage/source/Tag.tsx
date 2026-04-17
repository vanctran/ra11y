interface TagProps {
  label: string;
  onRemove?: () => void;
}

export function Tag({ label, onRemove }: TagProps) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-300">
      {label}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          className="ml-0.5 rounded-full p-0.5 hover:bg-gray-200 dark:hover:bg-slate-600 focus-visible:ring-1 focus-visible:ring-gray-400"
        >
          <span aria-hidden="true" className="text-xs leading-none">&times;</span>
        </button>
      )}
    </span>
  );
}
