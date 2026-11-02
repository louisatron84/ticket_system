import { milestones, projectStatuses, projects, tickets, type Db, type Executor } from '@forge/db';
import {
  MAX_MILESTONES,
  createMilestoneBodySchema,
  normalizeProjectKey,
  updateMilestoneBodySchema,
  type EstimationSystem,
  type Milestone,
  type MilestoneHealth,
  type MilestoneList,
} from '@forge/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../audit';
import { orgAccess } from '../auth/guards';
import { isUniqueViolation } from '../db-errors';
import { AppError } from '../errors';
import { parseBody } from '../validation';

const notFound = () => new AppError('not_found', 'Not found.', 404);

const nameTaken = (projectKey: string, name: string) =>
  new AppError(
    'conflict',
    `The project ${projectKey} already has a milestone named "${name}".`,
    409,
  );

const archivedError = () =>
  new AppError('conflict', 'This project is archived. Unarchive it to change its milestones.', 409);

type MilestoneRow = typeof milestones.$inferSelect;

const auditOf = (row: MilestoneRow) => ({
  name: row.name,
  description: row.description,
  targetDate: row.targetDate,
  health: row.health,
  closed: row.closedAt !== null,
});

/** The project named in the URL, in the caller's workspace; locked when about to change it. */
async function projectOf(
  executor: Executor,
  organisationId: string,
  request: FastifyRequest,
  lock = false,
) {
  const key = normalizeProjectKey((request.params as { projectKey: string }).projectKey);
  if (!key) throw notFound();
  const query = executor
    .select({
      id: projects.id,
      key: projects.key,
      estimation: projects.estimation,
      archivedAt: projects.archivedAt,
    })
    .from(projects)
    .where(and(eq(projects.organisationId, organisationId), eq(projects.key, key)));
  const [project] = lock ? await query.for('update') : await query;
  if (!project) throw notFound();
  return project;
}

const milestoneIdParam = (request: FastifyRequest) => {
  const parsed = z.uuid().safeParse((request.params as { milestoneId: string }).milestoneId);
  if (!parsed.success) throw notFound();
  return parsed.data;
};

/**
 * The project's milestones with their progress: open before closed, soonest target first (none
 * last), then by name. Scrapped and archived tickets count for nothing, as on a parent's progress.
 */
async function loadMilestones(
  executor: Executor,
  project: { id: string; estimation: string },
): Promise<Milestone[]> {
  const estimate =
    project.estimation === 'points'
      ? sql`coalesce(${tickets.estimatePoints}, 0)`
      : sql`coalesce(${tickets.estimateMinutes}, 0)`;
  const counted = sql`${tickets.archivedAt} is null and not coalesce(${projectStatuses.isCancellation}, false)`;
  const done = sql`${counted} and ${projectStatuses.category} = 'completed'`;
  const rows = await executor
    .select({
      milestone: milestones,
      total: sql<number>`count(${tickets.id}) filter (where ${counted})::int`,
      done: sql<number>`count(${tickets.id}) filter (where ${done})::int`,
      estimateTotal: sql<number>`coalesce(sum(${estimate}) filter (where ${counted}), 0)::int`,
      estimateDone: sql<number>`coalesce(sum(${estimate}) filter (where ${done}), 0)::int`,
    })
    .from(milestones)
    .leftJoin(tickets, eq(tickets.milestoneId, milestones.id))
    .leftJoin(projectStatuses, eq(projectStatuses.id, tickets.statusId))
    .where(eq(milestones.projectId, project.id))
    .groupBy(milestones.id)
    .orderBy(
      sql`${milestones.closedAt} is not null`,
      sql`${milestones.targetDate} asc nulls last`,
      sql`lower(${milestones.name})`,
      milestones.id,
    );
  return rows.map(({ milestone, total, done: completed, estimateTotal, estimateDone }) => ({
    id: milestone.id,
    name: milestone.name,
    description: milestone.description,
    targetDate: milestone.targetDate,
    health: milestone.health as MilestoneHealth,
    closed: milestone.closedAt !== null,
    tickets: { done: completed, total },
    estimate: { done: estimateDone, total: estimateTotal },
  }));
}

