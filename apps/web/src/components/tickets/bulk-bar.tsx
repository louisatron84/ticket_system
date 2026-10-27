'use client';

import type { BulkTicketBody, Label, Member, Priority } from '@forge/shared';
import { Archive } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { ApiRequestError } from '@/lib/api-client';
import { bulkSummary, bulkUpdate } from '@/lib/ticket-actions';
import { buttonClass, inputClass } from '@/lib/ui';
import { ActionMenu, useActionMenu } from './action-menu';
import { useSelection } from './bulk-selection';
import {
  AssigneeChoices,
  LabelChoices,
  PriorityChoices,
  StatusChoices,
  type MoveTarget,
} from './ticket-choices';

type Changes = BulkTicketBody['changes'];

/** One of the bar's menus: a bordered button with words, and the list it opens. */
function BarMenu({
  name,
  disabled,
  children,
}: {
  name: string;
  disabled: boolean;
  children: (pick: () => void) => ReactNode;
}) {
  const menu = useActionMenu(`bulk:${name}`);
  const picked = () => {
    menu.close();
    menu.restoreFocus();
  };
  return (
    <ActionMenu menu={menu} label={name} appearance="button" icon={name} disabled={disabled}>
      {children(picked)}
    </ActionMenu>
  );
}

function DueDateChoice({ onPick }: { onPick: (dueDate: string | null) => void }) {
  const [date, setDate] = useState('');
  return (
    <div className="flex flex-col gap-2 p-1">
      <label className="flex flex-col gap-1 text-xs text-muted">
        Due date
        <input
          type="date"
          autoFocus
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className={inputClass()}
        />
      </label>
      <button
        type="button"
        disabled={!date}
        onClick={() => onPick(date)}
        className={buttonClass('primary')}
      >
        Set due date
      </button>
      <button type="button" onClick={() => onPick(null)} className={buttonClass('secondary')}>
        Remove due date
      </button>
    </div>
  );
}

/**
 * The bar above the list while tickets are selected: one change for all of them at once. Each
 * ticket succeeds or fails on its own, and the bar says which failed and why. The selection stays,
 * so several changes can be made to the same tickets in a row; tickets that leave the page (an
 * archive, or no longer matching the filters) leave the selection with it.
 */
export function BulkBar({
  organisationId,
  statuses,
  priorities,
  labels,
  members,
}: {
  organisationId: string;
  /** Every status a ticket on the list could move to, one per key. */
  statuses: MoveTarget[];
  priorities: Priority[];
  labels: Label[];
  /** Null when the person may not assign, or may not see who to assign to. */
  members: Member[] | null;
}) {
  const router = useRouter();
  const { selected, dispatch } = useSelection();
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<{ text: string; failures: string[] } | null>(null);

  if (selected.length === 0 && summary === null) return null;

  async function apply(changes: Changes) {
    setBusy(true);
    try {
      const { results } = await bulkUpdate(organisationId, { keys: selected, changes });
      setSummary(bulkSummary(results));
      router.refresh();
    } catch (error) {
      setSummary({
        text: error instanceof ApiRequestError ? error.message : 'Could not change the tickets.',
        failures: [],
      });
    } finally {
      setBusy(false);
    }
  }

  const off = busy || selected.length === 0;

  return (
    <section
      aria-label="Bulk actions"
      className="flex flex-col gap-2 rounded-md border border-edge-strong bg-panel px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        {selected.length > 0 && (
          <span className="text-[13px] font-medium">
            <span className="font-mono">{selected.length}</span> selected
          </span>
        )}
        {statuses.length > 0 && (
          <BarMenu name="Move to…" disabled={off}>
            {(picked) => (
              <StatusChoices
                ticketKey="selected"
                targets={statuses}
                onPick={(statusKey) => {
                  picked();
                  void apply({ statusKey });
                }}
              />
            )}
          </BarMenu>
        )}
        <BarMenu name="Priority…" disabled={off}>
          {(picked) => (
            <PriorityChoices
              ticketKey="selected"
              priorities={priorities}
              currentId=""
              onPick={(priority) => {
                picked();
                void apply({ priorityId: priority.id });
              }}
            />
          )}
        </BarMenu>
        {members && members.length > 0 && (
          <BarMenu name="Assign…" disabled={off}>
            {(picked) => (
              <AssigneeChoices
                ticketKey="selected"
                members={members}
                currentId=""
                includeNone
                onPick={(assigneeId) => {
                  picked();
                  void apply({ assigneeId });
                }}
              />
            )}
          </BarMenu>
        )}
        {labels.length > 0 && (
          <>
            <BarMenu name="Add label…" disabled={off}>
              {(picked) => (
                <LabelChoices
                  label="Add label to selected"
                  labels={labels}
                  onPick={(labelId) => {
                    picked();
                    void apply({ addLabelIds: [labelId] });
                  }}
                />
              )}
            </BarMenu>
            <BarMenu name="Remove label…" disabled={off}>
              {(picked) => (
                <LabelChoices
                  label="Remove label from selected"
                  labels={labels}
                  onPick={(labelId) => {
                    picked();
                    void apply({ removeLabelIds: [labelId] });
                  }}
                />
              )}
            </BarMenu>
          </>
        )}
        <BarMenu name="Due date…" disabled={off}>
          {(picked) => (
            <DueDateChoice
              onPick={(dueDate) => {
                picked();
                void apply({ dueDate });
              }}
            />
          )}
        </BarMenu>
        <button
          type="button"
          disabled={off}
          onClick={() => void apply({ archived: true })}
          className={buttonClass('secondary')}
        >
          <Archive size={14} aria-hidden="true" />
          Archive
        </button>
        <button
          type="button"
          onClick={() => {
            dispatch({ type: 'clear' });
            setSummary(null);
          }}
          className="ml-auto text-[13px] text-muted underline hover:text-text"
        >
          Clear selection
        </button>
      </div>
      {summary && (
        <div role="status" className="text-[13px]">
          <p>{summary.text}</p>
          {summary.failures.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-muted">
              {summary.failures.map((failure) => (
                <li key={failure}>{failure}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
