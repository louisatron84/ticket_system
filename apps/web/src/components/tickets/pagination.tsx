import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';

/** "Showing 51–100 of 230" with previous and next. Links, so the page is just another address. */
export function Pagination({
  page,
  pageSize,
  total,
  hrefForPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefForPage: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  const link =
    'inline-flex h-8 items-center gap-1 rounded-md border border-edge-strong bg-raised px-2.5 text-[13px] hover:border-muted';
  const disabled =
    'inline-flex h-8 items-center gap-1 rounded-md border border-edge px-2.5 text-[13px] text-muted opacity-60';

  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-[13px] text-muted" aria-live="polite">
        {total === 0 ? (
          'No tickets'
        ) : (
          <>
            Showing <span className="font-mono text-text">{first}</span>–
            <span className="font-mono text-text">{last}</span> of{' '}
            <span className="font-mono text-text">{total}</span>
          </>
        )}
      </p>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          {page > 1 ? (
            <Link href={hrefForPage(page - 1)} className={link} rel="prev">
              <ChevronLeft size={14} aria-hidden="true" />
              Previous
            </Link>
          ) : (
            <span className={disabled} aria-disabled="true">
              <ChevronLeft size={14} aria-hidden="true" />
              Previous
            </span>
          )}
          <span className="px-1 text-[13px] text-muted">
            Page <span className="font-mono text-text">{page}</span> of{' '}
            <span className="font-mono text-text">{pages}</span>
          </span>
          {page < pages ? (
            <Link href={hrefForPage(page + 1)} className={link} rel="next">
              Next
              <ChevronRight size={14} aria-hidden="true" />
            </Link>
          ) : (
            <span className={disabled} aria-disabled="true">
              Next
              <ChevronRight size={14} aria-hidden="true" />
            </span>
          )}
        </div>
      )}
    </nav>
  );
}