export function registerMilestoneRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;
  const base = '/api/v1/orgs/:orgId/projects/:projectKey/milestones';

  const listOf = async (
    executor: Executor,
    project: { id: string; estimation: string; archivedAt: Date | null },
  ): Promise<MilestoneList> => ({
    estimation: project.estimation as EstimationSystem,
    archived: project.archivedAt !== null,
    milestones: await loadMilestones(executor, project),
  });

  app.get(base, { preHandler: orgAccess(db, 'tickets.view') }, async (request) => {
    const project = await projectOf(db, request.org!.organisationId, request);
    return listOf(db, project);
  });

  app.post(base, { preHandler: orgAccess(db, 'tickets.edit') }, async (request, reply) => {
    const body = parseBody(createMilestoneBodySchema, request.body);
    const org = request.org!;
    try {
      const result = await db.transaction(async (tx) => {
        const project = await projectOf(tx, org.organisationId, request, true);
        if (project.archivedAt) throw archivedError();
        const [count] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(milestones)
          .where(eq(milestones.projectId, project.id));
        if ((count?.count ?? 0) >= MAX_MILESTONES) {
          throw new AppError(
            'conflict',
            `A project can have at most ${MAX_MILESTONES} milestones. Delete one that is not used.`,
            409,
          );
        }
        const [row] = await tx
          .insert(milestones)
          .values({
            organisationId: org.organisationId,
            projectId: project.id,
            name: body.name,
            description: body.description ?? '',
            targetDate: body.targetDate ?? null,
            health: body.health ?? 'on_track',
            createdBy: org.actorUserId,
          })
          .returning();
        await recordAudit(tx, {
          organisationId: org.organisationId,
          actorUserId: org.actorUserId,
          action: 'milestone.created',
          targetType: 'milestone',
          targetId: row!.id,
          after: { project: project.key, ...auditOf(row!) },
          requestId: request.id,
          source: 'user',
          outcome: 'success',
        });
        return { list: await listOf(tx, project), id: row!.id };
      });
      reply.status(201);
      return result.list;
    } catch (error) {
      if (isUniqueViolation(error, 'milestones_project_name_unique')) {
        throw nameTaken((request.params as { projectKey: string }).projectKey, body.name);
      }
      throw error;
    }
  });

  app.patch(
    `${base}/:milestoneId`,
    { preHandler: orgAccess(db, 'tickets.edit') },
    async (request) => {
      const body = parseBody(updateMilestoneBodySchema, request.body);
      const milestoneId = milestoneIdParam(request);
      const org = request.org!;
      try {
        return await db.transaction(async (tx) => {
          const project = await projectOf(tx, org.organisationId, request, true);
          if (project.archivedAt) throw archivedError();
          const [before] = await tx
            .select()
            .from(milestones)
            .where(and(eq(milestones.id, milestoneId), eq(milestones.projectId, project.id)))
            .for('update');
          if (!before) throw notFound();

          const closedAt =
            body.closed === undefined
              ? before.closedAt
              : body.closed
                ? (before.closedAt ?? new Date())
                : null;
          const [after] = await tx
            .update(milestones)
            .set({
              ...(body.name !== undefined ? { name: body.name } : {}),
              ...(body.description !== undefined ? { description: body.description } : {}),
              ...(body.targetDate !== undefined ? { targetDate: body.targetDate } : {}),
              ...(body.health !== undefined ? { health: body.health } : {}),
              closedAt,
            })
            .where(eq(milestones.id, before.id))
            .returning();
          await recordAudit(tx, {
            organisationId: org.organisationId,
            actorUserId: org.actorUserId,
            action: 'milestone.updated',
            targetType: 'milestone',
            targetId: before.id,
            before: auditOf(before),
            after: auditOf(after!),
            requestId: request.id,
            source: 'user',
            outcome: 'success',
          });
          return listOf(tx, project);
        });
      } catch (error) {
        if (isUniqueViolation(error, 'milestones_project_name_unique')) {
          throw nameTaken(
            (request.params as { projectKey: string }).projectKey,
            body.name ?? 'that',
          );
        }
        throw error;
      }
    },
  );

  // Only a milestone no ticket has ever been put in can go; one with tickets is closed instead,
  // so the tickets' history keeps meaning something.
  app.delete(
    `${base}/:milestoneId`,
    { preHandler: orgAccess(db, 'tickets.edit') },
    async (request) => {
      const milestoneId = milestoneIdParam(request);
      const org = request.org!;
      return db.transaction(async (tx) => {
        const project = await projectOf(tx, org.organisationId, request, true);
        if (project.archivedAt) throw archivedError();
        const [row] = await tx
          .select()
          .from(milestones)
          .where(and(eq(milestones.id, milestoneId), eq(milestones.projectId, project.id)))
          .for('update');
        if (!row) throw notFound();
        const [used] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(tickets)
          .where(eq(tickets.milestoneId, row.id));
        if ((used?.count ?? 0) > 0) {
          throw new AppError(
            'conflict',
            `${row.name} has ${used!.count === 1 ? 'a ticket' : `${used!.count} tickets`}. Close it instead, or move the tickets out first.`,
            409,
          );
        }
        await tx.delete(milestones).where(eq(milestones.id, row.id));
        await recordAudit(tx, {
          organisationId: org.organisationId,
          actorUserId: org.actorUserId,
          action: 'milestone.deleted',
          targetType: 'milestone',
          targetId: row.id,
          before: auditOf(row),
          requestId: request.id,
          source: 'user',
          outcome: 'success',
        });
        return listOf(tx, project);
      });
    },
  );
}
