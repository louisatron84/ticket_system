import {
  addTicketEvent,
  projectStatuses,
  projects,
  statusTransitions,
  ticketLinks,
  ticketTypes,
  tickets,
  type Executor,
} from '@forge/db';
import {
  MAX_TICKET_DEPTH,
  linkLabel,
  parseTicketKey,
  storedLink,
  hasPermission,
  type CreateTicketBody,
  type LinkChoice,
  type TicketDetail,
  type TicketLinkKind,
} from '@forge/shared';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import type { Db } from '@forge/db';
import { AppError } from '../errors';
import { loadTicketDetail } from './read';
import { archivedTicketError, createTicket, inTriageError, type TicketContext } from './service';

const notFound = () => new AppError('not_found', 'Not found.', 404);
/** A refusal whose message is the reason itself, so whatever shows only the message says why. */
const invalid = (path: string, message: string) =>
  new AppError('validation_failed', message, 422, [{ path, message }]);

/** A locked ticket row with what the structure rules need to know about it. */
export type LockedTicket = {
  id: string;
  key: string;
  projectId: string;
  parentId: string | null;
  typeKey: string;
  archived: boolean;
  projectArchived: boolean;
  triageState: string | null;
};

/** The canonical form of a key someone typed, or null if it is not a ticket key at all. */
export function canonicalKey(text: string): string | null {
  const parsed = parseTicketKey(text);
  return parsed ? `${parsed.projectKey}-${parsed.number}` : null;
}

/**
 * Locks these tickets of the workspace, always in id order so two writers locking the same pair
 * can never wait on each other in a circle. Keys that do not exist here are simply absent.
 */
export async function lockInIdOrder(
  tx: Executor,
  organisationId: string,
  keys: string[],
): Promise<Map<string, LockedTicket>> {
  const wanted = [...new Set(keys)];
  if (wanted.length === 0) return new Map();
  const rows = await tx
    .select({
      id: tickets.id,
      key: tickets.key,
      projectId: tickets.projectId,
      parentId: tickets.parentId,
      typeKey: ticketTypes.key,
      archivedAt: tickets.archivedAt,
      projectArchivedAt: projects.archivedAt,
      triageState: tickets.triageState,
    })
    .from(tickets)
    .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.typeId))
    .innerJoin(projects, eq(projects.id, tickets.projectId))
    .where(and(eq(tickets.organisationId, organisationId), inArray(tickets.key, wanted)))
    .orderBy(asc(tickets.id))
    .for('update', { of: tickets });
  return new Map(
    rows.map(({ archivedAt, projectArchivedAt, ...row }) => [
      row.key,
      { ...row, archived: archivedAt !== null, projectArchived: projectArchivedAt !== null },
    ]),
  );
}

/**
 * Serialises every change to the shape of one workspace's tickets. Two rows locked per write are
 * not enough on their own: a loop can close through tickets neither write touches.
 */
