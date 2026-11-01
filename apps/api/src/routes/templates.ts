import { labels, projects, ticketTemplates, type Db, type Executor } from '@forge/db';
import {
  MAX_TEMPLATES,
  createTemplateBodySchema,
  hasPermission,
  normalizeProjectKey,
  reorderTemplatesBodySchema,
  updateTemplateBodySchema,
  type CreateTemplateBody,
  type TicketTemplate,
} from '@forge/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../audit';
import { orgAccess } from '../auth/guards';
import { isForeignKeyViolation, isUniqueViolation } from '../db-errors';
import { AppError } from '../errors';
import { findReferenceIssues, invalid, type Issue } from '../tickets/service';
import { parseBody } from '../validation';

const notFound = () => new AppError('not_found', 'Not found.', 404);

const nameTaken = (projectKey: string, name: string) =>
  new AppError(
    'conflict',
    `The project ${projectKey} already has a template named "${name}".`,
    409,
  );

const archivedError = () =>
  new AppError('conflict', 'This project is archived. Unarchive it to change its templates.', 409);

type TemplateRow = typeof ticketTemplates.$inferSelect;

/** What the audit trail keeps of a template: everything a person set on it. */
const auditOf = (row: TemplateRow) => ({
  name: row.name,
  titlePrefix: row.titlePrefix,
  typeId: row.typeId,
  priorityId: row.priorityId,
  componentId: row.componentId,
  labelIds: row.labelIds,
  goal: row.goal,
  criteria: row.criteria,
  description: row.description,
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
    .select({ id: projects.id, key: projects.key, archivedAt: projects.archivedAt })
    .from(projects)
    .where(and(eq(projects.organisationId, organisationId), eq(projects.key, key)));
  const [project] = lock ? await query.for('update') : await query;
  if (!project) throw notFound();
  return project;
}

function templateIdOf(request: FastifyRequest): string {
  const { templateId } = request.params as { templateId: string };
  if (!z.uuid().safeParse(templateId).success) throw notFound();
  return templateId;
}

/** The project's templates in order. Labels deleted since drop out; nothing else is hidden. */
async function loadTemplates(executor: Executor, projectId: string): Promise<TicketTemplate[]> {
  const rows = await executor
    .select()
    .from(ticketTemplates)
    .where(eq(ticketTemplates.projectId, projectId))
    .orderBy(asc(ticketTemplates.sortOrder), asc(ticketTemplates.createdAt));
  const labelIds = [...new Set(rows.flatMap((row) => row.labelIds))];
  const existing = new Set(
    labelIds.length === 0
      ? []
      : (
          await executor
            .select({ id: labels.id })
            .from(labels)
            .where(
              and(eq(labels.organisationId, rows[0]!.organisationId), inArray(labels.id, labelIds)),
            )
        ).map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    titlePrefix: row.titlePrefix,
    typeId: row.typeId,
    priorityId: row.priorityId,
    componentId: row.componentId,
    labelIds: row.labelIds.filter((id) => existing.has(id)),
    goal: row.goal,
    criteria: row.criteria,
    description: row.description,
  }));
}

/**
 * Checks every reference the way creating a ticket does (active types, priorities and components,
 * the component of this project, labels of this workspace), so a template never offers something
 * the create form would refuse. A null clears a choice and needs no check.
 */
function referenceIssues(
  tx: Executor,
  organisationId: string,
  projectId: string,
  body: Partial<CreateTemplateBody>,
): Promise<Issue[]> {
  return findReferenceIssues(tx, organisationId, projectId, {
    ...(body.typeId ? { typeId: body.typeId } : {}),
    ...(body.priorityId ? { priorityId: body.priorityId } : {}),
    ...(body.componentId ? { componentId: body.componentId } : {}),
    ...(body.labelIds ? { labelIds: body.labelIds } : {}),
  });
}

