interface RadioOption {
  value: string;
  label: string;
  description?: string;
}

interface RadioGroupProps {
  name: string;
  legend: string;
  options: RadioOption[];
  value: string;
  onChange: (value: string) => void;
}

export function RadioGroup({ name, legend, options, value, onChange }: RadioGroupProps) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">{legend}</legend>
      <div className="flex flex-col gap-2">
        {options.map((opt) => (
          <label
            key={opt.value}
            className="flex items-start gap-3 cursor-pointer group"
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={opt.value === value}
              onChange={() => onChange(opt.value)}
              className="mt-0.5 h-4 w-4 text-blue-600 border-gray-300 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            />
            <div>
              <span className="text-sm font-medium text-gray-700 dark:text-slate-300 group-hover:text-gray-900 dark:group-hover:text-slate-100">
                {opt.label}
              </span>
              {opt.description && (
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{opt.description}</p>
              )}
            </div>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