async function lockStructure(tx: Executor, organisationId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`ticket-structure:${organisationId}`}))`,
  );
}

/** Refuses a ticket that may not take part in a new parent or link. */
export function assertWritable(ticket: LockedTicket) {
  if (ticket.archived) throw archivedTicketError();
  if (ticket.projectArchived) {
    throw new AppError('conflict', `${ticket.key} is in an archived project.`, 409);
  }
}

/** Keys from the ticket's parent up to the top, nearest first. */
async function ancestorIds(tx: Executor, ticketId: string): Promise<string[]> {
  const result = await tx.execute<{ id: string }>(sql`
    with recursive up(id, parent_id, depth) as (
      select id, parent_id, 0 from tickets where id = ${ticketId}
      union all
      select t.id, t.parent_id, up.depth + 1 from tickets t join up on t.id = up.parent_id
      where up.depth < ${MAX_TICKET_DEPTH + 1}
    )
    select id from up where depth > 0 order by depth`);
  return result.rows.map((row) => row.id);
}

/** How many levels the ticket and everything under it take up: 1 for a ticket with no children. */
async function subtreeHeight(tx: Executor, ticketId: string): Promise<number> {
  const result = await tx.execute<{ height: number }>(sql`
    with recursive down(id, depth) as (
      select id, 1 from tickets where id = ${ticketId}
      union all
      select t.id, down.depth + 1 from tickets t join down on t.parent_id = down.id
      where down.depth < ${MAX_TICKET_DEPTH + 1}
    )
    select max(depth)::int as height from down`);
  return result.rows[0]?.height ?? 1;
}

async function keyOf(tx: Executor, ticketId: string): Promise<string> {
  const [row] = await tx.select({ key: tickets.key }).from(tickets).where(eq(tickets.id, ticketId));
  return row!.key;
}

/**
 * Puts a ticket under a parent (or makes it top level with `parentKey: null`). A relationship
 * write: neither ticket's version is checked or bumped. History goes on the child and on each
 * parent that gains or loses it.
 */
export async function setParent(
  db: Db,
  input: { context: TicketContext; ticketKey: string; parentKey: string | null },
): Promise<TicketDetail> {
  const { context, ticketKey } = input;
  const parentKey = input.parentKey === null ? null : canonicalKey(input.parentKey);
  const noSuchParent = () =>
    invalid('parentKey', `There is no ticket ${input.parentKey} in this workspace.`);
  if (input.parentKey !== null && !parentKey) throw noSuchParent();

  return db.transaction(async (tx) => {
    await lockStructure(tx, context.organisationId);
    const locked = await lockInIdOrder(tx, context.organisationId, [
      ticketKey,
      ...(parentKey ? [parentKey] : []),
    ]);
    const child = locked.get(ticketKey);
    if (!child) throw notFound();
    const parent = parentKey ? locked.get(parentKey) : null;
    if (parentKey && !parent) throw noSuchParent();

    if ((parent?.id ?? null) !== child.parentId) {
      if (parent) {
        if (parent.id === child.id) throw invalid('parentKey', "A ticket can't be its own parent.");
        assertWritable(child);
        assertWritable(parent);
        if (child.typeKey === 'epic') {
          throw invalid('parentKey', "An epic is always top level, so it can't have a parent.");
        }
        const above = await ancestorIds(tx, parent.id);
        if (above.includes(child.id)) {
          throw invalid(
            'parentKey',
            `${parent.key} is already under ${child.key}, so it can't be its parent.`,
          );
        }
        const parentDepth = above.length + 1;
        if (parentDepth >= MAX_TICKET_DEPTH) {
          throw invalid(
            'parentKey',
            `${parent.key} is already at the third level, so it can't have children.`,
          );
        }
        if (parentDepth + (await subtreeHeight(tx, child.id)) > MAX_TICKET_DEPTH) {
          throw invalid(
            'parentKey',
            `${child.key} already has sub-tasks, so it can't go under ${parent.key}; that would make four levels.`,
          );
        }
      }

      const now = new Date();
      await tx
        .update(tickets)
        .set({ parentId: parent?.id ?? null, updatedAt: now })
        .where(eq(tickets.id, child.id));

      const record = (ticketId: string, event: Parameters<typeof addTicketEvent>[1]['event']) =>
        addTicketEvent(tx, {
          organisationId: context.organisationId,
          ticketId,
          actorUserId: context.actorUserId,
          event,
          createdAt: now,
        });
      const previousKey = child.parentId ? await keyOf(tx, child.parentId) : null;
      await record(child.id, {
        type: 'ticket.parent_set',
        data: { parentKey: parent?.key ?? null, previousKey },
      });
      if (child.parentId) {
        await record(child.parentId, {
          type: 'ticket.child_removed',
          data: { childKey: child.key },
        });
      }
      if (parent) {
        await record(parent.id, { type: 'ticket.child_added', data: { childKey: child.key } });
      }
    }

    const detail = await loadTicketDetail(tx, context.organisationId, ticketKey);
    if (!detail) throw new Error('A ticket that was just updated could not be read back');
    return detail;
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Links two tickets. What a person picks ("blocked by") is stored once in its forward direction
 * (`blocks`, from the blocker); `relates_to` is stored with the lower id as source so a pair has it
 * at most once. History goes on both tickets, each worded from its own side.
 */
