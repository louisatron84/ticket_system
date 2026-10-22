import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <section className="flex max-w-prose flex-col gap-3">
      <h1 className="text-xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-muted">There is nothing at this address. Check the URL or go back.</p>
      <div>
        <Link
          href="/"
          className="inline-flex h-8 items-center rounded-md border border-edge-strong bg-raised px-3 text-[13px] hover:border-muted"
        >
          Go to Overview
        </Link>
      </div>
    </section>
  );
}
