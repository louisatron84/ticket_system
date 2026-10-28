'use client';

import {
  DEFAULT_TOKEN_DAYS,
  MAX_TOKEN_DAYS,
  type ApiToken,
  type CreatedToken,
  type TokenScope,
} from '@forge/shared';
import { Copy } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormField, describedBy } from '@/components/ui/form-field';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { buttonClass, inputClass } from '@/lib/ui';

type Workspace = { id: string; name: string };

const EXPIRY_CHOICES = [7, 30, 90, 365];

const failure = (error: unknown) =>
  error instanceof ApiRequestError ? error.message : 'Something went wrong. Try again.';

function stateOf(token: ApiToken, now: number): 'active' | 'expired' | 'revoked' {
  if (token.revokedAt) return 'revoked';
  return Date.parse(token.expiresAt) <= now ? 'expired' : 'active';
}

/** Make, see and revoke the tokens the `forge` command signs in with. */
export function TokenManager({
  initial,
  workspaces,
  now,
}: {
  initial: ApiToken[];
  workspaces: Workspace[];
  /** The server's clock, so "expired" reads the same once hydrated. */
  now: string;
}) {
  const [tokens, setTokens] = useState(initial);
  const [name, setName] = useState('');
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? '');
  const [scope, setScope] = useState<TokenScope>('write');
  const [days, setDays] = useState(DEFAULT_TOKEN_DAYS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiToken | null>(null);
  const clock = Date.parse(now);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError('Give the token a name, like the machine it is for.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const made = await apiFetch<CreatedToken>('/api/v1/me/tokens', {
        method: 'POST',
        json: { name: name.trim(), organisationId: workspaceId, scope, expiresInDays: days },
      });
      setTokens((current) => [made.details, ...current]);
      setFresh(made.token);
      setName('');
    } catch (failed) {
      setError(failure(failed));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(token: ApiToken) {
    setBusy(true);
    try {
      await apiFetch(`/api/v1/me/tokens/${token.id}`, { method: 'DELETE' });
      setTokens((current) =>
        current.map((t) => (t.id === token.id ? { ...t, revokedAt: new Date().toISOString() } : t)),
      );
      toast.success(`Revoked "${token.name}". It stops working at once.`);
      setRevoking(null);
    } catch (failed) {
      toast.error(failure(failed));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {fresh && (
        <section
          aria-labelledby="fresh-token-title"
          className="flex flex-col gap-2 rounded-md border border-ok/50 bg-ok/5 p-4"
        >
          <h2 id="fresh-token-title" className="text-[13px] font-semibold">
            Copy your new token now
          </h2>
          <p className="text-[13px] text-muted">
            This is the only time it is shown. Run{' '}
            <code className="font-mono">forge login --token</code> and paste it there; Forge keeps
            only a fingerprint of it.
          </p>
          <div className="flex items-center gap-2">
            <code
              aria-label="Your new token"
              className="min-w-0 flex-1 truncate rounded border border-edge bg-raised px-2 py-1.5 font-mono text-xs"
            >
              {fresh}
            </code>
            <button
              type="button"
              className={buttonClass('secondary')}
              onClick={() => {
                void navigator.clipboard?.writeText(fresh).then(() => toast.success('Copied.'));
              }}
            >
              <Copy size={13} aria-hidden="true" />
              Copy
            </button>
            <button type="button" className={buttonClass('ghost')} onClick={() => setFresh(null)}>
              Done
            </button>
          </div>
        </section>
      )}

      <section aria-labelledby="new-token-title" className="flex flex-col gap-3">
        <h2 id="new-token-title" className="text-base font-semibold">
          New token
        </h2>
        <form onSubmit={create} noValidate className="grid gap-3 sm:grid-cols-2">
          <FormField
            id="token-name"
            label="Name"
            error={error ?? undefined}
            hint="Which machine it is for."
          >
            <input
              id="token-name"
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              aria-describedby={describedBy('token-name')}
              className={inputClass(Boolean(error))}
              placeholder="Work laptop"
            />
          </FormField>
          <FormField id="token-workspace" label="Workspace">
            <select
              id="token-workspace"
              value={workspaceId}
              onChange={(event) => setWorkspaceId(event.target.value)}
              aria-describedby={describedBy('token-workspace')}
              className={inputClass()}
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            id="token-scope"
            label="Can"
            hint="Never more than your role allows, whichever you pick."
          >
            <select
              id="token-scope"
              value={scope}
              onChange={(event) => setScope(event.target.value as TokenScope)}
              aria-describedby={describedBy('token-scope')}
              className={inputClass()}
            >
              <option value="write">Read and change tickets</option>
              <option value="read">Only read</option>
            </select>
          </FormField>
          <FormField id="token-expiry" label="Expires after">
            <select
              id="token-expiry"
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              aria-describedby={describedBy('token-expiry')}
              className={inputClass()}
            >
              {EXPIRY_CHOICES.filter((d) => d <= MAX_TOKEN_DAYS).map((d) => (
                <option key={d} value={d}>
                  {d === 365 ? '1 year' : `${d} days`}
                </option>
              ))}
            </select>
          </FormField>
          <div>
            <button type="submit" className={buttonClass('primary')} disabled={busy}>
              {busy ? 'Creating' : 'Create token'}
            </button>
          </div>
        </form>
      </section>

      <section aria-labelledby="tokens-title" className="flex flex-col gap-3">
        <h2 id="tokens-title" className="text-base font-semibold">
          Your tokens
        </h2>
        {tokens.length === 0 ? (
          <p className="text-[13px] text-muted">
            No tokens yet. Make one above, or run <code className="font-mono">forge login</code> and
            approve it in the browser.
          </p>
        ) : (
          <ul className="divide-y divide-edge rounded-md border border-edge bg-panel text-[13px]">
            {tokens.map((token) => {
              const state = stateOf(token, clock);
              return (
                <li
                  key={token.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {token.name}
                      <span className="ml-2 font-mono text-xs text-muted">{token.hint}</span>
                    </p>
                    <p className="text-xs text-muted">
                      {token.workspace.name} ·{' '}
                      {token.scope === 'write' ? 'read and change' : 'read only'} ·{' '}
                      {state === 'active'
                        ? `expires ${token.expiresAt.slice(0, 10)}`
                        : state === 'expired'
                          ? 'expired'
                          : 'revoked'}{' '}
                      ·{' '}
                      {token.lastUsedAt
                        ? `last used ${token.lastUsedAt.slice(0, 10)}${token.lastUsedIp ? ` from ${token.lastUsedIp}` : ''}`
                        : 'never used'}
                    </p>
                  </div>
                  {state === 'active' && (
                    <button
                      type="button"
                      className={buttonClass('danger')}
                      onClick={() => setRevoking(token)}
                      aria-label={`Revoke ${token.name}`}
                    >
                      Revoke
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={revoking !== null}
        title="Revoke this token?"
        confirmLabel="Revoke token"
        busy={busy}
        onCancel={() => setRevoking(null)}
        onConfirm={() => revoking && void revoke(revoking)}
      >
        {`"${revoking?.name ?? ''}" stops working at once. Any machine using it will have to sign in again.`}
      </ConfirmDialog>
    </div>
  );
}
