export function Header({
  title,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="h-11 border-b border-zinc-800 bg-black px-4 flex items-center justify-between sticky top-0 z-30 select-none text-xs font-sans">
      <div>
        {title && (
          <div className="flex items-center gap-2">
            <h1 className="font-semibold text-white tracking-tight">{title}</h1>
            {subtitle && <span className="text-zinc-600">/</span>}
            {subtitle && <span className="text-zinc-400 text-xs">{subtitle}</span>}
          </div>
        )}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </header>
  );
}
