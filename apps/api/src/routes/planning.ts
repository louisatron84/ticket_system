import {
  cycles,
  milestones,
  projectStatuses,
  projects,
  ticketLinks,
  ticketTypes,
  tickets,
  type Db,
  type Executor,
} from '@forge/db';
import {
  BACKLOG_LIMIT,
  RANK_MAX_LENGTH,
  TIMELINE_EPIC_LIMIT,
  normalizeProjectKey,
  parseTicketKey,
  rankBetween,
  rankTicketBodySchema,
  spreadRanks,
  type Backlog,
  type EstimationSystem,
  type MilestoneHealth,
  type Timeline,
} from '@forge/shared';
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { recordAudit } from '../audit';
import { orgAccess, refuseTokens } from '../auth/guards';
import { AppError } from '../errors';
import { loadTicketSummaries } from '../tickets/read';
import { archivedProjectError, archivedTicketError, invalid } from '../tickets/service';
import { parseBody } from '../validation';
import { ticketKeyParam } from './tickets';

const notFound = () => new AppError('not_found', 'Not found.', 404);

/** Open work: not finished, not archived, not waiting in triage. */
const openInProject = (projectId: string) =>
  and(
    eq(tickets.projectId, projectId),
    isNull(tickets.archivedAt),
    isNull(tickets.triageState),
    ne(projectStatuses.category, 'completed'),
  );

/**
 * Gives every ticket of the project an evenly spaced rank, keeping the order they have. Only needed
 * when ranks have grown long or two have ended up equal; the caller holds the project's lock.
 */
async function spreadProjectRanks(executor: Executor, projectId: string): Promise<void> {
  const rows = await executor
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.projectId, projectId))
    .orderBy(asc(tickets.rank), asc(tickets.id));
  if (rows.length === 0) return;
  const ranks = spreadRanks(rows.length);
  await executor.execute(sql`
    update tickets set rank = v.rank
    from unnest(${sql.param(rows.map((row) => row.id))}::uuid[],
                ${sql.param(ranks)}::text[]) as v(id, rank)
    where tickets.id = v.id`);
}

/** The rank of the ticket next to `rank` (above or below), leaving out the one being moved. */
async function neighbourRank(
  executor: Executor,
  input: { projectId: string; movingId: string; rank: string | null; side: 'above' | 'below' },
): Promise<string | null> {
  const { projectId, movingId, rank, side } = input;
  const [row] = await executor
    .select({ rank: tickets.rank })
    .from(tickets)
    .where(
      and(
        eq(tickets.projectId, projectId),
        ne(tickets.id, movingId),
        rank === null
          ? undefined
          : side === 'above'
            ? lt(tickets.rank, rank)
            : gt(tickets.rank, rank),
      ),
    )
    .orderBy(side === 'above' ? desc(tickets.rank) : asc(tickets.rank))
    .limit(1);
  return row?.rank ?? null;
}

