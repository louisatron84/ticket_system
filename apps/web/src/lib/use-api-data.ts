'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, apiFetch } from '@/lib/api-client';

/**
 * Loads one API resource for a client component, and loads it again on `reload()` (after a
 * change). An answer for an address the component has since left is dropped.
 */
export function useApiData<T>(
  url: string,
  parse: (raw: unknown) => T,
  failure: string,
): { data: T | null; error: string | null; reload: () => Promise<void> } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchOnce = useCallback(
    () =>
      apiFetch<unknown>(url).then(
        (raw) => ({ ok: true as const, value: parse(raw) }),
        (failed: unknown) => ({
          ok: false as const,
          message: failed instanceof ApiRequestError ? failed.message : failure,
        }),
      ),
    // `parse` is a module-level schema method; the address and message decide what is loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [url, failure],
  );

  useEffect(() => {
    let live = true;
    void fetchOnce().then((result) => {
      if (!live) return;
      if (result.ok) {
        setData(result.value);
        setError(null);
      } else {
        setError(result.message);
      }
    });
    return () => {
      live = false;
    };
  }, [fetchOnce]);

  const reload = useCallback(async () => {
    const result = await fetchOnce();
    if (result.ok) {
      setData(result.value);
      setError(null);
    } else {
      setError(result.message);
    }
  }, [fetchOnce]);

  return { data, error, reload };
}
