import Link from 'next/link';
import { buttonClass } from '@/lib/ui';

/**
 * Body of the not-found pages. Rendered for any address that matches nothing, and for a
 * workspace the person cannot see: one that exists but is not theirs looks exactly like one that
 * does not exist.
 */
export function NotFoundView({ standalone = false }: { standalone?: boolean }) {
  const body = (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Page not found</h1>
      <p className="max-w-prose text-muted">
        There is nothing at this address, or you don&apos;t have access to it. Check the URL or go
        back.
      </p>
      <div>
        <Link href="/" className={buttonClass('secondary')}>
          Go to Overview
        </Link>
      </div>
    </>
  );

  // Outside the signed-in shell there is no <main> yet; inside it there already is one.
  return standalone ? (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-3 px-4">
      {body}
    </main>
  ) : (
    <section className="flex flex-col gap-3">{body}</section>
  );
}
