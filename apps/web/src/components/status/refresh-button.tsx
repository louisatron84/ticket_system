'use client';

import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useTransition } from 'react';
import { toast } from 'sonner';

/** Re-runs the server-side status check by refreshing the current route. */
export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending) toast('Status checked');
    wasPending.current = pending;
  }, [pending]);

  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={pending}
      className="flex h-8 shrink-0 items-center gap-2 rounded-md border border-edge-strong bg-raised px-3 text-[13px] hover:border-muted disabled:opacity-60"
    >
      <RefreshCw size={14} aria-hidden="true" className={pending ? 'animate-spin' : ''} />
      {pending ? 'Checking' : 'Check again'}
    </button>
  );
}
