'use client';

import type { DevIdentity } from '@forge/shared';
import { Check, FlaskConical } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { buttonClass } from '@/lib/ui';

const messageOf = (error: unknown) =>
  error instanceof ApiRequestError ? error.message : 'Something went wrong.';

/**
 * Development-only: become any seeded test identity without signing out. Rendered only when the
 * API reports development sign-in is on. Switching ends with a full page load so nothing the
 * previous identity could see stays in the browser.
 */
export function DevSwitcher({
  identities,
  currentEmail,
}: {
  identities: DevIdentity[];
  currentEmail: string;
}) {
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function switchTo(key: string) {
    setPendingKey(key);
    try {
      await apiFetch('/api/dev/session', { method: 'POST', json: { key } });
      window.location.assign('/');
    } catch (error) {
      toast.error(messageOf(error));
      setPendingKey(null);
    }
  }

  async function reset() {
    setResetting(true);
    try {
      await apiFetch('/api/dev/reset', { method: 'POST' });
      window.location.assign('/login');
    } catch (error) {
      toast.error(messageOf(error));
      setResetting(false);
      setConfirmingReset(false);
    }
  }

  return (
    <section aria-labelledby="dev-switcher-title" className="border-t border-edge px-3 py-3">
      <h3
        id="dev-switcher-title"
        className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ember"
      >
        <FlaskConical size={13} aria-hidden="true" />
        Development only: switch test account
      </h3>
      <ul className="flex flex-col gap-0.5">
        {identities.map((identity) => {
          const current = identity.email === currentEmail;
          return (
            <li key={identity.key}>
              <button
                type="button"
                onClick={() => switchTo(identity.key)}
                disabled={pendingKey !== null || current}
                aria-current={current ? 'true' : undefined}
                title={identity.description}
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-raised disabled:cursor-default disabled:hover:bg-transparent"
              >
                <span className="min-w-0">
                  <span className="block truncate">{identity.displayName}</span>
                  <span className="block truncate text-xs text-muted">{identity.label}</span>
                </span>
                {current ? (
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
                    <Check size={13} aria-hidden="true" />
                    Current
                  </span>
                ) : pendingKey === identity.key ? (
                  <span className="shrink-0 text-xs text-muted">Switching</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => setConfirmingReset(true)}
        className={`${buttonClass('secondary')} mt-3 w-full`}
      >
        Reset demo data
      </button>

      <ConfirmDialog
        open={confirmingReset}
        title="Reset all demo data?"
        confirmLabel="Reset everything"
        busy={resetting}
        onConfirm={reset}
        onCancel={() => setConfirmingReset(false)}
      >
        This deletes every record in the development database and recreates the seven test accounts.
        You will be signed out. It cannot be undone.
      </ConfirmDialog>
    </section>
  );
}
