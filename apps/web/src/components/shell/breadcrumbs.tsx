import Link from 'next/link';
import type { Breadcrumb } from '@/lib/nav';

export function Breadcrumbs({ items }: { items: Breadcrumb[] }) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-1.5 text-[13px]">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            // On a phone only the current page is shown; the parent crumbs return from `sm` up.
            <li
              key={item.label}
              className={`${last ? 'flex' : 'hidden sm:flex'} min-w-0 items-center gap-1.5`}
            >
              {index > 0 && (
                <span aria-hidden="true" className="hidden text-edge-strong sm:inline">
                  /
                </span>
              )}
              {item.href && !last ? (
                <Link href={item.href} className="truncate text-muted hover:text-text">
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? 'page' : undefined}
                  className={`truncate ${last ? 'text-text' : 'text-muted'}`}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
