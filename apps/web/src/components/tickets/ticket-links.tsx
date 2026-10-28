'use client';

import { LINK_CHOICES, type LinkChoice, type TicketLink, type TicketRef } from '@forge/shared';
import { OctagonX, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useId, useState } from 'react';
import { workspaceHref } from '@/lib/nav';
import { blockedLine } from '@/lib/structure';
import { addLink, removeLink, setParent } from '@/lib/ticket-actions';
import { buttonClass, inputClass } from '@/lib/ui';
import { StatusGlyph } from './badges';
import { TicketPicker } from './ticket-picker';
import { useStructureAction } from './use-structure-action';

const CHOICE_LABELS: Record<LinkChoice, string> = {
  blocks: 'Blocks',
  blocked_by: 'Blocked by',
  relates_to: 'Relates to',
  duplicates: 'Duplicates',
  duplicated_by: 'Duplicated by',
};

function TicketRefLink({ slug, ticket }: { slug: string; ticket: TicketRef }) {
  return (
    <Link
      href={workspaceHref(slug, `/tickets/${ticket.key}`)}
      className="flex min-w-0 flex-1 items-center gap-2 hover:underline"
    >
      <StatusGlyph category={ticket.status.category} statusKey={ticket.status.key} />
      <span className="font-mono text-xs text-muted">{ticket.key}</span>
      <span className="truncate">{ticket.title}</span>
    </Link>
  );
}

/** Said first in the right bar, so a ticket that cannot be finished yet is seen to be stuck. */
export function BlockedNotice({ keys }: { keys: string[] }) {
  if (keys.length === 0) return null;
  return (
    <p
      role="status"
      className="flex items-center gap-2 rounded-md border border-fail/50 bg-fail/10 px-3 py-2 text-[13px] text-fail"
    >
      <OctagonX size={14} aria-hidden="true" />
      {blockedLine(keys)}
    </p>
  );
}

