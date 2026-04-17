interface LinkButtonProps {
  href: string;
  children: string;
  external?: boolean;
}

export function LinkButton({ href, children, external = false }: LinkButtonProps) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
    >
      {children}
      {external && <span aria-label="(opens in new tab)" className="text-xs">&#8599;</span>}
    </a>
  );
}
