'use client';

import { useEffect } from 'react';
import { buttonClass } from '@/lib/ui';

/** Shared body of the error pages. Never prints the error message: it may hold internal detail. */
export function ErrorView({
  error,
  reset,
  standalone = false,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  standalone?: boolean;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const body = (
    <section role="alert" className="flex max-w-prose flex-col gap-3">
      <h1 className="text-xl font-semibold tracking-tight">This page failed to load</h1>
      <p className="text-muted">
        Something went wrong while rendering it. Your data is unaffected. Try again, and if it keeps
        failing, check that the API is running (
        <span className="font-mono text-xs">npm run dev</span>) and look at its log
        {error.digest ? (
          <>
            {' '}
            for reference <code className="font-mono text-xs text-text">{error.digest}</code>
          </>
        ) : null}
        .
      </p>
      <div>
        <button type="button" onClick={reset} className={buttonClass('secondary')}>
          Try again
        </button>
      </div>
    </section>
  );

  return standalone ? (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-4">{body}</main>
  ) : (
    body
  );
}