export async function addLink(
  db: Db,
  input: { context: TicketContext; ticketKey: string; choice: LinkChoice; otherKey: string },
): Promise<TicketDetail> {
  const { context, ticketKey } = input;
  const otherKey = canonicalKey(input.otherKey);
  const noSuchTicket = () =>
    invalid('otherKey', `There is no ticket ${input.otherKey} in this workspace.`);
  if (!otherKey) throw noSuchTicket();

  return db.transaction(async (tx) => {
    await lockStructure(tx, context.organisationId);
    const locked = await lockInIdOrder(tx, context.organisationId, [ticketKey, otherKey]);
    const self = locked.get(ticketKey);
    if (!self) throw notFound();
    const other = locked.get(otherKey);
    if (!other) throw noSuchTicket();
    if (other.id === self.id) throw invalid('otherKey', "A ticket can't be linked to itself.");
    assertWritable(self);
    assertWritable(other);

    const { kind, direction } = storedLink(input.choice);
    let [source, target] = direction === 'outward' ? [self, other] : [other, self];
    if (kind === 'relates_to' && source.id > target.id) [source, target] = [target, source];

    const existing = await tx
      .select({ id: ticketLinks.id, sourceTicketId: ticketLinks.sourceTicketId })
      .from(ticketLinks)
      .where(
        and(
          eq(ticketLinks.kind, kind),
          or(
            and(
              eq(ticketLinks.sourceTicketId, source.id),
              eq(ticketLinks.targetTicketId, target.id),
            ),
            and(
              eq(ticketLinks.sourceTicketId, target.id),
              eq(ticketLinks.targetTicketId, source.id),
            ),
          ),
        ),
      );
    if (existing.some((link) => link.sourceTicketId === source.id)) {
      throw new AppError('conflict', 'These tickets are already linked that way.', 409);
    }
    if (kind === 'blocks' && existing.length > 0) {
      throw invalid(
        'otherKey',
        `${source.key} is already blocked by ${target.key}, so it can't block it.`,
      );
    }
    if (kind === 'duplicates' && existing.length > 0) {
      throw invalid(
        'otherKey',
        `${target.key} is already a duplicate of ${source.key}, so ${source.key} can't be a duplicate of it.`,
      );
    }

    const now = new Date();
    await tx.insert(ticketLinks).values({
      organisationId: context.organisationId,
      sourceTicketId: source.id,
      targetTicketId: target.id,
      kind,
      createdBy: context.actorUserId,
      createdAt: now,
    });
    await recordLink(tx, context, now, 'link.added', kind, source, target);

    const detail = await loadTicketDetail(tx, context.organisationId, ticketKey);
    if (!detail) throw new Error('A ticket that was just linked could not be read back');
    return detail;
  });
}

