interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-gray-500 dark:text-slate-400">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={item.label} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden="true" className="text-gray-300 dark:text-slate-600">/</span>}
              {isLast ? (
                <span aria-current="page" className="font-medium text-gray-900 dark:text-slate-100">
                  {item.label}
                </span>
              ) : (
                <a
                  href={item.href ?? "#"}
                  className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                >
                  {item.label}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
