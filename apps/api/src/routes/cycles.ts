import {
  addTicketEvent,
  cycleScopeChanges,
  cycles,
  projectStatuses,
  projects,
  tickets,
  type Db,
  type Executor,
} from '@forge/db';
import {
  MAX_CYCLE_DAYS,
  MAX_PLANNED_CYCLES,
  addDays,
  completeCycleBodySchema,
  createCycleBodySchema,
  normalizeProjectKey,
  updateCycleBodySchema,
  type Burndown,
  type Cycle,
  type CycleList,
  type CycleState,
  type EstimationSystem,
} from '@forge/shared';
import { and, asc, eq, inArray, isNull, max, ne, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../audit';
import { orgAccess, refuseTokens } from '../auth/guards';
import { AppError } from '../errors';
import { recordCycleMove } from '../tickets/cycle-scope';
import { parseBody } from '../validation';

const notFound = () => new AppError('not_found', 'Not found.', 404);
const conflict = (message: string) => new AppError('conflict', message, 409);
const archivedError = () =>
  conflict('This project is archived. Unarchive it to change its cycles.');

export type CycleProjectRow = {
  id: string;
  key: string;
  estimation: string;
  archivedAt: Date | null;
  cyclesEnabled: boolean;
  cycleLengthDays: number;
};
type CycleRow = typeof cycles.$inferSelect;

/** Today's date in UTC, the calendar cycles are planned on. */
const today = () => new Date().toISOString().slice(0, 10);

async function projectOf(
  executor: Executor,
  organisationId: string,
  request: FastifyRequest,
  lock = false,
): Promise<CycleProjectRow> {
  const key = normalizeProjectKey((request.params as { projectKey: string }).projectKey);
  if (!key) throw notFound();
  const query = executor
    .select({
      id: projects.id,
      key: projects.key,
      estimation: projects.estimation,
      archivedAt: projects.archivedAt,
      cyclesEnabled: projects.cyclesEnabled,
      cycleLengthDays: projects.cycleLengthDays,
    })
    .from(projects)
    .where(and(eq(projects.organisationId, organisationId), eq(projects.key, key)));
  const [project] = lock ? await query.for('update') : await query;
  if (!project) throw notFound();
  return project;
}

/** A project that can change its cycles now: not archived, with cycles switched on. */
function refuseUnlessPlannable(project: CycleProjectRow) {
  if (project.archivedAt) throw archivedError();
  if (!project.cyclesEnabled) {
    throw conflict(`Cycles are off for ${project.key}. Switch them on in the project's settings.`);
  }
}

/** A cycle ends after it starts and runs at most a year: its burndown has a row per day. */
function checkCycleDates(startsOn: string, endsOn: string) {
  const problem =
    endsOn <= startsOn
      ? 'A cycle must end after it starts.'
      : endsOn > addDays(startsOn, MAX_CYCLE_DAYS - 1)
        ? `A cycle can run for at most ${MAX_CYCLE_DAYS} days.`
        : null;
  if (problem) {
    throw new AppError('validation_failed', problem, 422, [{ path: 'endsOn', message: problem }]);
  }
}

const cycleIdParam = (request: FastifyRequest) => {
  const parsed = z.uuid().safeParse((request.params as { cycleId: string }).cycleId);
  if (!parsed.success) throw notFound();
  return parsed.data;
};

async function cycleOf(executor: Executor, project: CycleProjectRow, cycleId: string) {
  const [row] = await executor
    .select()
    .from(cycles)
    .where(and(eq(cycles.id, cycleId), eq(cycles.projectId, project.id)))
    .for('update');
  if (!row) throw notFound();
  return row;
}

/** A ticket's estimate in the project's system, as SQL (none counts as nothing). */
const estimateOf = (estimation: string) =>
  estimation === 'points'
    ? sql`coalesce(${tickets.estimatePoints}, 0)`
    : sql`coalesce(${tickets.estimateMinutes}, 0)`;

/** Tickets that count: not archived, not scrapped. Done: in a completed status as well. */
const counted = sql`${tickets.archivedAt} is null and not ${projectStatuses.isCancellation}`;
const completed = sql`${counted} and ${projectStatuses.category} = 'completed'`;

/** How many tickets each cycle has now, and how much estimate, done and in all. */
async function countsByCycle(executor: Executor, project: CycleProjectRow, cycleIds: string[]) {
  if (cycleIds.length === 0)
    return new Map<string, Cycle['tickets'] & { de: number; et: number }>();
  const estimate = estimateOf(project.estimation);
  const rows = await executor
    .select({
      cycleId: tickets.cycleId,
      total: sql<number>`count(*) filter (where ${counted})::int`,
      done: sql<number>`count(*) filter (where ${completed})::int`,
      estimateTotal: sql<number>`coalesce(sum(${estimate}) filter (where ${counted}), 0)::int`,
      estimateDone: sql<number>`coalesce(sum(${estimate}) filter (where ${completed}), 0)::int`,
    })
    .from(tickets)
    .innerJoin(projectStatuses, eq(projectStatuses.id, tickets.statusId))
    .where(inArray(tickets.cycleId, cycleIds))
    .groupBy(tickets.cycleId);
  return new Map(
    rows.map((row) => [
      row.cycleId!,
      { done: row.done, total: row.total, de: row.estimateDone, et: row.estimateTotal },
    ]),
  );
}

const STATE_ORDER: Record<CycleState, number> = { active: 0, planned: 1, completed: 2 };

async function listOf(executor: Executor, project: CycleProjectRow): Promise<CycleList> {
  const rows = await executor.select().from(cycles).where(eq(cycles.projectId, project.id));
  // Active, then planned soonest first, then completed latest first.
  rows.sort((a, b) => {
    const state = STATE_ORDER[a.state as CycleState] - STATE_ORDER[b.state as CycleState];
    if (state !== 0) return state;
    const byStart =
      a.startsOn < b.startsOn ? -1 : a.startsOn > b.startsOn ? 1 : a.number - b.number;
    return a.state === 'completed' ? -byStart : byStart;
  });
  const counts = await countsByCycle(
    executor,
    project,
    rows.map((row) => row.id),
  );
  return {
    enabled: project.cyclesEnabled,
    lengthDays: project.cycleLengthDays,
    estimation: project.estimation as EstimationSystem,
    archived: project.archivedAt !== null,
    cycles: rows.map((row) => {
      const count = counts.get(row.id);
      return {
        id: row.id,
        number: row.number,
        name: row.name,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        capacity: row.capacity,
        state: row.state as CycleState,
        tickets: { done: count?.done ?? 0, total: count?.total ?? 0 },
        estimate: { done: count?.de ?? 0, total: count?.et ?? 0 },
        planned:
          row.plannedTickets === null
            ? null
            : { tickets: row.plannedTickets, estimate: row.plannedEstimate ?? 0 },
        done:
          row.doneTickets === null
            ? null
            : { tickets: row.doneTickets, estimate: row.doneEstimate ?? 0 },
      };
    }),
  };
}

const auditOf = (row: CycleRow) => ({
  number: row.number,
  name: row.name,
  startsOn: row.startsOn,
  endsOn: row.endsOn,
  capacity: row.capacity,
  state: row.state,
});

/** Makes the next cycle of the project: numbered after the last, starting after the last ends. */
async function insertCycle(
  tx: Executor,
  project: CycleProjectRow,
  input: {
    organisationId: string;
    actorUserId: string;
    name?: string;
    startsOn?: string;
    endsOn?: string;
    capacity?: number | null;
  },
): Promise<CycleRow> {
  const [last] = await tx
    .select({ number: max(cycles.number), endsOn: max(cycles.endsOn) })
    .from(cycles)
    .where(eq(cycles.projectId, project.id));
  const number = (last?.number ?? 0) + 1;
  const startsOn = input.startsOn ?? (last?.endsOn ? addDays(last.endsOn, 1) : today());
  const endsOn = input.endsOn ?? addDays(startsOn, project.cycleLengthDays - 1);
  checkCycleDates(startsOn, endsOn);
  const [row] = await tx
    .insert(cycles)
    .values({
      organisationId: input.organisationId,
      projectId: project.id,
      number,
      name: input.name ?? `Cycle ${number}`,
      startsOn,
      endsOn,
      capacity: input.capacity ?? null,
      createdBy: input.actorUserId,
    })
    .returning();
  return row!;
}

/** What a cycle holds right now, by tickets and estimate. */
async function scopeNow(tx: Executor, project: CycleProjectRow, cycleId: string) {
  const count = (await countsByCycle(tx, project, [cycleId])).get(cycleId);
  return {
    tickets: count?.total ?? 0,
    estimate: count?.et ?? 0,
    doneTickets: count?.done ?? 0,
    doneEstimate: count?.de ?? 0,
  };
}

/**
 * The burndown of a cycle, one point per day from its start to its end (or to today while it
 * runs). Scope comes from the cycle's log of tickets joining and leaving; a ticket counts as done
 * from the moment it was completed, using its current estimate.
 */
export async function burndownOf(executor: Executor, project: CycleProjectRow, cycle: CycleRow) {
  if (cycle.state === 'planned') return [];
  const changes = await executor
    .select()
    .from(cycleScopeChanges)
    .where(eq(cycleScopeChanges.cycleId, cycle.id))
    .orderBy(asc(cycleScopeChanges.at), asc(cycleScopeChanges.id));
  const ids = [...new Set(changes.map((change) => change.ticketId))];
  const info =
    ids.length === 0
      ? []
      : await executor
          .select({
            id: tickets.id,
            minutes: tickets.estimateMinutes,
            points: tickets.estimatePoints,
            completedAt: tickets.completedAt,
            archivedAt: tickets.archivedAt,
            category: projectStatuses.category,
            cancellation: projectStatuses.isCancellation,
          })
          .from(tickets)
          .innerJoin(projectStatuses, eq(projectStatuses.id, tickets.statusId))
          .where(inArray(tickets.id, ids));
  const byId = new Map(info.map((row) => [row.id, row] as const));

  const end = cycle.state === 'active' && today() < cycle.endsOn ? today() : cycle.endsOn;
  // Cycles made before dates were limited could span centuries: never walk more than a year.
  const longest = addDays(cycle.startsOn, MAX_CYCLE_DAYS - 1);
  const last = end < longest ? end : longest;
  const days: Burndown['days'] = [];
  const inScope = new Set<string>();
  let next = 0;
  for (let date = cycle.startsOn; date <= last; date = addDays(date, 1)) {
    const endOfDay = new Date(`${addDays(date, 1)}T00:00:00Z`);
    while (next < changes.length && changes[next]!.at < endOfDay) {
      const change = changes[next]!;
      if (change.change === 'added') inScope.add(change.ticketId);
      else inScope.delete(change.ticketId);
      next += 1;
    }
    let scopeTickets = 0;
    let remainingTickets = 0;
    let scopeEstimate = 0;
    let remainingEstimate = 0;
    for (const id of inScope) {
      const ticket = byId.get(id);
      if (!ticket || ticket.archivedAt || ticket.cancellation) continue;
      const estimate = (project.estimation === 'points' ? ticket.points : ticket.minutes) ?? 0;
      const done =
        ticket.category === 'completed' &&
        ticket.completedAt !== null &&
        ticket.completedAt < endOfDay;
      scopeTickets += 1;
      scopeEstimate += estimate;
      if (!done) {
        remainingTickets += 1;
        remainingEstimate += estimate;
      }
    }
    days.push({ date, scopeTickets, remainingTickets, scopeEstimate, remainingEstimate });
  }
  return days;
}

export function registerCycleRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;
  const base = '/api/v1/orgs/:orgId/projects/:projectKey/cycles';

  const audit = (
    tx: Executor,
    request: FastifyRequest,
    action: string,
    targetId: string,
    before?: unknown,
    after?: unknown,
  ) =>
    recordAudit(tx, {
      organisationId: request.org!.organisationId,
      actorUserId: request.org!.actorUserId,
      action,
      targetType: 'cycle',
      targetId,
      ...(before !== undefined ? { before } : {}),
      ...(after !== undefined ? { after } : {}),
      requestId: request.id,
      source: 'user',
      outcome: 'success',
    });

  app.get(base, { preHandler: orgAccess(db, 'tickets.view') }, async (request) =>
    listOf(db, await projectOf(db, request.org!.organisationId, request)),
  );

  app.post(
    base,
    { preHandler: [refuseTokens, orgAccess(db, 'tickets.edit')] },
    async (request, reply) => {
      const body = parseBody(createCycleBodySchema, request.body);
      const org = request.org!;
      const list = await db.transaction(async (tx) => {
        const project = await projectOf(tx, org.organisationId, request, true);
        refuseUnlessPlannable(project);
        const [planned] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(cycles)
          .where(and(eq(cycles.projectId, project.id), eq(cycles.state, 'planned')));
        if ((planned?.count ?? 0) >= MAX_PLANNED_CYCLES) {
          throw conflict(`At most ${MAX_PLANNED_CYCLES} cycles can be planned ahead.`);
        }
        const row = await insertCycle(tx, project, {
          organisationId: org.organisationId,
          actorUserId: org.actorUserId,
          ...body,
        });
        await audit(tx, request, 'cycle.created', row.id, undefined, {
          project: project.key,
          ...auditOf(row),
        });
        return listOf(tx, project);
      });
      reply.status(201);
      return list;
    },
  );

  app.patch(
    `${base}/:cycleId`,
    { preHandler: [refuseTokens, orgAccess(db, 'tickets.edit')] },
    async (request) => {
      const body = parseBody(updateCycleBodySchema, request.body);
      const cycleId = cycleIdParam(request);
      return db.transaction(async (tx) => {
        const project = await projectOf(tx, request.org!.organisationId, request, true);
        refuseUnlessPlannable(project);
        const before = await cycleOf(tx, project, cycleId);
        if (before.state === 'completed') throw conflict(`${before.name} is completed.`);
        const startsOn = body.startsOn ?? before.startsOn;
        const endsOn = body.endsOn ?? before.endsOn;
        checkCycleDates(startsOn, endsOn);
        const [after] = await tx
          .update(cycles)
          .set({
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.capacity !== undefined ? { capacity: body.capacity } : {}),
            startsOn,
            endsOn,
          })
          .where(eq(cycles.id, before.id))
          .returning();
        await audit(tx, request, 'cycle.updated', before.id, auditOf(before), auditOf(after!));
        return listOf(tx, project);
      });
    },
  );

  app.delete(
    `${base}/:cycleId`,
    { preHandler: [refuseTokens, orgAccess(db, 'tickets.edit')] },
    async (request) => {
      const cycleId = cycleIdParam(request);
      return db.transaction(async (tx) => {
        const project = await projectOf(tx, request.org!.organisationId, request, true);
        if (project.archivedAt) throw archivedError();
        const row = await cycleOf(tx, project, cycleId);
        if (row.state !== 'planned') {
          throw conflict(
            `${row.name} has started, so it stays in the record. Complete it instead.`,
          );
        }
        const [used] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(tickets)
          .where(eq(tickets.cycleId, row.id));
        if ((used?.count ?? 0) > 0) {
          throw conflict(`${row.name} has tickets. Move them out before deleting it.`);
        }
        await tx.delete(cycles).where(eq(cycles.id, row.id));
        await audit(tx, request, 'cycle.deleted', row.id, auditOf(row));
        return listOf(tx, project);
      });
    },
  );

  app.post(
    `${base}/:cycleId/start`,
    { preHandler: [refuseTokens, orgAccess(db, 'tickets.edit')] },
    async (request) => {
      const cycleId = cycleIdParam(request);
      return db.transaction(async (tx) => {
        const project = await projectOf(tx, request.org!.organisationId, request, true);
        refuseUnlessPlannable(project);
        const row = await cycleOf(tx, project, cycleId);
        if (row.state !== 'planned') throw conflict(`${row.name} has already started.`);
        const [active] = await tx
          .select({ name: cycles.name })
          .from(cycles)
          .where(and(eq(cycles.projectId, project.id), eq(cycles.state, 'active')));
        if (active) throw conflict(`${active.name} is still running. Complete it first.`);
        const scope = await scopeNow(tx, project, row.id);
        const [after] = await tx
          .update(cycles)
          .set({
            state: 'active',
            startedAt: new Date(),
            plannedTickets: scope.tickets,
            plannedEstimate: scope.estimate,
          })
          .where(eq(cycles.id, row.id))
          .returning();
        await audit(tx, request, 'cycle.started', row.id, auditOf(row), auditOf(after!));
        return listOf(tx, project);
      });
    },
  );

  app.post(
    `${base}/:cycleId/complete`,
    { preHandler: [refuseTokens, orgAccess(db, 'tickets.edit')] },
    async (request) => {
      const body = parseBody(completeCycleBodySchema, request.body);
      const cycleId = cycleIdParam(request);
      const org = request.org!;
      return db.transaction(async (tx) => {
        const project = await projectOf(tx, org.organisationId, request, true);
        refuseUnlessPlannable(project);
        const row = await cycleOf(tx, project, cycleId);
        if (row.state !== 'active') throw conflict(`${row.name} is not running.`);
        const scope = await scopeNow(tx, project, row.id);
        const now = new Date();

        // Unfinished work: not completed and not archived. Scrapped tickets are completed too.
        const unfinished = await tx
          .select({ id: tickets.id })
          .from(tickets)
          .innerJoin(projectStatuses, eq(projectStatuses.id, tickets.statusId))
          .where(
            and(
              eq(tickets.cycleId, row.id),
              isNull(tickets.archivedAt),
              ne(projectStatuses.category, 'completed'),
            ),
          )
          .for('update', { of: tickets });
        let target: CycleRow | null = null;
        if (body.unfinished === 'next' && unfinished.length > 0) {
          [target = null] = await tx
            .select()
            .from(cycles)
            .where(and(eq(cycles.projectId, project.id), eq(cycles.state, 'planned')))
            .orderBy(asc(cycles.startsOn), asc(cycles.number))
            .limit(1);
          if (!target) {
            target = await insertCycle(tx, project, {
              organisationId: org.organisationId,
              actorUserId: org.actorUserId,
              startsOn: addDays(row.endsOn, 1),
            });
            await audit(tx, request, 'cycle.created', target.id, undefined, {
              project: project.key,
              ...auditOf(target),
            });
          }
        }

        const ids = unfinished.map((ticket) => ticket.id);
        if (ids.length > 0) {
          await tx
            .update(tickets)
            .set({
              cycleId: target?.id ?? null,
              version: sql`${tickets.version} + 1`,
              updatedAt: now,
            })
            .where(inArray(tickets.id, ids));
          await recordCycleMove(tx, {
            organisationId: org.organisationId,
            ticketIds: ids,
            from: row.id,
            to: target?.id ?? null,
            at: now,
          });
          for (const ticketId of ids) {
            await addTicketEvent(tx, {
              organisationId: org.organisationId,
              ticketId,
              actorUserId: org.actorUserId,
              event: {
                type: 'ticket.updated',
                data: { changes: [{ field: 'cycle', from: row.name, to: target?.name ?? null }] },
              },
              createdAt: now,
            });
          }
        }

        const [after] = await tx
          .update(cycles)
          .set({
            state: 'completed',
            completedAt: now,
            doneTickets: scope.doneTickets,
            doneEstimate: scope.doneEstimate,
          })
          .where(eq(cycles.id, row.id))
          .returning();
        await audit(tx, request, 'cycle.completed', row.id, auditOf(row), {
          ...auditOf(after!),
          unfinished: ids.length,
          movedTo: target?.name ?? 'backlog',
        });
        return listOf(tx, project);
      });
    },
  );

  app.get(
    `${base}/:cycleId/burndown`,
    { preHandler: orgAccess(db, 'tickets.view') },
    async (request): Promise<Burndown> => {
      const cycleId = cycleIdParam(request);
      const project = await projectOf(db, request.org!.organisationId, request);
      const [row] = await db
        .select()
        .from(cycles)
        .where(and(eq(cycles.id, cycleId), eq(cycles.projectId, project.id)));
      if (!row) throw notFound();
      return {
        estimation: project.estimation as EstimationSystem,
        days: await burndownOf(db, project, row),
      };
    },
  );
}
