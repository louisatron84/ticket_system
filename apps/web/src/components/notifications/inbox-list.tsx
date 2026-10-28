'use client';

import type { NotificationList } from '@forge/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { workspaceHref } from '@/lib/nav';
import { formatRelativeTime } from '@/lib/tickets';
import { buttonClass } from '@/lib/ui';

const failure = (error: unknown) =>
  error instanceof ApiRequestError ? error.message : 'Something went wrong. Try again.';

/** The inbox: All or Unread, newest first, a page at a time. Opening one marks it read. */
export function InboxList({
  organisationId,
  slug,
  filter,
  initial,
  now,
}: {
  organisationId: string;
  slug: string;
  filter: 'all' | 'unread';
  initial: NotificationList;
  now: string;
}) {
  const router = useRouter();
  const [list, setList] = useState(initial);
  const [busy, setBusy] = useState(false);
  const base = `/api/v1/orgs/${organisationId}/notifications`;

  async function more() {
    if (!list.next) return;
    setBusy(true);
    try {
      const next = await apiFetch<NotificationList>(
        `${base}?filter=${filter}&before=${encodeURIComponent(list.next)}`,
      );
      setList((current) => ({ ...next, items: [...current.items, ...next.items] }));
    } catch (error) {
      toast.error(failure(error));
    } finally {
      setBusy(false);
    }
  }

  async function markRead(body: { ids: string[] } | { all: true }) {
    try {
      const { unread } = await apiFetch<{ unread: number }>(`${base}/read`, {
        method: 'POST',
        json: body,
      });
      setList((current) => ({
        ...current,
        unread,
        items: current.items.map((n) =>
          'all' in body || body.ids.includes(n.id) ? { ...n, read: true } : n,
        ),
      }));
      router.refresh();
    } catch (error) {
      toast.error(failure(error));
    }
  }

  const tab = (value: 'all' | 'unread', label: string) => (
    <Link
      href={workspaceHref(slug, value === 'all' ? '/inbox' : '/inbox?filter=unread')}
      aria-current={filter === value ? 'page' : undefined}
      className={`rounded px-2.5 py-1 text-[13px] ${filter === value ? 'bg-raised font-medium text-text' : 'text-muted hover:text-text'}`}
    >
      {label}
    </Link>
  );

  return (
    <section aria-label="Your notifications" className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        {tab('all', 'All')}
        {tab('unread', `Unread${list.unread > 0 ? ` (${list.unread})` : ''}`)}
        {list.unread > 0 && (
          <button
            type="button"
            className={`${buttonClass('ghost')} ml-auto h-7 px-2 text-xs`}
            onClick={() => void markRead({ all: true })}
          >
            Mark all read
          </button>
        )}
      </div>
      {list.items.length === 0 ? (
        <p className="rounded-md border border-edge px-4 py-8 text-center text-[13px] text-muted">
          {filter === 'unread' ? 'Nothing unread.' : 'Nothing here yet.'}
        </p>
      ) : (
        <ul className="divide-y divide-edge rounded-md border border-edge bg-panel">
          {list.items.map((n) => (
            <li key={n.id} className="flex items-start gap-3 px-4 py-2.5">
              <span
                aria-hidden="true"
                className={`mt-2 size-1.5 shrink-0 rounded-full ${n.read ? '' : 'bg-ember'}`}
              />
              <Link
                href={workspaceHref(slug, `/tickets/${n.ticket.key}`)}
                onClick={() => {
                  if (!n.read) void markRead({ ids: [n.id] });
                }}
                className={`min-w-0 flex-1 text-[13px] hover:underline ${n.read ? 'text-muted' : 'font-medium'}`}
              >
                {n.text}
                {!n.read && <span className="sr-only"> (unread)</span>}
                <span className="block truncate text-xs font-normal text-muted">
                  {n.ticket.key} {n.ticket.title}
                </span>
              </Link>
              <time dateTime={n.createdAt} className="shrink-0 text-xs text-muted">
                {formatRelativeTime(n.createdAt, now)}
              </time>
              {!n.read && (
                <button
                  type="button"
                  className={`${buttonClass('ghost')} h-6 shrink-0 px-2 text-xs`}
                  onClick={() => void markRead({ ids: [n.id] })}
                  aria-label={`Mark "${n.text}" read`}
                >
                  Mark read
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {list.next && (
        <button
          type="button"
          className={`${buttonClass('secondary')} self-center`}
          disabled={busy}
          onClick={() => void more()}
        >
          {busy ? 'Loading' : 'Show older'}
        </button>
      )}
    </section>
  );
}
