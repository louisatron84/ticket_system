'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError } from '@/lib/api-client';

/**
 * Runs a change to a ticket's parents or links: says what happened in a toast and reloads the
 * page's data, since these changes do not move the ticket's version. True when it worked.
 */
export function useStructureAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run(failure: string, action: () => Promise<string | void>): Promise<boolean> {
    setBusy(true);
    try {
      const done = await action();
      if (done) toast.success(done);
      router.refresh();
      return true;
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : failure);
      // Someone else changed it first, or it was archived: show what it is now.
      if (error instanceof ApiRequestError && error.status === 409) router.refresh();
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { busy, run };
}