/** Removes a link that touches the ticket in the address. Allowed even if one side is archived. */
export async function removeLink(
  db: Db,
  input: { context: TicketContext; ticketKey: string; linkId: string },
): Promise<void> {
  const { context, ticketKey, linkId } = input;
  if (!UUID.test(linkId)) throw notFound();

  await db.transaction(async (tx) => {
    await lockStructure(tx, context.organisationId);
    const [link] = await tx
      .select({
        id: ticketLinks.id,
        kind: ticketLinks.kind,
        sourceKey: sql<string>`(select key from tickets where id = ${ticketLinks.sourceTicketId})`,
        targetKey: sql<string>`(select key from tickets where id = ${ticketLinks.targetTicketId})`,
      })
      .from(ticketLinks)
      .where(
        and(eq(ticketLinks.id, linkId), eq(ticketLinks.organisationId, context.organisationId)),
      );
    if (!link || (link.sourceKey !== ticketKey && link.targetKey !== ticketKey)) throw notFound();

    const locked = await lockInIdOrder(tx, context.organisationId, [
      link.sourceKey,
      link.targetKey,
    ]);
    await tx.delete(ticketLinks).where(eq(ticketLinks.id, link.id));
    await recordLink(
      tx,
      context,
      new Date(),
      'link.removed',
      link.kind as TicketLinkKind,
      locked.get(link.sourceKey)!,
      locked.get(link.targetKey)!,
    );
  });
}

async function recordLink(
  tx: Executor,
  context: TicketContext,
  now: Date,
  type: 'link.added' | 'link.removed',
  kind: TicketLinkKind,
  source: LockedTicket,
  target: LockedTicket,
) {
  for (const [ticket, other, direction] of [
    [source, target, 'outward'],
    [target, source, 'inward'],
  ] as const) {
    await addTicketEvent(tx, {
      organisationId: context.organisationId,
      ticketId: ticket.id,
      actorUserId: context.actorUserId,
      event: { type, data: { label: linkLabel(kind, direction), otherKey: other.key } },
      createdAt: now,
    });
  }
}

/**
 * Marks a ticket as a duplicate of another: links it (`duplicates`) and moves it to its project's
 * cancellation status in one transaction, following the workflow. Nothing changes if the move is
 * not allowed from where the ticket is.
 */
export async function markDuplicate(
  db: Db,
  input: { context: TicketContext; ticketKey: string; originalKey: string },
): Promise<TicketDetail> {
  return db.transaction((tx) => markDuplicateIn(tx, input));
}

