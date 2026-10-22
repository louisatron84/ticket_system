'use client';

import { useEffect } from 'react';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section role="alert" className="flex max-w-prose flex-col gap-3">
      <h1 className="text-xl font-semibold tracking-tight">This page failed to load</h1>
      <p className="text-muted">
        Something went wrong while rendering it. Your data is unaffected. Try again, and if it keeps
        failing, check the server logs
        {error.digest ? (
          <>
            {' '}
            for reference <code className="font-mono text-xs text-text">{error.digest}</code>
          </>
        ) : null}
        .
      </p>
      <div>
        <button
          type="button"
          onClick={reset}
          className="h-8 rounded-md border border-edge-strong bg-raised px-3 text-[13px] hover:border-muted"
        >
          Try again
        </button>
      </div>
    </section>
  );
}
