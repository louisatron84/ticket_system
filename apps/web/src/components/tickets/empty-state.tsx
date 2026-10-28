import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** An empty screen says what is missing and what to do about it. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="flex flex-col items-start gap-3 rounded-md border border-dashed border-edge-strong px-6 py-10">
      <Icon size={20} aria-hidden="true" className="text-muted" />
      <h2 className="text-base font-semibold">{title}</h2>
      {children && <p className="max-w-prose text-[13px] text-muted">{children}</p>}
      {action}
    </section>
  );
}
