import {
  notifications,
  organisationMemberships,
  organisations,
  roles,
  ticketWatchers,
  tickets,
  userPreferences,
  users,
  type Executor,
} from '@forge/db';
import {
  notificationPrefsSchema,
  wantsNotification,
  type Notification,
  type NotificationKind,
  type NotificationList,
  type NotificationPrefs,
} from '@forge/shared';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { NOTIFY_CHANNEL } from './hub';

export type NotificationDraft = {
  recipientId: string;
  kind: NotificationKind;
  ticketId: string;
  text: string;
  /** For notifications that must happen at most once, e.g. `due_soon:2026-10-29`. */
  dedupeKey?: string;
};

/** When one change would tell a person several things, the most specific one wins. */
const PRIORITY: Record<NotificationKind, number> = {
  assigned: 0,
  mentioned: 1,
  triage_approval: 2,
  triage_outcome: 3,
  triage_arrival: 4,
  moved: 5,
  commented: 6,
  due_soon: 7,
  overdue: 8,
};

/**
 * Writes notifications inside the caller's transaction. Never to the person who acted, never to
 * someone outside the workspace, never of a kind the person switched off, and at most one per
 * person per ticket for one change. Each one is announced with pg_notify, which Postgres delivers
 * only if the transaction commits.
 */
export async function notify(
  tx: Executor,
  input: { organisationId: string; actorId: string | null; drafts: NotificationDraft[] },
): Promise<void> {
  const best = new Map<string, NotificationDraft>();
  for (const draft of input.drafts) {
    if (draft.recipientId === input.actorId) continue;
    const key = `${draft.recipientId}:${draft.ticketId}`;
    const current = best.get(key);
    if (!current || PRIORITY[draft.kind] < PRIORITY[current.kind]) best.set(key, draft);
  }
  if (best.size === 0) return;

  const recipientIds = [...new Set([...best.values()].map((draft) => draft.recipientId))];
  const [members, prefs] = await Promise.all([
    viewersAmong(tx, input.organisationId, recipientIds),
    tx
      .select({ userId: userPreferences.userId, data: userPreferences.data })
      .from(userPreferences)
      .where(inArray(userPreferences.userId, recipientIds)),
  ]);
  const memberIds = new Set(members);
  const prefsOf = new Map(
    prefs.map((p) => {
      const stored = (p.data as { notifications?: unknown } | null)?.notifications;
      const known =
        stored && typeof stored === 'object'
          ? Object.fromEntries(
              Object.entries(stored).filter(
                ([kind, value]) => notificationPrefsSchema.safeParse({ [kind]: value }).success,
              ),
            )
          : {};
      return [p.userId, known as NotificationPrefs] as const;
    }),
  );

  const rows = [...best.values()].filter(
    (draft) =>
      memberIds.has(draft.recipientId) &&
      wantsNotification(prefsOf.get(draft.recipientId), draft.kind),
  );
  if (rows.length === 0) return;

  const inserted = await tx
    .insert(notifications)
    .values(
      rows.map((draft) => ({
        organisationId: input.organisationId,
        recipientId: draft.recipientId,
        kind: draft.kind,
        ticketId: draft.ticketId,
        actorId: input.actorId,
        text: draft.text.slice(0, 300),
        dedupeKey: draft.dedupeKey ?? null,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: notifications.id, recipientId: notifications.recipientId });
  for (const row of inserted) {
    await tx.execute(sql`select pg_notify(${NOTIFY_CHANNEL}, ${`${row.recipientId}:${row.id}`})`);
  }
}

// ---------------------------------------------------------------------------
// Watching
// ---------------------------------------------------------------------------

/**
 * Starts these people watching the ticket. Someone who chose to stop watching stays stopped:
 * only `setWatching` changes that.
 */
export async function autoWatch(
  tx: Executor,
  organisationId: string,
  ticketId: string,
  userIds: (string | null | undefined)[],
): Promise<void> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  // Only members can watch; anyone else (a removed member named in old text) is skipped.
  const members = await viewersAmong(tx, organisationId, ids);
  if (members.length === 0) return;
  await tx
    .insert(ticketWatchers)
    .values(members.map((userId) => ({ organisationId, ticketId, userId })))
    .onConflictDoNothing();
}

export async function setWatching(
  tx: Executor,
  input: { organisationId: string; ticketId: string; userId: string; watching: boolean },
): Promise<void> {
  await tx
    .insert(ticketWatchers)
    .values(input)
    .onConflictDoUpdate({
      target: [ticketWatchers.ticketId, ticketWatchers.userId],
      set: { watching: input.watching },
    });
}

/** The people watching the ticket now. */
export async function watcherIds(tx: Executor, ticketId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: ticketWatchers.userId })
    .from(ticketWatchers)
    .where(and(eq(ticketWatchers.ticketId, ticketId), eq(ticketWatchers.watching, true)));
  return rows.map((row) => row.userId);
}

export async function watchersOf(
  tx: Executor,
  ticketId: string,
): Promise<{ id: string; displayName: string }[]> {
  return tx
    .select({ id: users.id, displayName: users.displayName })
    .from(ticketWatchers)
    .innerJoin(users, eq(users.id, ticketWatchers.userId))
    .where(and(eq(ticketWatchers.ticketId, ticketId), eq(ticketWatchers.watching, true)))
    .orderBy(users.displayName);
}