export function registerPlanningRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;

  app.get(
    '/api/v1/orgs/:orgId/projects/:projectKey/timeline',
    { preHandler: orgAccess(db, 'tickets.view') },
    async (request): Promise<Timeline> => {
      const key = normalizeProjectKey((request.params as { projectKey: string }).projectKey);
      if (!key) throw notFound();
      const organisationId = request.org!.organisationId;
      const [project] = await db
        .select({ id: projects.id, archivedAt: projects.archivedAt })
        .from(projects)
        .where(and(eq(projects.organisationId, organisationId), eq(projects.key, key)));
      if (!project) throw notFound();

      const epicWhere = and(
        eq(tickets.projectId, project.id),
        isNull(tickets.archivedAt),
        eq(ticketTypes.key, 'epic'),
      );
      const [epicRows, [count], milestoneRows] = await Promise.all([
        db
          .select({
            id: tickets.id,
            key: tickets.key,
            startDate: tickets.startDate,
            dueDate: tickets.dueDate,
          })
          .from(tickets)
          .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.typeId))
          .where(epicWhere)
          .orderBy(sql`${tickets.startDate} asc nulls last`, asc(tickets.number))
          .limit(TIMELINE_EPIC_LIMIT),
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(tickets)
          .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.typeId))
          .where(epicWhere),
        db
          .select()
          .from(milestones)
          .where(eq(milestones.projectId, project.id))
          .orderBy(sql`${milestones.targetDate} asc nulls last`, asc(milestones.name)),
      ]);
      const ids = epicRows.map((row) => row.id);
      const [summaries, links] = await Promise.all([
        loadTicketSummaries(db, organisationId, ids),
        ids.length === 0
          ? []
          : db
              .select({ source: ticketLinks.sourceTicketId, target: ticketLinks.targetTicketId })
              .from(ticketLinks)
              .where(
                and(
                  eq(ticketLinks.kind, 'blocks'),
                  inArray(ticketLinks.sourceTicketId, ids),
                  inArray(ticketLinks.targetTicketId, ids),
                ),
              ),
      ]);
      const byId = new Map(epicRows.map((row) => [row.id, row] as const));
      return {
        archived: project.archivedAt !== null,
        epics: summaries.map((summary) => {
          const row = byId.get(summary.id)!;
          return {
            key: summary.key,
            title: summary.title,
            status: {
              key: summary.status.key,
              name: summary.status.name,
              category: summary.status.category,
            },
            startDate: row.startDate,
            dueDate: row.dueDate,
            assignee: summary.assignee ? { displayName: summary.assignee.displayName } : null,
            progress: summary.progress,
          };
        }),
        milestones: milestoneRows.map((row) => ({
          id: row.id,
          name: row.name,
          targetDate: row.targetDate,
          health: row.health as MilestoneHealth,
          closed: row.closedAt !== null,
        })),
        dependencies: links.map((link) => ({
          blocker: byId.get(link.source)!.key,
          blocked: byId.get(link.target)!.key,
        })),
        hiddenEpics: Math.max(0, (count?.total ?? 0) - epicRows.length),
      };
    },
  );

  app.get(
    '/api/v1/orgs/:orgId/projects/:projectKey/backlog',
    { preHandler: orgAccess(db, 'tickets.view') },
    async (request): Promise<Backlog> => {
      const key = normalizeProjectKey((request.params as { projectKey: string }).projectKey);
      if (!key) throw notFound();
      const organisationId = request.org!.organisationId;
      const [project] = await db
        .select({
          id: projects.id,
          estimation: projects.estimation,
          archivedAt: projects.archivedAt,
          cyclesEnabled: projects.cyclesEnabled,
        })
        .from(projects)
        .where(and(eq(projects.organisationId, organisationId), eq(projects.key, key)));
      if (!project) throw notFound();

      const [rows, [count]] = await Promise.all([
        db
          .select({
            id: tickets.id,
            rank: tickets.rank,
            estimateMinutes: tickets.estimateMinutes,
            estimatePoints: tickets.estimatePoints,
            cycleId: tickets.cycleId,
          })
          .from(tickets)
          .innerJoin(projectStatuses, eq(projectStatuses.id, tickets.statusId))
          .where(openInProject(project.id))
          .orderBy(asc(tickets.rank), asc(tickets.id))
          .limit(BACKLOG_LIMIT),
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(tickets)
          .innerJoin(projectStatuses, eq(projectStatuses.id, tickets.statusId))
          .where(openInProject(project.id)),
      ]);
      const openCycles = project.cyclesEnabled
        ? await db
            .select({ id: cycles.id, name: cycles.name, state: cycles.state })
            .from(cycles)
            .where(and(eq(cycles.projectId, project.id), ne(cycles.state, 'completed')))
            .orderBy(
              desc(sql`${cycles.state} = 'active'`),
              asc(cycles.startsOn),
              asc(cycles.number),
            )
        : [];
      const summaries = await loadTicketSummaries(
        db,
        organisationId,
        rows.map((row) => row.id),
      );
      const byId = new Map(rows.map((row) => [row.id, row] as const));
      return {
        estimation: project.estimation as EstimationSystem,
        archived: project.archivedAt !== null,
        cycles: openCycles.map((cycle) => ({
          ...cycle,
          state: cycle.state as 'planned' | 'active',
        })),
        items: summaries.map((summary) => {
          const row = byId.get(summary.id)!;
          return {
            ...summary,
            rank: row.rank,
            estimateMinutes: row.estimateMinutes,
            estimatePoints: row.estimatePoints,
            cycleId: project.cyclesEnabled ? row.cycleId : null,
          };
        }),
        total: count?.total ?? 0,
      };
    },
  );

  app.post(
    '/api/v1/orgs/:orgId/tickets/:ticketKey/rank',
    { preHandler: [refuseTokens, orgAccess(db, 'tickets.edit')] },
    async (request): Promise<{ key: string; rank: string }> => {
      const ticketKey = ticketKeyParam(request);
      const body = parseBody(rankTicketBodySchema, request.body);
      const org = request.org!;

      return db.transaction(async (tx) => {
        const [moving] = await tx
          .select({
            id: tickets.id,
            projectId: tickets.projectId,
            rank: tickets.rank,
            archivedAt: tickets.archivedAt,
          })
          .from(tickets)
          .where(and(eq(tickets.organisationId, org.organisationId), eq(tickets.key, ticketKey)));
        if (!moving) throw notFound();
        // One move at a time per project, so two moves into the same gap get different ranks.
        const [project] = await tx
          .select({ archivedAt: projects.archivedAt })
          .from(projects)
          .where(eq(projects.id, moving.projectId))
          .for('update');
        if (project?.archivedAt) throw archivedProjectError();
        if (moving.archivedAt) throw archivedTicketError();

        // The neighbours named in the request, which must be other tickets of the same project.
        const neighbour = async (field: 'after' | 'before', raw: string | undefined) => {
          if (raw === undefined) return null;
          const parsed = parseTicketKey(raw);
          const [row] = parsed
            ? await tx
                .select({ id: tickets.id, projectId: tickets.projectId })
                .from(tickets)
                .where(
                  and(
                    eq(tickets.organisationId, org.organisationId),
                    eq(tickets.key, `${parsed.projectKey}-${parsed.number}`),
                  ),
                )
            : [];
          if (!row || row.projectId !== moving.projectId || row.id === moving.id) {
            throw invalid([
              {
                path: field,
                message: `Choose another ticket of the same project as ${ticketKey}.`,
              },
            ]);
          }
          return row.id;
        };
        const afterId = await neighbour('after', body.after);
        const beforeId = await neighbour('before', body.before);

        const rankOf = async (id: string) => {
          const [row] = await tx
            .select({ rank: tickets.rank })
            .from(tickets)
            .where(eq(tickets.id, id));
          return row!.rank;
        };
        const place = { projectId: moving.projectId, movingId: moving.id };
        // The two ranks the ticket goes between (null: no limit that side).
        const bounds = async (): Promise<[string | null, string | null]> => {
          if (body.to === 'top') {
            return [null, await neighbourRank(tx, { ...place, rank: null, side: 'below' })];
          }
          if (body.to === 'bottom') {
            return [await neighbourRank(tx, { ...place, rank: null, side: 'above' }), null];
          }
          const low = afterId ? await rankOf(afterId) : null;
          const high = beforeId ? await rankOf(beforeId) : null;
          // Both named but no longer in that order (someone moved one meanwhile): go below `after`.
          if (low !== null && (high === null || high <= low)) {
            return [low, await neighbourRank(tx, { ...place, rank: low, side: 'below' })];
          }
          return [await neighbourRank(tx, { ...place, rank: high, side: 'above' }), high];
        };

        // A bound that other tickets share leaves no single gap to go into.
        const shared = async (value: string | null) => {
          if (value === null) return false;
          const [row] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(tickets)
            .where(
              and(
                eq(tickets.projectId, moving.projectId),
                ne(tickets.id, moving.id),
                eq(tickets.rank, value),
              ),
            );
          return (row?.count ?? 0) > 1;
        };

        let [low, high] = await bounds();
        let rank: string | null = null;
        if (
          (low === null || high === null || low < high) &&
          !(await shared(low)) &&
          !(await shared(high))
        ) {
          rank = rankBetween(low, high);
        }
        if (rank === null || rank.length > RANK_MAX_LENGTH) {
          await spreadProjectRanks(tx, moving.projectId);
          [low, high] = await bounds();
          rank = rankBetween(low, high);
        }

        // Ordering is not an edit: the version, "updated" time and history stay as they are.
        await tx.update(tickets).set({ rank }).where(eq(tickets.id, moving.id));
        await recordAudit(tx, {
          organisationId: org.organisationId,
          actorUserId: org.actorUserId,
          action: 'ticket.ranked',
          targetType: 'ticket',
          targetId: ticketKey,
          before: { rank: moving.rank },
          after: { rank, ...body },
          requestId: request.id,
          source: 'user',
          outcome: 'success',
        });
        return { key: ticketKey, rank };
      });
    },
  );
}
