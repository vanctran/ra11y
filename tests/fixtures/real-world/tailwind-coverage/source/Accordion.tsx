import type { ReactNode } from "react";

interface AccordionItemProps {
  id: string;
  title: string;
  children: ReactNode;
  open: boolean;
  onToggle: () => void;
}

export function AccordionItem({ id, title, children, open, onToggle }: AccordionItemProps) {
  return (
    <div className="border-b border-gray-200 dark:border-slate-700">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`accordion-panel-${id}`}
          id={`accordion-trigger-${id}`}
          onClick={onToggle}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-gray-900 dark:text-slate-100 hover:bg-gray-50 dark:hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset"
        >
          {title}
          <span aria-hidden="true" className={`ml-2 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
        </button>
      </h3>
      <div
        id={`accordion-panel-${id}`}
        role="region"
        aria-labelledby={`accordion-trigger-${id}`}
        hidden={!open}
        className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300"
      >
        {children}
      </div>
    </div>
  );
}
