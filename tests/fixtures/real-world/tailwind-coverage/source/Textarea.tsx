interface TextareaProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  maxLength?: number;
  required?: boolean;
}

export function Textarea({ id, label, value, onChange, rows = 4, placeholder, maxLength, required }: TextareaProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-gray-700 dark:text-slate-300">
        {label}
        {required && <span aria-hidden="true" className="ml-1 text-red-500">*</span>}
      </label>
      <textarea
        id={id}
        value={value}
        rows={rows}
        placeholder={placeholder}
        maxLength={maxLength}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
      />
      {maxLength && (
        <p className="text-xs text-gray-400 dark:text-slate-500 text-right">
          {value.length}/{maxLength}
        </p>
      )}
    </div>
  );
}
