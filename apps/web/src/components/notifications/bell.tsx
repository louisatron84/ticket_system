'use client';

import { notificationEventSchema, type Notification, type NotificationList } from '@forge/shared';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api-client';
import { workspaceHref } from '@/lib/nav';
import { formatRelativeTime } from '@/lib/tickets';
import { useDismiss } from '@/lib/use-dismiss';
import { buttonClass } from '@/lib/ui';

/**
 * The bell: this workspace's unread count, kept live over the server's event stream, and a panel
 * with the latest notifications. A notification from another workspace only shows as a toast.
 */
const PANEL_SIZE = 20;

export function NotificationBell({
  organisationId,
  slug,
}: {
  organisationId: string;
  slug: string;
}) {
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const base = `/api/v1/orgs/${organisationId}/notifications`;
  useDismiss(container, open, close);

  useEffect(() => {
    let current = true;
    const load = () =>
      apiFetch<NotificationList>(base)
        .then((list) => {
          if (!current) return;
          setUnread(list.unread);
          setItems(list.items.slice(0, PANEL_SIZE));
        })
        .catch(() => {});

    // The browser reconnects by itself if the stream drops; each (re)connection reloads the
    // count, so anything that happened while it was down is not missed.
    const source = new EventSource('/api/v1/me/events');
    source.addEventListener('open', () => void load());
    source.addEventListener('notification', (message) => {
      const parsed = notificationEventSchema.safeParse(JSON.parse((message as MessageEvent).data));
      if (!parsed.success || !parsed.data.notification || !current) return;
      const { notification } = parsed.data;
      if (notification.workspace.id === organisationId) {
        setUnread(parsed.data.unread);
        setItems((list) => [notification, ...list].slice(0, PANEL_SIZE));
      }
      toast(notification.text, {
        action: {
          label: 'Open',
          onClick: () =>
            router.push(
              workspaceHref(notification.workspace.slug, `/tickets/${notification.ticket.key}`),
            ),
        },
      });
    });
    return () => {
      current = false;
      source.close();
    };
  }, [base, organisationId, router]);

  async function markRead(body: { ids: string[] } | { all: true }) {
    const result = await apiFetch<{ unread: number }>(`${base}/read`, {
      method: 'POST',
      json: body,
    }).catch(() => null);
    if (!result) return;
    setUnread(result.unread);
    setItems((list) =>
      list.map((n) => ('all' in body || body.ids.includes(n.id) ? { ...n, read: true } : n)),
    );
  }

  const now = new Date().toISOString();
  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-controls="notification-panel"
        onClick={() => setOpen((value) => !value)}
        className="relative flex size-8 items-center justify-center rounded-md text-muted hover:bg-raised hover:text-text"
      >
        <Bell size={17} aria-hidden="true" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            data-testid="unread-count"
            className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-ember px-1 text-center font-mono text-[10px] font-semibold leading-4 text-bg"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          id="notification-panel"
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-10 z-30 w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-edge-strong bg-panel shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <h2 className="text-[13px] font-semibold">Notifications</h2>
            {unread > 0 && (
              <button
                type="button"
                className={`${buttonClass('ghost')} h-7 px-2 text-xs`}
                onClick={() => void markRead({ all: true })}
              >
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-muted">Nothing yet.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-edge overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <Link
                    href={workspaceHref(slug, `/tickets/${n.ticket.key}`)}
                    onClick={() => {
                      setOpen(false);
                      if (!n.read) void markRead({ ids: [n.id] });
                    }}
                    className={`flex gap-2 px-3 py-2 text-[13px] hover:bg-raised ${n.read ? 'text-muted' : ''}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 size-1.5 shrink-0 rounded-full ${n.read ? '' : 'bg-ember'}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block">
                        {n.text}
                        {!n.read && <span className="sr-only"> (unread)</span>}
                      </span>
                      <span className="block truncate text-xs text-muted">{n.ticket.title}</span>
                    </span>
                    <time dateTime={n.createdAt} className="shrink-0 text-xs text-muted">
                      {formatRelativeTime(n.createdAt, now)}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link
            href={workspaceHref(slug, '/inbox')}
            onClick={() => setOpen(false)}
            className="block border-t border-edge px-3 py-2 text-center text-xs text-muted hover:bg-raised hover:text-text"
          >
            Open the inbox
          </Link>
        </div>
      )}
    </div>
  );
}
