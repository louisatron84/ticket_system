'use client';

import {
  MILESTONE_HEALTH,
  MILESTONE_HEALTH_LABELS,
  formatEstimate,
  formatPoints,
  milestoneListSchema,
  type Milestone,
  type MilestoneHealth,
  type MilestoneList,
} from '@forge/shared';
import { Flag } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { workspaceHref } from '@/lib/nav';
import { buttonClass, inputClass } from '@/lib/ui';
import { ConfirmDialog } from '../ui/confirm-dialog';

const HEALTH_STYLE: Record<MilestoneHealth, string> = {
  on_track: 'border-ok/40 text-ok',
  at_risk: 'border-ember/40 text-ember',
  off_track: 'border-fail/40 text-fail',
};

function percent(done: number, total: number) {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

function ProgressBar({ milestone, label }: { milestone: Milestone; label: string }) {
  const value = percent(milestone.tickets.done, milestone.tickets.total);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className="h-1.5 w-full overflow-hidden rounded-full bg-raised"
    >
      <div className="h-full rounded-full bg-active" style={{ width: `${value}%` }} />
    </div>
  );
}

function MilestoneCard({
  milestone,
  estimation,
  listHref,
  today,
  canEdit,
  onChange,
  onDelete,
}: {
  milestone: Milestone;
  estimation: MilestoneList['estimation'];
  listHref: string;
  today: string;
  canEdit: boolean;
  onChange: (changes: Record<string, unknown>, done: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(milestone.name);
  const [targetDate, setTargetDate] = useState(milestone.targetDate ?? '');
  const [description, setDescription] = useState(milestone.description);
  const overdue =
    !milestone.closed &&
    milestone.targetDate !== null &&
    milestone.targetDate < today &&
    milestone.tickets.done < milestone.tickets.total;
  const format = estimation === 'points' ? formatPoints : formatEstimate;
  const headingId = `milestone-${milestone.id}`;

  async function save(event: FormEvent) {
    event.preventDefault();
    const saved = await onChange(
      { name: name.trim(), targetDate: targetDate || null, description },
      `Saved ${name.trim()}.`,
    );
    if (saved) setEditing(false);
  }

  return (
    <li
      aria-labelledby={headingId}
      className={`flex flex-col gap-3 rounded-md border border-edge bg-panel p-4 ${
        milestone.closed ? 'opacity-70' : ''
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={headingId} className="flex items-center gap-2 text-[14px] font-semibold">
            <Flag size={14} aria-hidden="true" className="text-muted" />
            {milestone.name}
            {milestone.closed && (
              <span className="rounded border border-edge-strong px-1.5 py-0.5 text-[11px] font-normal text-muted">
                Closed
              </span>
            )}
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            {milestone.targetDate ? (
              <>
                Target <span className="font-mono text-text">{milestone.targetDate}</span>
                {overdue && <span className="ml-1.5 font-medium text-fail">Overdue</span>}
              </>
            ) : (
              'No target date'
            )}
          </p>
          {milestone.description && !editing && (
            <p className="mt-1 max-w-prose whitespace-pre-line text-[13px] text-muted">
              {milestone.description}
            </p>
          )}
        </div>
        {canEdit && !milestone.closed ? (
          <label className="flex items-center gap-2 text-xs text-muted">
            Health
            <select
              value={milestone.health}
              onChange={(event) =>
                void onChange(
                  { health: event.target.value },
                  `${milestone.name} is ${MILESTONE_HEALTH_LABELS[
                    event.target.value as MilestoneHealth
                  ].toLowerCase()}.`,
                )
              }
              className={`${inputClass()} h-7 w-auto py-0 text-xs`}
            >
              {MILESTONE_HEALTH.map((health) => (
                <option key={health} value={health}>
                  {MILESTONE_HEALTH_LABELS[health]}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span
            className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${HEALTH_STYLE[milestone.health]}`}
          >
            {MILESTONE_HEALTH_LABELS[milestone.health]}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <ProgressBar milestone={milestone} label={`${milestone.name} progress`} />
        <p className="text-xs text-muted">
          <span className="font-mono text-text">{milestone.tickets.done}</span> of{' '}
          <span className="font-mono text-text">{milestone.tickets.total}</span> tickets done
          {milestone.estimate.total > 0 && (
            <>
              {' '}
              · <span className="font-mono text-text">
                {format(milestone.estimate.done)}
              </span> of{' '}
              <span className="font-mono text-text">{format(milestone.estimate.total)}</span>
            </>
          )}
        </p>
      </div>

      {editing && (
        <form onSubmit={save} className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-muted">
              Name
              <input
                value={name}
                maxLength={80}
                required
                onChange={(event) => setName(event.target.value)}
                className={inputClass()}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Target date
              <input
                type="date"
                value={targetDate}
                onChange={(event) => setTargetDate(event.target.value)}
                className={inputClass()}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Description
            <textarea
              value={description}
              maxLength={2000}
              rows={3}
              onChange={(event) => setDescription(event.target.value)}
              className={inputClass()}
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" className={buttonClass('primary')} disabled={!name.trim()}>
              Save
            </button>
            <button type="button" className={buttonClass()} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <Link
          href={`${listHref}?milestone=${milestone.id}`}
          className="text-active hover:underline"
        >
          View tickets
        </Link>
        {canEdit && !editing && (
          <>
            <span aria-hidden="true" className="text-edge-strong">
              ·
            </span>
            <button type="button" className="hover:underline" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button
              type="button"
              className="hover:underline"
              onClick={() =>
                void onChange(
                  { closed: !milestone.closed },
                  milestone.closed ? `Reopened ${milestone.name}.` : `Closed ${milestone.name}.`,
                )
              }
            >
              {milestone.closed ? 'Reopen' : 'Close'}
            </button>
            {milestone.tickets.total === 0 && (
              <button type="button" className="text-fail hover:underline" onClick={onDelete}>
                Delete
              </button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

/**
 * A project's milestones: dated goals with how far along their tickets are and a health flag the
 * team sets. People who may edit tickets add, edit, close, reopen and delete them.
 */
export function MilestonesView({
  organisationId,
  slug,
  projectKey,
  initial,
  today,
  canEdit,
}: {
  organisationId: string;
  slug: string;
  projectKey: string;
  initial: MilestoneList;
  today: string;
  canEdit: boolean;
}) {
  const [list, setList] = useState(initial);
  const [name, setName] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Milestone | null>(null);
  const url = `/api/v1/orgs/${organisationId}/projects/${projectKey}/milestones`;
  const listHref = workspaceHref(slug, `/projects/${projectKey}/list`);
  const editable = canEdit && !list.archived;

  async function send(
    path: string,
    init: RequestInit & { json?: unknown },
    done: string,
  ): Promise<boolean> {
    setBusy(true);
    try {
      setList(milestoneListSchema.parse(await apiFetch(path, init)));
      toast.success(done);
      return true;
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not save the change.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const made = await send(
      url,
      { method: 'POST', json: { name: trimmed, ...(targetDate ? { targetDate } : {}) } },
      `Added ${trimmed}.`,
    );
    if (made) {
      setName('');
      setTargetDate('');
    }
  }

  const open = list.milestones.filter((milestone) => !milestone.closed);
  const closed = list.milestones.filter((milestone) => milestone.closed);
  const card = (milestone: Milestone) => (
    <MilestoneCard
      key={milestone.id}
      milestone={milestone}
      estimation={list.estimation}
      listHref={listHref}
      today={today}
      canEdit={editable}
      onChange={(changes, done) =>
        send(`${url}/${milestone.id}`, { method: 'PATCH', json: changes }, done)
      }
      onDelete={() => setDeleting(milestone)}
    />
  );

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      {editable && (
        <form onSubmit={create} className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs text-muted">
            New milestone
            <input
              value={name}
              maxLength={80}
              placeholder="Public beta"
              onChange={(event) => setName(event.target.value)}
              className={inputClass()}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Target date
            <input
              type="date"
              value={targetDate}
              onChange={(event) => setTargetDate(event.target.value)}
              className={inputClass()}
            />
          </label>
          <button type="submit" className={buttonClass('primary')} disabled={busy || !name.trim()}>
            Add milestone
          </button>
        </form>
      )}

      {list.milestones.length === 0 ? (
        <p className="rounded-md border border-dashed border-edge p-6 text-center text-[13px] text-muted">
          No milestones yet.{' '}
          {editable
            ? 'Add one to group tickets towards a dated goal, such as a release.'
            : 'People who can edit tickets can add them.'}
        </p>
      ) : (
        <>
          <section aria-label="Open milestones">
            {open.length > 0 ? (
              <ul className="flex flex-col gap-3">{open.map(card)}</ul>
            ) : (
              <p className="text-[13px] text-muted">Every milestone is closed.</p>
            )}
          </section>
          {closed.length > 0 && (
            <section aria-labelledby="closed-milestones" className="flex flex-col gap-3">
              <h2 id="closed-milestones" className="text-[13px] font-semibold text-muted">
                Closed
              </h2>
              <ul className="flex flex-col gap-3">{closed.map(card)}</ul>
            </section>
          )}
        </>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? 'milestone'}?`}
        confirmLabel="Delete"
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const target = deleting;
          if (!target) return;
          void send(`${url}/${target.id}`, { method: 'DELETE' }, `Deleted ${target.name}.`).then(
            () => setDeleting(null),
          );
        }}
      >
        It has no tickets, so nothing else changes. This cannot be undone.
      </ConfirmDialog>
    </div>
  );
}
