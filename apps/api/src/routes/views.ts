import { savedViews, type Db } from '@forge/db';
import {
  hasPermission,
  saveViewBodySchema,
  updateViewBodySchema,
  viewDefinitionSchema,
  type SavedView,
} from '@forge/shared';
import { and, asc, eq, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../audit';
import { orgAccess } from '../auth/guards';
import { isUniqueViolation, pgConstraint } from '../db-errors';
import { AppError } from '../errors';
import { parseBody } from '../validation';

const notFound = () => new AppError('not_found', 'Not found.', 404);

const NAME_TAKEN = ['saved_views_personal_name_unique', 'saved_views_shared_name_unique'];
const nameTaken = (name: string) =>
  new AppError('conflict', `A view named "${name}" already exists.`, 409);

type Row = typeof savedViews.$inferSelect;

function toView(row: Row): SavedView {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope as SavedView['scope'],
    ownerUserId: row.ownerUserId,
    definition: viewDefinitionSchema.parse(row.definition),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function viewIdParam(request: { params: unknown }): string {
  const parsed = z.uuid().safeParse((request.params as { viewId: string }).viewId);
  if (!parsed.success) throw notFound();
  return parsed.data;
}

export function registerViewRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;

  const mayManageShared = (request: FastifyRequest) =>
    hasPermission(request.org!.permissions, 'projects.manage');

  /** A view this person can see: their own personal ones and any shared one. */
  const visibleTo = (request: FastifyRequest, viewId: string) => {
    const org = request.org!;
    return and(
      eq(savedViews.organisationId, org.organisationId),
      eq(savedViews.id, viewId),
      or(eq(savedViews.scope, 'shared'), eq(savedViews.ownerUserId, org.actorUserId)),
    );
  };

  app.get(
    '/api/v1/orgs/:orgId/views',
    { preHandler: orgAccess(db, 'tickets.view') },
    async (request): Promise<SavedView[]> => {
      const org = request.org!;
      const rows = await db
        .select()
        .from(savedViews)
        .where(
          and(
            eq(savedViews.organisationId, org.organisationId),
            or(eq(savedViews.scope, 'shared'), eq(savedViews.ownerUserId, org.actorUserId)),
          ),
        )
        // Personal views first, then shared; each by name regardless of case.
        .orderBy(
          asc(sql`${savedViews.scope} = 'shared'`),
          asc(sql`lower(${savedViews.name})`),
          asc(savedViews.id),
        );
      return rows.map(toView);
    },
  );

  app.post(
    '/api/v1/orgs/:orgId/views',
    { preHandler: orgAccess(db, 'tickets.view') },
    async (request, reply): Promise<SavedView> => {
      const body = parseBody(saveViewBodySchema, request.body);
      const org = request.org!;
      if (body.scope === 'shared' && !mayManageShared(request)) {
        throw new AppError('forbidden', "You don't have permission to share views.", 403);
      }

      try {
        const view = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(savedViews)
            .values({
              organisationId: org.organisationId,
              ownerUserId: org.actorUserId,
              name: body.name,
              scope: body.scope,
              definition: body.definition,
            })
            .returning();
          if (body.scope === 'shared') {
            await recordAudit(tx, {
              organisationId: org.organisationId,
              actorUserId: org.actorUserId,
              action: 'view.created',
              targetType: 'view',
              targetId: row!.id,
              after: { name: body.name, scope: body.scope },
              requestId: request.id,
              source: 'user',
              outcome: 'success',
            });
          }
          return toView(row!);
        });
        reply.status(201);
        return view;
      } catch (error) {
        if (isUniqueViolation(error) && NAME_TAKEN.includes(pgConstraint(error) ?? '')) {
          throw nameTaken(body.name);
        }
        throw error;
      }
    },
  );

  app.patch(
    '/api/v1/orgs/:orgId/views/:viewId',
    { preHandler: orgAccess(db, 'tickets.view') },
    async (request): Promise<SavedView> => {
      const viewId = viewIdParam(request);
      const body = parseBody(updateViewBodySchema, request.body);
      const org = request.org!;

      try {
        return await db.transaction(async (tx) => {
          const [before] = await tx
            .select()
            .from(savedViews)
            .where(visibleTo(request, viewId))
            .for('update');
          if (!before) throw notFound();
          if (before.scope === 'shared' && !mayManageShared(request)) {
            throw new AppError(
              'forbidden',
              "You don't have permission to change shared views.",
              403,
            );
          }

          const [row] = await tx
            .update(savedViews)
            .set({
              ...(body.name !== undefined ? { name: body.name } : {}),
              ...(body.definition !== undefined ? { definition: body.definition } : {}),
              updatedAt: new Date(),
            })
            .where(eq(savedViews.id, before.id))
            .returning();

          if (before.scope === 'shared') {
            await recordAudit(tx, {
              organisationId: org.organisationId,
              actorUserId: org.actorUserId,
              action: 'view.updated',
              targetType: 'view',
              targetId: before.id,
              before: { name: before.name, scope: before.scope },
              after: { name: row!.name, scope: row!.scope },
              requestId: request.id,
              source: 'user',
              outcome: 'success',
            });
          }
          return toView(row!);
        });
      } catch (error) {
        if (isUniqueViolation(error) && NAME_TAKEN.includes(pgConstraint(error) ?? '')) {
          throw nameTaken(body.name ?? '');
        }
        throw error;
      }
    },
  );

  app.delete(
    '/api/v1/orgs/:orgId/views/:viewId',
    { preHandler: orgAccess(db, 'tickets.view') },
    async (request, reply): Promise<void> => {
      const viewId = viewIdParam(request);
      const org = request.org!;

      await db.transaction(async (tx) => {
        const [view] = await tx
          .select()
          .from(savedViews)
          .where(visibleTo(request, viewId))
          .for('update');
        if (!view) throw notFound();
        if (view.scope === 'shared' && !mayManageShared(request)) {
          throw new AppError('forbidden', "You don't have permission to delete shared views.", 403);
        }

        await tx.delete(savedViews).where(eq(savedViews.id, view.id));
        if (view.scope === 'shared') {
          await recordAudit(tx, {
            organisationId: org.organisationId,
            actorUserId: org.actorUserId,
            action: 'view.deleted',
            targetType: 'view',
            targetId: view.id,
            before: { name: view.name, scope: view.scope },
            requestId: request.id,
            source: 'user',
            outcome: 'success',
          });
        }
      });
      reply.status(204).send();
    },
  );
}