/** Only the fields the body names, in the shape of the table. */
const changesOf = (body: Partial<CreateTemplateBody>) => ({
  ...(body.name !== undefined ? { name: body.name } : {}),
  ...(body.titlePrefix !== undefined ? { titlePrefix: body.titlePrefix } : {}),
  ...(body.typeId !== undefined ? { typeId: body.typeId } : {}),
  ...(body.priorityId !== undefined ? { priorityId: body.priorityId } : {}),
  ...(body.componentId !== undefined ? { componentId: body.componentId } : {}),
  ...(body.labelIds !== undefined ? { labelIds: body.labelIds } : {}),
  ...(body.goal !== undefined ? { goal: body.goal } : {}),
  ...(body.criteria !== undefined ? { criteria: body.criteria } : {}),
  ...(body.description !== undefined ? { description: body.description } : {}),
});

/** Ticket templates of a project: listed for anyone who creates tickets, managed by managers. */
export function registerTemplateRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;
  const base = '/api/v1/orgs/:orgId/projects/:projectKey/templates';

  /** Turns the database's refusals into sentences: a taken name, a reference gone meanwhile. */
  const translate = (error: unknown, projectKey: string, name: string | undefined) => {
    if (isUniqueViolation(error, 'ticket_templates_project_name_unique')) {
      return nameTaken(projectKey, name ?? '');
    }
    if (isForeignKeyViolation(error)) {
      return invalid([{ path: 'body', message: 'One of the referenced items no longer exists.' }]);
    }
    return error;
  };

  app.get(
    base,
    { preHandler: orgAccess(db, 'tickets.view') },
    async (request): Promise<TicketTemplate[]> => {
      const org = request.org!;
      // Creators pick them; managers keep them. Someone who may do neither has no use for them.
      if (
        !hasPermission(org.permissions, 'tickets.create') &&
        !hasPermission(org.permissions, 'projects.manage')
      ) {
        throw new AppError('forbidden', "You don't have permission to do that.", 403);
      }
      const project = await projectOf(db, org.organisationId, request);
      return loadTemplates(db, project.id);
    },
  );

  app.post(
    base,
    { preHandler: orgAccess(db, 'projects.manage') },
    async (request, reply): Promise<TicketTemplate> => {
      const body = parseBody(createTemplateBodySchema, request.body);
      const org = request.org!;
      let projectKey = '';

      try {
        const created = await db.transaction(async (tx) => {
          // Locked, so two additions at once cannot both slip under the limit.
          const project = await projectOf(tx, org.organisationId, request, true);
          projectKey = project.key;
          if (project.archivedAt) throw archivedError();

          const [counted] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(ticketTemplates)
            .where(eq(ticketTemplates.projectId, project.id));
          if (counted!.count >= MAX_TEMPLATES) {
            throw new AppError(
              'conflict',
              `A project can have at most ${MAX_TEMPLATES} templates. Delete one to add another.`,
              409,
            );
          }

          const issues = await referenceIssues(tx, org.organisationId, project.id, body);
          if (issues.length > 0) throw invalid(issues);

          const [last] = await tx
            .select({ max: sql<number | null>`max(${ticketTemplates.sortOrder})` })
            .from(ticketTemplates)
            .where(eq(ticketTemplates.projectId, project.id));
          const [row] = await tx
            .insert(ticketTemplates)
            .values({
              organisationId: org.organisationId,
              projectId: project.id,
              ...changesOf(body),
              name: body.name,
              sortOrder: (last?.max ?? -1) + 1,
            })
            .returning();
          await recordAudit(tx, {
            organisationId: org.organisationId,
            actorUserId: org.actorUserId,
            action: 'template.created',
            targetType: 'template',
            targetId: row!.id,
            after: { project: project.key, ...auditOf(row!) },
            requestId: request.id,
            source: 'user',
            outcome: 'success',
          });
          return (await loadTemplates(tx, project.id)).find((item) => item.id === row!.id)!;
        });
        reply.status(201);
        return created;
      } catch (error) {
        throw translate(error, projectKey, body.name);
      }
    },
  );

  app.patch(
    `${base}/:templateId`,
    { preHandler: orgAccess(db, 'projects.manage') },
    async (request): Promise<TicketTemplate> => {
      const templateId = templateIdOf(request);
      const body = parseBody(updateTemplateBodySchema, request.body);
      const org = request.org!;
      let projectKey = '';

      try {
        return await db.transaction(async (tx) => {
          const project = await projectOf(tx, org.organisationId, request);
          projectKey = project.key;
          const [before] = await tx
            .select()
            .from(ticketTemplates)
            .where(
              and(eq(ticketTemplates.id, templateId), eq(ticketTemplates.projectId, project.id)),
            )
            .for('update');
          if (!before) throw notFound();
          if (project.archivedAt) throw archivedError();

          const issues = await referenceIssues(tx, org.organisationId, project.id, body);
          if (issues.length > 0) throw invalid(issues);

          const [row] = await tx
            .update(ticketTemplates)
            .set(changesOf(body))
            .where(eq(ticketTemplates.id, before.id))
            .returning();
          await recordAudit(tx, {
            organisationId: org.organisationId,
            actorUserId: org.actorUserId,
            action: 'template.updated',
            targetType: 'template',
            targetId: before.id,
            before: { project: project.key, ...auditOf(before) },
            after: { project: project.key, ...auditOf(row!) },
            requestId: request.id,
            source: 'user',
            outcome: 'success',
          });
          return (await loadTemplates(tx, project.id)).find((item) => item.id === before.id)!;
        });
      } catch (error) {
        throw translate(error, projectKey, body.name);
      }
    },
  );

  app.put(
    `${base}/order`,
    { preHandler: orgAccess(db, 'projects.manage') },
    async (request): Promise<TicketTemplate[]> => {
      const body = parseBody(reorderTemplatesBodySchema, request.body);
      const org = request.org!;

      return db.transaction(async (tx) => {
        const project = await projectOf(tx, org.organisationId, request, true);
        if (project.archivedAt) throw archivedError();
        const current = await tx
          .select({ id: ticketTemplates.id })
          .from(ticketTemplates)
          .where(eq(ticketTemplates.projectId, project.id))
          .orderBy(asc(ticketTemplates.sortOrder), asc(ticketTemplates.createdAt));
        const known = new Set(current.map((row) => row.id));
        if (body.ids.length !== known.size || body.ids.some((id) => !known.has(id))) {
          const message = 'The templates changed since this page was loaded. Reload and try again.';
          throw new AppError('conflict', message, 409);
        }
        for (const [sortOrder, id] of body.ids.entries()) {
          await tx.update(ticketTemplates).set({ sortOrder }).where(eq(ticketTemplates.id, id));
        }
        return loadTemplates(tx, project.id);
      });
    },
  );

  app.delete(
    `${base}/:templateId`,
    { preHandler: orgAccess(db, 'projects.manage') },
    async (request, reply): Promise<void> => {
      const templateId = templateIdOf(request);
      const org = request.org!;

      await db.transaction(async (tx) => {
        const project = await projectOf(tx, org.organisationId, request);
        const [template] = await tx
          .select()
          .from(ticketTemplates)
          .where(and(eq(ticketTemplates.id, templateId), eq(ticketTemplates.projectId, project.id)))
          .for('update');
        if (!template) throw notFound();
        if (project.archivedAt) throw archivedError();

        await tx.delete(ticketTemplates).where(eq(ticketTemplates.id, template.id));
        await recordAudit(tx, {
          organisationId: org.organisationId,
          actorUserId: org.actorUserId,
          action: 'template.deleted',
          targetType: 'template',
          targetId: template.id,
          before: { project: project.key, ...auditOf(template) },
          requestId: request.id,
          source: 'user',
          outcome: 'success',
        });
      });
      reply.status(204).send();
    },
  );
}
