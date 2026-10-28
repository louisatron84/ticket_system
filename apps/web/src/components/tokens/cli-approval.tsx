'use client';

import { normaliseUserCode, type CliLoginRequest, type TokenScope } from '@forge/shared';
import { useState, type FormEvent } from 'react';
import { FormField, describedBy } from '@/components/ui/form-field';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { buttonClass, inputClass } from '@/lib/ui';

const failure = (error: unknown) =>
  error instanceof ApiRequestError ? error.message : 'Something went wrong. Try again.';

/**
 * Approving a `forge login`. The person first checks the code shown in their terminal and which
 * machine is asking; only then can they allow it.
 */
export function CliApproval({
  initialCode,
  workspaces,
}: {
  initialCode: string;
  workspaces: { id: string; name: string }[];
}) {
  const [code, setCode] = useState(initialCode);
  const [request, setRequest] = useState<CliLoginRequest | null>(null);
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? '');
  const [scope, setScope] = useState<TokenScope>('write');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<'allowed' | 'denied' | null>(null);

  async function check(event: FormEvent) {
    event.preventDefault();
    const userCode = normaliseUserCode(code);
    if (!userCode) {
      setError('Codes look like ABCD-2345.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setRequest(
        await apiFetch<CliLoginRequest>('/api/v1/cli/login/lookup', {
          method: 'POST',
          json: { userCode },
        }),
      );
    } catch (failed) {
      setError(failure(failed));
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: 'allow' | 'deny') {
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/v1/cli/login/decision', {
        method: 'POST',
        json:
          decision === 'allow'
            ? {
                decision,
                userCode: request.userCode,
                organisationId: workspaceId,
                scope,
                ...(request.fromYourAddress ? {} : { differentAddressConfirmed: confirmed }),
              }
            : { decision, userCode: request.userCode },
      });
      setOutcome(decision === 'allow' ? 'allowed' : 'denied');
    } catch (failed) {
      setError(failure(failed));
    } finally {
      setBusy(false);
    }
  }

  if (outcome) {
    return (
      <p role="status" className="text-[14px]">
        {outcome === 'allowed'
          ? 'Allowed. Go back to your terminal: it is signed in now.'
          : 'Denied. The terminal was not signed in.'}
      </p>
    );
  }

  if (!request) {
    return (
      <form onSubmit={check} noValidate className="flex max-w-sm flex-col gap-3">
        <FormField
          id="cli-code"
          label="Code from your terminal"
          error={error ?? undefined}
          hint="forge login shows it, like ABCD-2345."
        >
          <input
            id="cli-code"
            value={code}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setCode(event.target.value)}
            aria-describedby={describedBy('cli-code')}
            className={`${inputClass(Boolean(error))} font-mono uppercase tracking-widest`}
          />
        </FormField>
        <div>
          <button type="submit" className={buttonClass('primary')} disabled={busy}>
            Continue
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <div className="rounded-md border border-edge bg-panel p-4 text-[13px]">
        <p className="mb-3">
          Check this code matches the one in your own terminal. If you did not just run{' '}
          <code className="font-mono">forge login</code> yourself, or someone sent you this link,
          choose Deny.
        </p>
        <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5">
          <dt className="text-muted">Code</dt>
          <dd className="font-mono text-base tracking-widest">{request.userCode}</dd>
          <dt className="text-muted">Machine</dt>
          <dd>
            {request.machine}
            <span className="ml-1.5 text-xs text-muted">(as the terminal says; not verified)</span>
          </dd>
          <dt className="text-muted">From address</dt>
          <dd className="font-mono text-xs leading-5">{request.requestIp}</dd>
          <dt className="text-muted">Asked at</dt>
          <dd>{new Date(request.requestedAt).toLocaleTimeString()}</dd>
        </dl>
      </div>
      {!request.fromYourAddress && (
        <div role="alert" className="rounded-md border border-fail/50 bg-fail/10 p-4 text-[13px]">
          <p className="mb-2 font-medium">This sign-in came from a different address than yours.</p>
          <p className="mb-3">
            That is normal only if you ran <code className="font-mono">forge login</code> on another
            computer or network yourself. If someone sent you this link, choose Deny: allowing it
            would give them a token in your name.
          </p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I started this sign-in myself
          </label>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="cli-workspace" label="Workspace">
          <select
            id="cli-workspace"
            value={workspaceId}
            onChange={(event) => setWorkspaceId(event.target.value)}
            aria-describedby={describedBy('cli-workspace')}
            className={inputClass()}
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="cli-scope" label="It can" hint="Never more than your role allows.">
          <select
            id="cli-scope"
            value={scope}
            onChange={(event) => setScope(event.target.value as TokenScope)}
            aria-describedby={describedBy('cli-scope')}
            className={inputClass()}
          >
            <option value="write">Read and change tickets</option>
            <option value="read">Only read</option>
          </select>
        </FormField>
      </div>
      <p className="text-xs text-muted">
        The terminal gets a token that lasts 30 days. You can revoke it on the CLI tokens page.
      </p>
      {error && (
        <p role="alert" className="text-xs text-fail">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className={buttonClass('primary')}
          disabled={busy || (!request.fromYourAddress && !confirmed)}
          onClick={() => void decide('allow')}
        >
          Allow
        </button>
        <button
          type="button"
          className={buttonClass('secondary')}
          disabled={busy}
          onClick={() => void decide('deny')}
        >
          Deny
        </button>
      </div>
    </div>
  );
}
