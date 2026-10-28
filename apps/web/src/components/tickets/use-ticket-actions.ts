'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError } from '@/lib/api-client';
import { workspaceHref } from '@/lib/nav';
import {
  archiveTicket,
  copyText,
  duplicateTicket,
  ticketHref,
  unarchiveTicket,
} from '@/lib/ticket-actions';
import type { ActionMenuState } from './action-menu';

/**
 * What the ticket page's menu and a board card's menu do the same way: copy the key or link, make
 * a copy, archive or unarchive. Each closes the menu first, says what went wrong in a toast if it
 * did, and gives the keyboard focus back to the menu's button when the person stays where they are.
 */
export function useTicketActions({
  organisationId,
  slug,
  ticket,
  menu,
}: {
  organisationId: string;
  slug: string;
  ticket: { key: string; archived: boolean };
  menu: Pick<ActionMenuState, 'close' | 'restoreFocus'>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { key } = ticket;

  /**
   * Runs one action. The menu's button is off while it runs. `leaves` is for an action that
   * takes the person to another page when it works; the focus is only given back if it fails.
   */
  async function run(failure: string, action: () => Promise<void>, leaves = false) {
    menu.close();
    setBusy(true);
    let worked = false;
    try {
      await action();
      worked = true;
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : failure);
      // Someone else changed it first, or it was archived: show what it is now.
      if (error instanceof ApiRequestError && error.status === 409) router.refresh();
    } finally {
      setBusy(false);
    }
    if (!worked || !leaves) menu.restoreFocus();
  }

  async function copy(text: string, done: string) {
    menu.close();
    menu.restoreFocus();
    if (await copyText(text)) toast.success(done);
    else toast.error('Could not copy. Your browser did not allow it.');
  }

  return {
    busy,
    run,
    copyKey: () => copy(key, `Copied ${key}.`),
    copyLink: () => copy(ticketHref(slug, key), `Copied the link to ${key}.`),
    archive: () =>
      run(`Could not ${ticket.archived ? 'unarchive' : 'archive'} ${key}.`, async () => {
        await (ticket.archived ? unarchiveTicket : archiveTicket)(organisationId, key);
        toast.success(`${ticket.archived ? 'Unarchived' : 'Archived'} ${key}.`);
        router.refresh();
      }),
    duplicate: () =>
      run(
        `Could not duplicate ${key}.`,
        async () => {
          const copyOfTicket = await duplicateTicket(organisationId, key);
          toast.success(`Created ${copyOfTicket.key}, a copy of ${key}.`);
          router.push(workspaceHref(slug, `/tickets/${copyOfTicket.key}`));
        },
        true,
      ),
  };
}
