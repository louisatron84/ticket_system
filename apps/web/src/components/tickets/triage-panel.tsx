'use client';

import type { Member, Priority, TriageInfo } from '@forge/shared';
import { Filter } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { buttonClass, inputClass } from '@/lib/ui';

type Mode = null | 'accept' | 'accept_warming' | 'duplicate' | 'decline' | 'snooze' | 'reject';

const failure = (error: unknown) =>
  error instanceof ApiRequestError ? error.message : 'Something went wrong. Try again.';

/**
 * A ticket in triage: what it is waiting for, and what can be done. Every decision but Snooze is
 * a proposal another person approves. The server enforces all of it; this only offers what fits.
 */
export function TriagePanel({
  organisationId,
  ticketKey,
  triage,
  viewerId,
  canDecide,
  canAssign,
  members,
  priorities,
}: {
  organisationId: string;
  ticketKey: string;
  triage: TriageInfo;
  viewerId: string;
  /** tickets.edit */
  canDecide: boolean;
  canAssign: boolean;
  members: Member[];
  priorities: Priority[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [assigneeId, setAssigneeId] = useState('');
  const [priorityId, setPriorityId] = useState('');
  const [text, setText] = useState('');
  const base = `/api/v1/orgs/${organisationId}/tickets/${ticketKey}/triage`;
  const proposal = triage.proposal;
  const mine = proposal?.proposedBy.id === viewerId;

  async function send(path: string, json: unknown, done: string) {
    setBusy(true);
    try {
      await apiFetch(`${base}/${path}`, { method: 'POST', json });
      toast.success(done);
      setMode(null);
      setText('');
      router.refresh();
    } catch (error) {
      toast.error(failure(error));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === 'accept' || mode === 'accept_warming') {
      void send(
        'propose',
        {
          action: mode,
          details: {
            ...(assigneeId ? { assigneeId } : {}),
            ...(priorityId ? { priorityId } : {}),
          },
        },
        'Proposed. It needs a second person to approve.',
      );
    } else if (mode === 'duplicate') {
      void send(
        'propose',
        { action: 'duplicate', details: { originalKey: text.trim() } },
        'Proposed. It needs a second person to approve.',
      );
    } else if (mode === 'decline') {
      void send(
        'propose',
        { action: 'decline', details: { reason: text.trim() } },
        'Proposed. It needs a second person to approve.',
      );
    } else if (mode === 'snooze') {
      void send('snooze', { until: text }, `Snoozed until ${text}.`);
    } else if (mode === 'reject') {
      void send(
        'decide',
        { decision: 'reject', note: text.trim() },
        'Rejected; it is back in the queue.',
      );
    }
  }

  const choice = (value: Exclude<Mode, null | 'reject'>, label: string) => (
    <button
      type="button"
      className={buttonClass(mode === value ? 'primary' : 'secondary')}
      disabled={busy}
      onClick={() => setMode(mode === value ? null : value)}
    >
      {label}
    </button>
  );

  return (
    <section
      aria-labelledby="triage-heading"
      className="flex flex-col gap-3 rounded-md border border-active/40 bg-active/5 p-4"
    >
      <h2 id="triage-heading" className="flex items-center gap-2 text-[13px] font-semibold">
        <Filter size={14} aria-hidden="true" />
        {triage.state === 'snoozed'
          ? `In triage, snoozed until ${triage.snoozedUntil?.slice(0, 10)}`
          : proposal
            ? 'In triage: awaiting approval'
            : 'In triage: waiting for a decision'}
      </h2>

      {proposal && (
        <div className="flex flex-col gap-2 text-[13px]">
          <p>
            <strong>{proposal.proposedBy.displayName}</strong> proposes: {proposal.summary}.
          </p>
          {canDecide && mine && (
            <p className="text-muted">Someone else has to approve or reject your proposal.</p>
          )}
          {canDecide && !mine && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={buttonClass('primary')}
                disabled={busy}
                onClick={() =>
                  void send('decide', { decision: 'approve' }, 'Approved and carried out.')
                }
              >
                Approve
              </button>
              <button
                type="button"
                className={buttonClass('secondary')}
                disabled={busy}
                onClick={() => setMode(mode === 'reject' ? null : 'reject')}
              >
                Reject
              </button>
            </div>
          )}
        </div>
      )}

      {canDecide && triage.state === 'waiting' && !proposal && (
        <div className="flex flex-wrap gap-2">
          {choice('accept', 'Accept')}
          {choice('accept_warming', 'Accept to Warming')}
          {choice('duplicate', 'Duplicate of…')}
          {choice('decline', 'Decline')}
          {choice('snooze', 'Snooze')}
        </div>
      )}

      {mode && (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          {(mode === 'accept' || mode === 'accept_warming') && (
            <>
              {canAssign && members.length > 0 && (
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Assignee
                  <select
                    value={assigneeId}
                    onChange={(event) => setAssigneeId(event.target.value)}
                    className={`${inputClass()} w-48`}
                  >
                    <option value="">Leave as it is</option>
                    {members.map((m) => (
                      <option key={m.user.id} value={m.user.id}>
                        {m.user.displayName}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="flex flex-col gap-1 text-xs text-muted">
                Priority
                <select
                  value={priorityId}
                  onChange={(event) => setPriorityId(event.target.value)}
                  className={`${inputClass()} w-40`}
                >
                  <option value="">Leave as it is</option>
                  {[...priorities]
                    .sort((a, b) => b.rank - a.rank)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
            </>
          )}
          {(mode === 'duplicate' || mode === 'decline' || mode === 'reject') && (
            <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-muted">
              {mode === 'duplicate' ? 'Original ticket' : mode === 'decline' ? 'Reason' : 'Why not'}
              <input
                value={text}
                required
                maxLength={300}
                autoFocus
                placeholder={mode === 'duplicate' ? 'WEB-12' : ''}
                onChange={(event) => setText(event.target.value)}
                className={inputClass()}
              />
            </label>
          )}
          {mode === 'snooze' && (
            <label className="flex flex-col gap-1 text-xs text-muted">
              Until
              <input
                type="date"
                value={text}
                required
                onChange={(event) => setText(event.target.value)}
                className={`${inputClass()} w-44`}
              />
            </label>
          )}
          <button type="submit" className={buttonClass('primary')} disabled={busy}>
            {mode === 'snooze' ? 'Snooze' : mode === 'reject' ? 'Reject proposal' : 'Propose'}
          </button>
        </form>
      )}
    </section>
  );
}