// ---------------------------------------------------------------------------
// Reading the inbox
// ---------------------------------------------------------------------------

const actor = alias(users, 'actor');

const columns = {
  id: notifications.id,
  kind: notifications.kind,
  text: notifications.text,
  readAt: notifications.readAt,
  createdAt: notifications.createdAt,
  ticketKey: tickets.key,
  ticketTitle: tickets.title,
  workspaceId: organisations.id,
  workspaceSlug: organisations.slug,
  actorId: actor.id,
  actorName: actor.displayName,
};

type Row = {
  id: string;
  kind: string;
  text: string;
  readAt: Date | null;
  createdAt: Date;
  ticketKey: string;
  ticketTitle: string;
  workspaceId: string;
  workspaceSlug: string;
  actorId: string | null;
  actorName: string | null;
};

const toNotification = (row: Row): Notification => ({
  id: row.id,
  kind: row.kind as NotificationKind,
  text: row.text,
  ticket: { key: row.ticketKey, title: row.ticketTitle },
  workspace: { id: row.workspaceId, slug: row.workspaceSlug },
  actor: row.actorId ? { id: row.actorId, displayName: row.actorName! } : null,
  read: row.readAt !== null,
  createdAt: row.createdAt.toISOString(),
});

function baseQuery(executor: Executor) {
  return executor
    .select(columns)
    .from(notifications)
    .innerJoin(tickets, eq(tickets.id, notifications.ticketId))
    .innerJoin(organisations, eq(organisations.id, notifications.organisationId))
    .leftJoin(actor, eq(actor.id, notifications.actorId));
}

export async function unreadCount(
  executor: Executor,
  organisationId: string,
  userId: string,
): Promise<number> {
  const [row] = await executor
    .select({ total: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.organisationId, organisationId),
        eq(notifications.recipientId, userId),
        isNull(notifications.readAt),
      ),
    );
  return row?.total ?? 0;
}

/** The cursor is `<created_at as stored>|<id>`, so pages never skip or repeat a row. */
const PAGE = 30;
const CURSOR =
  /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?[+-]\d{2}(?::\d{2})?)\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export async function listNotifications(
  executor: Executor,
  input: { organisationId: string; userId: string; unreadOnly: boolean; before?: string },
): Promise<NotificationList> {
  const conditions = [
    eq(notifications.organisationId, input.organisationId),
    eq(notifications.recipientId, input.userId),
  ];
  if (input.unreadOnly) conditions.push(isNull(notifications.readAt));
  const cursor = input.before ? CURSOR.exec(input.before) : null;
  if (cursor) {
    const [, at, id] = cursor;
    conditions.push(
      sql`(${notifications.createdAt}, ${notifications.id}) < (${at}::timestamptz, ${id}::uuid)`,
    );
  }
  const rows = await baseQuery(executor)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(PAGE + 1);
  const page = rows.slice(0, PAGE);
  const last = page.at(-1);
  // The exact stored time, microseconds included, so the next page starts precisely after it.
  const [exact] = last
    ? await executor
        .select({ at: sql<string>`${notifications.createdAt}::text` })
        .from(notifications)
        .where(eq(notifications.id, last.id))
    : [];
  return {
    items: page.map(toNotification),
    unread: await unreadCount(executor, input.organisationId, input.userId),
    next: rows.length > PAGE && last && exact ? `${exact.at}|${last.id}` : null,
  };
}

/** One notification of this person, for the live stream; null if it is not theirs. */
export async function loadNotification(
  executor: Executor,
  userId: string,
  id: string,
): Promise<Notification | null> {
  const [row] = await baseQuery(executor).where(
    and(eq(notifications.id, id), eq(notifications.recipientId, userId)),
  );
  if (!row) return null;
  const allowed = await viewersAmong(executor, row.workspaceId, [userId]);
  return allowed.length > 0 ? toNotification(row) : null;
}

/** Of these people, the members of the workspace whose role may see its tickets now. */
async function viewersAmong(
  executor: Executor,
  organisationId: string,
  userIds: string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await executor
    .select({ userId: organisationMemberships.userId })
    .from(organisationMemberships)
    .innerJoin(roles, eq(roles.id, organisationMemberships.roleId))
    .where(
      and(
        eq(organisationMemberships.organisationId, organisationId),
        inArray(organisationMemberships.userId, userIds),
        sql`'tickets.view' = any(${roles.permissions})`,
      ),
    );
  return rows.map((row) => row.userId);
}

export async function markRead(
  executor: Executor,
  input: { organisationId: string; userId: string; ids: string[] | 'all' },
): Promise<number> {
  const conditions = [
    eq(notifications.organisationId, input.organisationId),
    eq(notifications.recipientId, input.userId),
    isNull(notifications.readAt),
  ];
  if (input.ids !== 'all') conditions.push(inArray(notifications.id, input.ids));
  await executor
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(...conditions));
  return unreadCount(executor, input.organisationId, input.userId);
}
