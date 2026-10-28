'use client';

import type { ChildNode, Progress, TicketDetail } from '@forge/shared';
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { apiFetch } from '@/lib/api-client';
import { workspaceHref } from '@/lib/nav';
import { progressSummary } from '@/lib/structure';
import { setParent } from '@/lib/ticket-actions';
import { buttonClass, inputClass } from '@/lib/ui';
import { StatusGlyph } from './badges';
import { TicketPicker } from './ticket-picker';
import { useStructureAction } from './use-structure-action';

type Props = {
  organisationId: string;
  slug: string;
  ticket: { key: string; projectKey: string };
  nodes: ChildNode[];
  progress: Progress | null;
  /** tickets.edit on a ticket that is not archived. */
  canEdit: boolean;
  /** tickets.create as well, for making a new child. */
  canCreate: boolean;
  /** What a new child starts with: the Task type and the Flame priority. */
  defaults: { typeId: string; priorityId: string };
  /** False for a ticket at the third level, which can have no children. */
  canHaveChildren: boolean;
};

/**
 * The parts of a ticket, under its description: every child, with their own children nested and
 * open, each removable from its parent. New children can be made here or picked from existing
 * tickets; the server decides whether the three-level rule allows it.
 */
export function ChildTickets(props: Props) {
  const { organisationId, slug, ticket, nodes, progress, canCreate, defaults } = props;
  const canEdit = props.canEdit && props.canHaveChildren;
  const action = useStructureAction();
  const [adding, setAdding] = useState<'new' | 'existing' | null>(null);
  const [title, setTitle] = useState('');

  if (nodes.length === 0 && !canEdit) return null;

  async function createChild(event: FormEvent) {
    event.preventDefault();
    const text = title.trim();
    if (!text) return;
    const worked = await action.run(`Could not add a child to ${ticket.key}.`, async () => {
      // Made and put under its parent in one request, so a refusal leaves no stray ticket.
      const made = await apiFetch<TicketDetail>(
        `/api/v1/orgs/${organisationId}/tickets/${ticket.key}/children`,
        { method: 'POST', json: { title: text, ...defaults } },
      );
      return `Added ${made.key} as a child of ${ticket.key}.`;
    });
    if (worked) {
      setTitle('');
      setAdding(null);
    }
  }

  const addExisting = (key: string) =>
    void action
      .run(`Could not add ${key} to ${ticket.key}.`, async () => {
        await setParent(organisationId, key, ticket.key);
        return `Added ${key} as a child of ${ticket.key}.`;
      })
      .then((worked) => worked && setAdding(null));

  const remove = (key: string, parentKey: string) =>
    void action.run(`Could not remove ${key}.`, async () => {
      await setParent(organisationId, key, null);
      return `Removed ${key} from ${parentKey}.`;
    });

  return (
    <section aria-labelledby="children-heading" className="flex flex-col gap-2">
      <h2 id="children-heading" className="text-[13px] font-semibold">
        Child tickets
        {progress && <span className="font-normal text-muted"> · {progressSummary(progress)}</span>}
      </h2>
      {nodes.length > 0 && (
        <ul aria-label={`Child tickets of ${ticket.key}`} className="flex flex-col">
          {nodes.map((node) => (
            <ChildRow
              key={node.key}
              node={node}
              parentKey={ticket.key}
              depth={0}
              slug={slug}
              canEdit={canEdit}
              busy={action.busy}
              onRemove={remove}
            />
          ))}
        </ul>
      )}
      {canEdit && adding === null && (
        <div className="flex flex-wrap gap-2">
          {canCreate && (
            <button
              type="button"
              className={`${buttonClass('ghost')} h-7 gap-1 px-2 text-xs`}
              onClick={() => setAdding('new')}
            >
              <Plus size={14} aria-hidden="true" />
              Add a child ticket
            </button>
          )}
          <button
            type="button"
            className={`${buttonClass('ghost')} h-7 px-2 text-xs`}
            onClick={() => setAdding('existing')}
          >
            Add an existing ticket
          </button>
        </div>
      )}
      {adding === 'new' && (
        <form onSubmit={createChild} className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-muted">
            Title of the new child ticket
            <input
              autoFocus
              value={title}
              maxLength={200}
              disabled={action.busy}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => event.key === 'Escape' && setAdding(null)}
              className={inputClass()}
            />
          </label>
          <button
            type="submit"
            className={`${buttonClass('primary')} h-8 px-3 text-xs`}
            disabled={action.busy || !title.trim()}
          >
            Add
          </button>
          <button
            type="button"
            className={`${buttonClass('ghost')} h-8 px-3 text-xs`}
            onClick={() => setAdding(null)}
          >
            Cancel
          </button>
        </form>
      )}
      {adding === 'existing' && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <TicketPicker
              organisationId={organisationId}
              label={`Ticket to put under ${ticket.key}`}
              exclude={[ticket.key, ...nodes.map((node) => node.key)]}
              autoFocus
              disabled={action.busy}
              onPick={addExisting}
            />
          </div>
          <button
            type="button"
            className={`${buttonClass('ghost')} h-8 px-3 text-xs`}
            onClick={() => setAdding(null)}
          >
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}

function ChildRow({
  node,
  parentKey,
  depth,
  slug,
  canEdit,
  busy,
  onRemove,
}: {
  node: ChildNode;
  parentKey: string;
  depth: number;
  slug: string;
  canEdit: boolean;
  busy: boolean;
  onRemove: (key: string, parentKey: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;
  return (
    <li className="flex flex-col">
      <div
        className="group flex min-h-8 items-center gap-2 border-t border-edge py-1 text-[13px] first:border-t-0"
        style={{ paddingLeft: `${depth * 1.25}rem` }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} the children of ${node.key}`}
            onClick={() => setOpen(!open)}
            className="grid h-5 w-5 place-items-center rounded text-muted hover:text-text"
          >
            {open ? (
              <ChevronDown size={14} aria-hidden="true" />
            ) : (
              <ChevronRight size={14} aria-hidden="true" />
            )}
          </button>
        ) : (
          <span className="w-5" aria-hidden="true" />
        )}
        <StatusGlyph category={node.status.category} statusKey={node.status.key} />
        <Link
          href={workspaceHref(slug, `/tickets/${node.key}`)}
          className="font-mono text-xs text-muted hover:text-text hover:underline"
        >
          {node.key}
        </Link>
        <span className={`min-w-0 flex-1 truncate ${node.archived ? 'text-muted' : ''}`}>
          {node.title}
          {node.archived && <span className="text-xs"> (archived)</span>}
        </span>
        <span className="whitespace-nowrap text-xs text-muted">{node.status.name}</span>
        {canEdit && (
          <button
            type="button"
            disabled={busy}
            aria-label={`Remove ${node.key} from ${parentKey}`}
            title={`Remove ${node.key} from ${parentKey}`}
            onClick={() => onRemove(node.key, parentKey)}
            className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-raised hover:text-text"
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      {hasChildren && open && (
        <ul aria-label={`Child tickets of ${node.key}`} className="flex flex-col">
          {node.children.map((child) => (
            <ChildRow
              key={child.key}
              node={child}
              parentKey={node.key}
              depth={depth + 1}
              slug={slug}
              canEdit={canEdit}
              busy={busy}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
