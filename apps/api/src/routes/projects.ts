import {
  components,
  createProject,
  labels,
  priorities,
  projectStatuses,
  projects,
  statusTransitions,
  ticketTypes,
  tickets,
  type Db,
} from '@forge/db';
import {
  createComponentBodySchema,
  createProjectBodySchema,
  normalizeProjectKey,
  updateProjectBodySchema,
  type Component,
  type Project,
  type ProjectDetail,
  type TicketConfig,
} from '@forge/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { recordAudit } from '../audit';
import { orgAccess } from '../auth/guards';
import { isUniqueViolation } from '../db-errors';
import { AppError } from '../errors';
import { parseBody } from '../validation';

const notFound = () => new AppError('not_found', 'Not found.', 404);

/** Projects with how many tickets they hold and how many of those are not finished. */
async function loadProjects(db: Db, organisationId: string, onlyKey?: string): Promise<Project[]> {
  const rows = await db
    .select({
      id: projects.id,
      key: projects.key,
      name: projects.name,
      description: projects.description,
      archivedAt: projects.archivedAt,
      blockersStopCompletion: projects.blockersStopCompletion,
      triageEnabled: projects.triageEnabled,
      ticketCount: sql<number>`count(${tickets.id}) filter (where ${tickets.archivedAt} is null)::int`,
      openCount: sql<number>`count(${tickets.id}) filter (where ${tickets.archivedAt} is null and ${projectStatuses.category} <> 'completed')::int`,
    })
    .from(projects)
    .leftJoin(tickets, eq(tickets.projectId, projects.id))
    .leftJoin(projectStatuses, eq(projectStatuses.id, tickets.statusId))
    .where(
      and(
        eq(projects.organisationId, organisationId),
        onlyKey ? eq(projects.key, onlyKey) : undefined,
      ),
    )
    .groupBy(projects.id)
    // Active projects first, then archived; by name within each.
    .orderBy(asc(sql`${projects.archivedAt} is not null`), asc(projects.name));

  return rows.map(({ archivedAt, ...row }) => ({ ...row, archived: archivedAt !== null }));
}

