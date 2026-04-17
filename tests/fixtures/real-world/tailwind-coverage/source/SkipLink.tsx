interface SkipLinkProps {
  targetId: string;
  label?: string;
}

export function SkipLink({ targetId, label = "Skip to main content" }: SkipLinkProps) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:rounded-md focus:bg-blue-600 focus:text-white focus:font-medium focus:text-sm focus:ring-2 focus:ring-white focus:ring-offset-2"
    >
      {label}
    </a>
  );
}
