interface FooterLink {
  label: string;
  href: string;
}

interface FooterProps {
  links: FooterLink[];
  copyright: string;
}

export function Footer({ links, copyright }: FooterProps) {
  return (
    <footer className="border-t border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-xs text-gray-400 dark:text-slate-500">{copyright}</p>
        <nav aria-label="Footer navigation">
          <ul className="flex flex-wrap items-center gap-4">
            {links.map((link) => (
              <li key={link.label}>
                <a
                  href={link.href}
                  className="text-xs text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100 hover:underline focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