export function registerProjectRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;

  app.get(
    '/api/v1/orgs/:orgId/projects',
    { preHandler: orgAccess(db, 'tickets.view') },
    async (request): Promise<Project[]> => loadProjects(db, request.org!.organisationId),
  );

  app.post(
    '/api/v1/orgs/:orgId/projects',
    { preHandler: orgAccess(db, 'projects.manage') },
    async (request, reply): Promise<Project> => {
      const body = parseBody(createProjectBodySchema, request.body);
      const org = request.org!;

      try {
        await db.transaction(async (tx) => {
          await createProject(tx, {
            organisationId: org.organisationId,
            key: body.key,
            name: body.name,
            description: body.description ?? '',
            createdBy: org.actorUserId,
          });
          await recordAudit(tx, {
            organisationId: org.organisationId,
            actorUserId: org.actorUserId,
            action: 'project.created',
            targetType: 'project',
            targetId: body.key,
            after: { key: body.key, name: body.name },
            requestId: request.id,
            source: 'user',
            outcome: 'success',
          });
        });
      } catch (error) {
        if (isUniqueViolation(error, 'projects_organisation_key_unique')) {
          throw new AppError('conflict', `The project key ${body.key} is already in use.`, 409);
        }
        throw error;
      }

      const [project] = await loadProjects(db, org.organisationId, body.key);
      reply.status(201);
      return project!;
    },
  );

  app.get(
    '/api/v1/orgs/:orgId/projects/:projectKey',
    { preHandler: orgAccess(db, 'tickets.view') },
    async (request): Promise<ProjectDetail> => {
      const key = normalizeProjectKey((request.params as { projectKey: string }).projectKey);
      if (!key) throw notFound();
      const organisationId = request.org!.organisationId;

      const [project] = await loadProjects(db, organisationId, key);
      if (!project) throw notFound();

      const statuses = await db
        .select()
        .from(projectStatuses)
        .where(and(eq(projectStatuses.projectId, project.id), eq(projectStatuses.isActive, true)))
        .orderBy(asc(projectStatuses.sortOrder));
      const activeIds = new Set(statuses.map((status) => status.id));

      const transitions = (
        await db.select().from(statusTransitions).where(eq(statusTransitions.projectId, project.id))
      )
        .filter((row) => activeIds.has(row.fromStatusId) && activeIds.has(row.toStatusId))
        .map((row) => ({ fromStatusId: row.fromStatusId, toStatusId: row.toStatusId }));

      const projectComponents = await db
        .select({ id: components.id, projectId: components.projectId, name: components.name })
        .from(components)
        .where(eq(components.projectId, project.id))
        .orderBy(asc(components.name));

      return {
        ...project,
        statuses: statuses.map((status) => ({
          id: status.id,
          key: status.key,
          name: status.name,
          category: status.category as 'not_started' | 'in_progress' | 'completed',
          sortOrder: status.sortOrder,
          initial: status.isInitial,
        })),
        transitions,
        components: projectComponents,
      };
    },
  );

  app.patch(
    '/api/v1/orgs/:orgId/projects/:projectKey',
    { preHandler: orgAccess(db, 'projects.manage') },
    async (request): Promise<Project> => {
      const key = normalizeProjectKey((request.params as { projectKey: string }).projectKey);
      if (!key) throw notFound();
      const body = parseBody(updateProjectBodySchema, request.body);
      const org = request.org!;

      await db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(projects)
          .where(and(eq(projects.organisationId, org.organisationId), eq(projects.key, key)))
          .for('update');
        if (!before) throw notFound();

        const changes = {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.archived !== undefined ? { archivedAt: body.archived ? new Date() : null } : {}),
          ...(body.blockersStopCompletion !== undefined
            ? { blockersStopCompletion: body.blockersStopCompletion }
            : {}),
        };
        await tx.update(projects).set(changes).where(eq(projects.id, before.id));

        await recordAudit(tx, {
          organisationId: org.organisationId,
          actorUserId: org.actorUserId,
          action: 'project.updated',
          targetType: 'project',
          targetId: key,
          before: {
            name: before.name,
            description: before.description,
            archived: before.archivedAt !== null,
            blockersStopCompletion: before.blockersStopCompletion,
          },
          after: {
            name: body.name ?? before.name,
            description: body.description ?? before.description,
            archived: body.archived ?? before.archivedAt !== null,
            blockersStopCompletion: body.blockersStopCompletion ?? before.blockersStopCompletion,
          },
          requestId: request.id,
          source: 'user',
          outcome: 'success',
        });
      });

      const [project] = await loadProjects(db, org.organisationId, key);
      return project!;
    },
  );

  app.post(
    '/api/v1/orgs/:orgId/projects/:projectKey/components',
    { preHandler: orgAccess(db, 'projects.manage') },
    async (request, reply): Promise<Component> => {
      const key = normalizeProjectKey((request.params as { projectKey: string }).projectKey);
      if (!key) throw notFound();
      const body = parseBody(createComponentBodySchema, request.body);
      const org = request.org!;

      try {
        const component = await db.transaction(async (tx) => {
          const [project] = await tx
            .select({ id: projects.id })
            .from(projects)
            .where(and(eq(projects.organisationId, org.organisationId), eq(projects.key, key)));
          if (!project) throw notFound();

          const [row] = await tx
            .insert(components)
            .values({
              organisationId: org.organisationId,
              projectId: project.id,
              name: body.name,
            })
            .returning({
              id: components.id,
              projectId: components.projectId,
              name: components.name,
            });
          await recordAudit(tx, {
            organisationId: org.organisationId,
            actorUserId: org.actorUserId,
            action: 'component.created',
            targetType: 'component',
            targetId: row!.id,
            after: { project: key, name: body.name },
            requestId: request.id,
            source: 'user',
            outcome: 'success',
          });
          return row!;
        });
        reply.status(201);
        return component;
      } catch (error) {
        if (isUniqueViolation(error, 'components_project_name_unique')) {
          throw new AppError(
            'conflict',
            `The project ${key} already has a component named "${body.name}".`,
            409,
          );
        }
        throw error;
      }
    },
  );

  app.get(
    '/api/v1/orgs/:orgId/ticket-config',
    { preHandler: orgAccess(db, 'tickets.view') },
    async (request): Promise<TicketConfig> => {
      const organisationId = request.org!.organisationId;
      const [types, ranked, labelRows, componentRows] = await Promise.all([
        db
          .select({ id: ticketTypes.id, key: ticketTypes.key, name: ticketTypes.name })
          .from(ticketTypes)
          .where(
            and(eq(ticketTypes.organisationId, organisationId), eq(ticketTypes.isActive, true)),
          )
          .orderBy(asc(ticketTypes.sortOrder), asc(ticketTypes.name)),
        db
          .select({
            id: priorities.id,
            key: priorities.key,
            name: priorities.name,
            rank: priorities.rank,
          })
          .from(priorities)
          .where(and(eq(priorities.organisationId, organisationId), eq(priorities.isActive, true)))
          .orderBy(asc(priorities.rank)),
        db
          .select({ id: labels.id, name: labels.name, color: labels.color })
          .from(labels)
          .where(eq(labels.organisationId, organisationId))
          .orderBy(asc(sql`lower(${labels.name})`)),
        db
          .select({ id: components.id, projectId: components.projectId, name: components.name })
          .from(components)
          .where(eq(components.organisationId, organisationId))
          .orderBy(asc(components.name)),
      ]);

      return {
        types,
        priorities: ranked,
        labels: labelRows as TicketConfig['labels'],
        components: componentRows,
      };
    },
  );
}