/** The right bar's Links section: each link worded from this ticket's side, grouped by wording. */
export function TicketLinks({
  organisationId,
  slug,
  ticketKey,
  links,
  canEdit,
}: {
  organisationId: string;
  slug: string;
  ticketKey: string;
  links: TicketLink[];
  canEdit: boolean;
}) {
  const id = useId();
  const action = useStructureAction();
  const [adding, setAdding] = useState(false);
  const [choice, setChoice] = useState<LinkChoice>('blocked_by');
  if (links.length === 0 && !canEdit) return null;

  const groups = links.reduce<{ label: string; links: TicketLink[] }[]>((all, link) => {
    const group = all.find((item) => item.label === link.label);
    if (group) group.links.push(link);
    else all.push({ label: link.label, links: [link] });
    return all;
  }, []);

  const add = (otherKey: string) =>
    void action
      .run(`Could not link ${ticketKey} to ${otherKey}.`, async () => {
        await addLink(organisationId, ticketKey, choice, otherKey);
        return `Linked: ${ticketKey} ${CHOICE_LABELS[choice].toLowerCase()} ${otherKey}.`;
      })
      .then((worked) => worked && setAdding(false));

  return (
    <section aria-labelledby="links-heading" className="flex flex-col gap-2">
      <h2 id="links-heading" className="text-[13px] font-semibold">
        Links
      </h2>
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <h3 className="text-xs text-muted">{group.label}</h3>
          <ul aria-label={group.label} className="flex flex-col gap-1">
            {group.links.map((link) => {
              const openBlocker =
                link.label === 'Blocked by' && link.ticket.status.category !== 'completed';
              return (
                <li
                  key={link.id}
                  className={`flex min-h-7 items-center gap-1 text-[13px] ${openBlocker ? 'text-fail' : ''}`}
                >
                  <TicketRefLink slug={slug} ticket={link.ticket} />
                  {canEdit && (
                    <button
                      type="button"
                      disabled={action.busy}
                      aria-label={`Remove the link: ${link.label.toLowerCase()} ${link.ticket.key}`}
                      title="Remove the link"
                      onClick={() =>
                        void action.run('Could not remove the link.', async () => {
                          await removeLink(organisationId, ticketKey, link.id);
                          return `Removed the link to ${link.ticket.key}.`;
                        })
                      }
                      className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted hover:bg-raised hover:text-text"
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {links.length === 0 && <p className="text-[13px] text-muted">No links.</p>}
      {canEdit && !adding && (
        <button
          type="button"
          className={`${buttonClass('ghost')} h-7 self-start gap-1 px-2 text-xs`}
          onClick={() => setAdding(true)}
        >
          <Plus size={14} aria-hidden="true" />
          Link a ticket
        </button>
      )}
      {canEdit && adding && (
        <div className="flex flex-col gap-2 rounded-md border border-edge p-2">
          <label htmlFor={`${id}-kind`} className="text-xs text-muted">
            {ticketKey} …
          </label>
          <select
            id={`${id}-kind`}
            value={choice}
            onChange={(event) => setChoice(event.target.value as LinkChoice)}
            className={inputClass()}
          >
            {LINK_CHOICES.map((item) => (
              <option key={item} value={item}>
                {CHOICE_LABELS[item]}
              </option>
            ))}
          </select>
          <TicketPicker
            organisationId={organisationId}
            label="Ticket to link"
            exclude={[ticketKey]}
            autoFocus
            disabled={action.busy}
            onPick={add}
          />
          <button
            type="button"
            className={`${buttonClass('ghost')} h-7 self-start px-2 text-xs`}
            onClick={() => setAdding(false)}
          >
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}

/** The ticket's parent, which can be set, changed or cleared. An epic never has one. */
export function ParentField({
  organisationId,
  slug,
  ticketKey,
  parent,
  isEpic,
  canEdit,
}: {
  organisationId: string;
  slug: string;
  ticketKey: string;
  parent: TicketRef | null;
  isEpic: boolean;
  canEdit: boolean;
}) {
  const action = useStructureAction();
  const [changing, setChanging] = useState(false);
  if (isEpic && !parent) return null;

  const put = (parentKey: string | null) =>
    void action
      .run(`Could not change the parent of ${ticketKey}.`, async () => {
        await setParent(organisationId, ticketKey, parentKey);
        return parentKey
          ? `${ticketKey} is now under ${parentKey}.`
          : `${ticketKey} is now top level.`;
      })
      .then((worked) => worked && setChanging(false));

  return (
    <section aria-labelledby="parent-heading" className="flex flex-col gap-2">
      <h2 id="parent-heading" className="text-[13px] font-semibold">
        Parent
      </h2>
      {parent ? (
        <div className="flex items-center gap-1 text-[13px]">
          <TicketRefLink slug={slug} ticket={parent} />
        </div>
      ) : (
        <p className="text-[13px] text-muted">None. This is a top-level ticket.</p>
      )}
      {canEdit && !changing && (
        <div className="flex gap-2">
          <button
            type="button"
            className={`${buttonClass('ghost')} h-7 px-2 text-xs`}
            onClick={() => setChanging(true)}
          >
            {parent ? 'Change parent' : 'Set a parent'}
          </button>
          {parent && (
            <button
              type="button"
              disabled={action.busy}
              className={`${buttonClass('ghost')} h-7 px-2 text-xs`}
              onClick={() => put(null)}
            >
              Remove parent
            </button>
          )}
        </div>
      )}
      {canEdit && changing && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <TicketPicker
              organisationId={organisationId}
              label={`New parent for ${ticketKey}`}
              exclude={[ticketKey, ...(parent ? [parent.key] : [])]}
              autoFocus
              disabled={action.busy}
              onPick={put}
            />
          </div>
          <button
            type="button"
            className={`${buttonClass('ghost')} h-8 px-3 text-xs`}
            onClick={() => setChanging(false)}
          >
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