/** The same, inside a transaction the caller already holds (triage approves with it). */
export async function markDuplicateIn(
  tx: Executor,
  input: { context: TicketContext; ticketKey: string; originalKey: string },
): Promise<TicketDetail> {
  const { context, ticketKey } = input;
  const originalKey = canonicalKey(input.originalKey);
  const noSuchTicket = () =>
    invalid('originalKey', `There is no ticket ${input.originalKey} in this workspace.`);
  if (!originalKey) throw noSuchTicket();

  await lockStructure(tx, context.organisationId);
  const locked = await lockInIdOrder(tx, context.organisationId, [ticketKey, originalKey]);
  const ticket = locked.get(ticketKey);
  if (!ticket) throw notFound();
  const original = locked.get(originalKey);
  if (!original) throw noSuchTicket();
  if (original.id === ticket.id) {
    throw invalid('originalKey', "A ticket can't be a duplicate of itself.");
  }
  assertWritable(ticket);
  assertWritable(original);
  if (ticket.triageState) throw inTriageError(ticket.key);
  // Each marked as a duplicate of the other would scrap both and lose the original.
  const [reverse] = await tx
    .select({ id: ticketLinks.id })
    .from(ticketLinks)
    .where(
      and(
        eq(ticketLinks.kind, 'duplicates'),
        eq(ticketLinks.sourceTicketId, original.id),
        eq(ticketLinks.targetTicketId, ticket.id),
      ),
    );
  if (reverse) {
    throw invalid(
      'originalKey',
      `${original.key} is already a duplicate of ${ticket.key}, so ${ticket.key} can't be a duplicate of it.`,
    );
  }

  const [current] = await tx
    .select({ id: projectStatuses.id, name: projectStatuses.name })
    .from(tickets)
    .innerJoin(projectStatuses, eq(projectStatuses.id, tickets.statusId))
    .where(eq(tickets.id, ticket.id));
  const [cancellation] = await tx
    .select({ id: projectStatuses.id, name: projectStatuses.name })
    .from(projectStatuses)
    .where(
      and(
        eq(projectStatuses.projectId, ticket.projectId),
        eq(projectStatuses.isCancellation, true),
        eq(projectStatuses.isActive, true),
      ),
    )
    .orderBy(asc(projectStatuses.sortOrder))
    .limit(1);
  if (!cancellation) {
    throw invalid('statusId', `${ticket.key}'s project has no status for work that won't be done.`);
  }
  if (current!.id !== cancellation.id) {
    const [allowed] = await tx
      .select({ id: statusTransitions.id })
      .from(statusTransitions)
      .where(
        and(
          eq(statusTransitions.projectId, ticket.projectId),
          eq(statusTransitions.fromStatusId, current!.id),
          eq(statusTransitions.toStatusId, cancellation.id),
        ),
      );
    if (!allowed) {
      throw invalid(
        'statusId',
        `${ticket.key} can't be ${cancellation.name.toLowerCase()} from ${current!.name}.`,
      );
    }
  }

  const now = new Date();
  const record = (ticketId: string, event: Parameters<typeof addTicketEvent>[1]['event']) =>
    addTicketEvent(tx, {
      organisationId: context.organisationId,
      ticketId,
      actorUserId: context.actorUserId,
      event,
      createdAt: now,
    });

  if (current!.id !== cancellation.id) {
    await tx
      .update(tickets)
      .set({
        statusId: cancellation.id,
        completedAt: now,
        statusBeforeJamId: null,
        version: sql`${tickets.version} + 1`,
        updatedAt: now,
      })
      .where(eq(tickets.id, ticket.id));
    await record(ticket.id, {
      type: 'ticket.status_changed',
      data: { from: current!, to: cancellation },
    });
  }

  const [existing] = await tx
    .select({ id: ticketLinks.id })
    .from(ticketLinks)
    .where(
      and(
        eq(ticketLinks.kind, 'duplicates'),
        eq(ticketLinks.sourceTicketId, ticket.id),
        eq(ticketLinks.targetTicketId, original.id),
      ),
    );
  if (!existing) {
    await tx.insert(ticketLinks).values({
      organisationId: context.organisationId,
      sourceTicketId: ticket.id,
      targetTicketId: original.id,
      kind: 'duplicates',
      createdBy: context.actorUserId,
      createdAt: now,
    });
    await record(original.id, {
      type: 'link.added',
      data: { label: linkLabel('duplicates', 'inward'), otherKey: ticket.key },
    });
  }
  await record(ticket.id, {
    type: 'ticket.marked_duplicate',
    data: { originalKey: original.key },
  });

  const detail = await loadTicketDetail(tx, context.organisationId, ticketKey);
  if (!detail) throw new Error('A ticket that was just updated could not be read back');
  return detail;
}

/**
 * Makes a new ticket in the parent's project and puts it under the parent, in one transaction: if
 * the parent cannot take it (three levels, archived), no ticket is made at all.
 */
export async function addChild(
  db: Db,
  input: { context: TicketContext; parentKey: string; body: CreateTicketBody },
): Promise<TicketDetail> {
  const { context, parentKey, body } = input;
  if (!hasPermission(context.permissions, 'tickets.edit')) {
    throw new AppError('forbidden', "You don't have permission to edit tickets.", 403);
  }
  return db.transaction(async (tx) => {
    const [parent] = await tx
      .select({ projectKey: projects.key })
      .from(tickets)
      .innerJoin(projects, eq(projects.id, tickets.projectId))
      .where(and(eq(tickets.organisationId, context.organisationId), eq(tickets.key, parentKey)));
    if (!parent) throw notFound();
    // Both run inside this transaction (as savepoints), so a refusal undoes the new ticket too.
    const scoped = tx as unknown as Db;
    const made = await createTicket(scoped, { context, projectKey: parent.projectKey, body });
    return setParent(scoped, { context, ticketKey: made.key, parentKey });
  });
}
