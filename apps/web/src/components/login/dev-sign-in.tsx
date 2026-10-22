'use client';

import type { DevIdentity } from '@forge/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { buttonClass } from '@/lib/ui';

export function DevSignIn({ identities }: { identities: DevIdentity[] }) {
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  async function signIn(key: string) {
    setPendingKey(key);
    try {
      await apiFetch('/api/dev/session', { method: 'POST', json: { key } });
      window.location.assign('/');
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not sign in.');
      setPendingKey(null);
    }
  }

  return (
    <ul className="divide-y divide-edge rounded-md border border-edge bg-panel">
      {identities.map((identity) => (
        <li key={identity.key} className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium">{identity.displayName}</p>
            <p className="text-xs text-muted">
              {identity.label}. {identity.description}
            </p>
          </div>
          <button
            type="button"
            onClick={() => signIn(identity.key)}
            disabled={pendingKey !== null}
            aria-label={`Sign in as ${identity.displayName}`}
            className={`${buttonClass('secondary')} shrink-0`}
          >
            {pendingKey === identity.key ? 'Signing in' : 'Sign in'}
          </button>
        </li>
      ))}
    </ul>
  );
}
